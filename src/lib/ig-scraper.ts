import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import {
  buildCompletenessWarning,
  isValidIgUsername,
  normalizeUsername,
  parseInstagramPostUrl,
  type RawComment,
} from "./giveaway";

const SESSION_DIR = path.join(process.cwd(), ".ig-session");
const STORAGE_STATE_PATH = path.join(SESSION_DIR, "storage-state.json");
const IG_APP_ID = "936619743392459";
const IG_ASBD_ID = "129477";

export interface SessionStatus {
  connected: boolean;
  userId?: string;
  updatedAt?: string;
}

export interface ScrapeResult {
  postUrl: string;
  shortcode: string;
  ownerUsername?: string;
  comments: RawComment[];
  requiresAuth?: boolean;
  warning?: string;
}

function ensureSessionDir() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

export function getSessionStatus(): SessionStatus {
  try {
    if (!fs.existsSync(STORAGE_STATE_PATH)) {
      return { connected: false };
    }
    const raw = fs.readFileSync(STORAGE_STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as {
      cookies?: Array<{
        name: string;
        value: string;
        domain: string;
        expires?: number;
      }>;
    };
    const cookies = parsed.cookies ?? [];
    const nowSec = Date.now() / 1000;
    const sessionCookie = cookies.find(
      (c) =>
        c.name === "sessionid" &&
        c.value &&
        c.domain.includes("instagram.com") &&
        (!c.expires || c.expires <= 0 || c.expires > nowSec)
    );
    if (!sessionCookie) {
      return { connected: false };
    }
    const userCookie = cookies.find(
      (c) => c.name === "ds_user_id" && c.domain.includes("instagram.com")
    );
    const stat = fs.statSync(STORAGE_STATE_PATH);
    return {
      connected: true,
      userId: userCookie?.value,
      updatedAt: stat.mtime.toISOString(),
    };
  } catch {
    return { connected: false };
  }
}

export function saveManualSessionCookie(rawSessionId: string): SessionStatus {
  const cleaned = decodeURIComponent(rawSessionId.trim()).replace(
    /^sessionid=/i,
    ""
  );
  if (!cleaned || cleaned.length < 10) {
    throw new Error("El valor de la cookie sessionid no parece válido.");
  }

  ensureSessionDir();
  const userIdPart = cleaned.split(":")[0];
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 60; // 60 days

  const state = {
    cookies: [
      {
        name: "sessionid",
        value: encodeURIComponent(cleaned),
        domain: ".instagram.com",
        path: "/",
        expires,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
      ...(userIdPart && /^\d+$/.test(userIdPart)
        ? [
            {
              name: "ds_user_id",
              value: userIdPart,
              domain: ".instagram.com",
              path: "/",
              expires,
              httpOnly: false,
              secure: true,
              sameSite: "Lax",
            },
          ]
        : []),
    ],
    origins: [],
  };

  fs.writeFileSync(STORAGE_STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
  return getSessionStatus();
}

export function clearSession(): void {
  if (fs.existsSync(STORAGE_STATE_PATH)) {
    fs.unlinkSync(STORAGE_STATE_PATH);
  }
}

async function launchLocalBrowser(headless: boolean): Promise<Browser> {
  const commonArgs = [
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
  ];

  for (const channel of ["chrome", "msedge"] as const) {
    try {
      return await chromium.launch({
        channel,
        headless,
        args: commonArgs,
      });
    } catch {
      // Try next channel
    }
  }

  return await chromium.launch({
    headless,
    args: commonArgs,
  });
}

/**
 * Opens a visible Chrome/Edge window so the user can sign in to Instagram locally.
 * Automatically detects the `sessionid` cookie and saves the Playwright storageState.
 */
export async function launchInteractiveLogin(): Promise<SessionStatus> {
  ensureSessionDir();
  const browser = await launchLocalBrowser(false);

  try {
    const context = await browser.newContext({
      viewport: { width: 1100, height: 780 },
      locale: "es-ES",
    });
    const page = await context.newPage();

    await page.goto("https://www.instagram.com/accounts/login/", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    const deadline = Date.now() + 180_000; // Up to 3 minutes to log in

    while (Date.now() < deadline) {
      if (page.isClosed()) {
        break;
      }

      const cookies = await context.cookies("https://www.instagram.com");
      const sessionCookie = cookies.find(
        (c) => c.name === "sessionid" && c.value && c.value.length > 8
      );

      if (sessionCookie) {
        await page.waitForTimeout(1500).catch(() => {});
        await context.storageState({ path: STORAGE_STATE_PATH });
        await browser.close();
        return getSessionStatus();
      }

      await new Promise((r) => setTimeout(r, 1200));
    }

    throw new Error(
      "No se detectó el inicio de sesión antes de cerrar la ventana o agotar el tiempo."
    );
  } finally {
    await browser.close().catch(() => {});
  }
}

function shortcodeToMediaId(shortcode: string): string | null {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let id = 0n;
  const clean = shortcode.slice(0, 11);
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) return null;
    id = id * 64n + BigInt(idx);
  }
  return id > 0n ? id.toString(10) : null;
}

/**
 * Parses both standard JSON and newline-delimited Relay streamed JSON responses.
 */
function parseJsonPayloads(rawText: string): unknown[] {
  const stripped = rawText.replace(/^for\s*\(\s*;\s*;\s*\)\s*;/, "").trim();
  if (!stripped) return [];

  try {
    return [JSON.parse(stripped)];
  } catch {
    const results: unknown[] = [];
    const lines = stripped.split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim().replace(/^for\s*\(\s*;\s*;\s*\)\s*;/, "");
      if (!t.startsWith("{") && !t.startsWith("[")) continue;
      try {
        results.push(JSON.parse(t));
      } catch {
        // Ignore non-JSON lines
      }
    }
    return results;
  }
}

/**
 * Recursively walks Instagram GraphQL / Relay XDT / REST payloads to collect comment objects and post owner.
 */
export function extractFromIgJson(
  node: unknown,
  collected: Map<string, RawComment>,
  meta: {
    ownerUsername?: string;
    mediaId?: string;
    captionPk?: string;
    shortcode?: string;
    expectedCount?: number;
  },
  inCommentContainer = false
) {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const item of node) {
      extractFromIgJson(item, collected, meta, inCommentContainer);
    }
    return;
  }

  const obj = node as Record<string, unknown>;

  // Payloads also carry related posts, so post-level metadata must match the target shortcode
  const isTargetMedia =
    Boolean(meta.shortcode) &&
    (obj.code === meta.shortcode || obj.shortcode === meta.shortcode);

  // Detect caption PK so we don't count the post caption itself as a comment
  if (obj.caption && typeof obj.caption === "object") {
    const cap = obj.caption as Record<string, unknown>;
    if (cap.pk) meta.captionPk = String(cap.pk);
    const capUser = cap.user as Record<string, unknown> | undefined;
    if (
      isTargetMedia &&
      capUser &&
      typeof capUser.username === "string" &&
      !meta.ownerUsername
    ) {
      meta.ownerUsername = capUser.username;
    }
  }

  if (isTargetMedia && typeof obj.comment_count === "number") {
    meta.expectedCount = obj.comment_count;
  }

  // Detect shortcode_media / xdt_shortcode_media owner & mediaId
  if (isTargetMedia && (obj.owner || obj.user)) {
    const ownerObj = (obj.owner || obj.user) as Record<string, unknown>;
    if (typeof ownerObj?.username === "string" && !meta.ownerUsername) {
      meta.ownerUsername = ownerObj.username;
    }
    if ((obj.pk || obj.id) && !meta.mediaId) {
      const rawId = String(obj.pk || obj.id).split("_")[0];
      if (/^\d+$/.test(rawId)) meta.mediaId = rawId;
    }
  }

  const textVal = typeof obj.text === "string" ? obj.text : null;
  const userObj = (obj.user || obj.owner) as Record<string, unknown> | undefined;
  const usernameVal =
    userObj && typeof userObj.username === "string" ? userObj.username : null;
  const rawId = obj.pk ?? obj.id;
  const typename = typeof obj.__typename === "string" ? obj.__typename : "";

  const isCaptionObject =
    "caption_is_edited" in obj ||
    (rawId !== undefined &&
      (String(rawId) === meta.captionPk || String(rawId) === meta.mediaId));

  const looksLikeComment =
    !isCaptionObject &&
    textVal !== null &&
    usernameVal !== null &&
    rawId !== undefined &&
    (inCommentContainer ||
      typename === "XDTCommentDict" ||
      typename === "GraphComment" ||
      "created_at" in obj ||
      "created_at_utc" in obj ||
      "comment_like_count" in obj ||
      "has_liked_comment" in obj ||
      "child_comment_count" in obj ||
      "edge_liked_by" in obj ||
      "parent_comment_id" in obj ||
      "restricted_status" in obj ||
      "did_report_as_spam" in obj);

  if (looksLikeComment && usernameVal && isValidIgUsername(usernameVal)) {
    const idStr = String(rawId);
    const existing = collected.get(idStr);
    collected.set(idStr, {
      id: idStr,
      username: usernameVal,
      fullName:
        (typeof userObj?.full_name === "string" && userObj.full_name) ||
        existing?.fullName,
      text: textVal ?? existing?.text ?? "",
      avatarUrl:
        (typeof userObj?.profile_pic_url === "string" &&
          userObj.profile_pic_url) ||
        existing?.avatarUrl,
    });
  }

  for (const key of Object.keys(obj)) {
    if (key === "caption") continue;
    const childIsCommentContainer =
      inCommentContainer ||
      key === "comments" ||
      key === "child_comments" ||
      key === "preview_child_comments" ||
      key.includes("comment");
    extractFromIgJson(obj[key], collected, meta, childIsCommentContainer);
  }
}

/**
 * Extracts visible comments currently rendered in the DOM (Polaris div & ul layouts)
 * and merges them into `collected` without duplicating comments already captured via JSON.
 */
async function harvestDomComments(
  page: Page,
  collected: Map<string, RawComment>,
  meta: { ownerUsername?: string }
): Promise<number> {
  const domItems = await page
    .evaluate(() => {
      const results: Array<{
        pk?: string;
        username: string;
        text: string;
      }> = [];

      const root =
        document.querySelector('[role="dialog"] article') ||
        document.querySelector("article") ||
        document.querySelector("main");
      if (!root) return results;

      // Strategy A: Every comment in Instagram web has a permalink `/c/{commentPk}/` wrapping `<time>`
      const commentLinks = Array.from(
        root.querySelectorAll('a[href*="/c/"]')
      ) as HTMLAnchorElement[];

      const processedContainers = new Set<Element>();

      for (const cLink of commentLinks) {
        const href = cLink.getAttribute("href") || "";
        const pkMatch = href.match(/\/c\/(\d+)/);
        const pk = pkMatch ? pkMatch[1] : undefined;

        // Walk up to find the comment row container that holds the author link + text
        let row: Element | null = cLink.parentElement;
        let foundAuthor: string | null = null;

        for (let depth = 0; depth < 7 && row && row !== root; depth++) {
          const userAnchors = Array.from(
            row.querySelectorAll('a[href^="/"]')
          ) as HTMLAnchorElement[];

          for (const a of userAnchors) {
            const uHref = a.getAttribute("href") || "";
            if (uHref.includes("/c/") || uHref.includes("/p/") || uHref.includes("/reel/")) {
              continue;
            }
            const m = uHref.match(/^\/([a-zA-Z0-9._]{1,30})\/$/);
            const anchorText = (a.textContent || "").trim().replace(/^@/, "");
            if (m && anchorText && anchorText.toLowerCase() === m[1].toLowerCase()) {
              foundAuthor = m[1];
              break;
            }
          }

          if (foundAuthor) break;
          row = row.parentElement;
        }

        if (!row || !foundAuthor || processedContainers.has(row)) continue;
        processedContainers.add(row);

        // Collect clean comment text from spans inside this row, excluding username, time, and UI actions
        const spans = Array.from(row.querySelectorAll("span[dir='auto'], span"));
        let bestText = "";
        for (const sp of spans) {
          if (sp.closest("a") || sp.closest("time") || sp.closest("button")) {
            continue;
          }
          const t = (sp.textContent || "").trim();
          if (
            !t ||
            t.toLowerCase() === foundAuthor.toLowerCase() ||
            /^(responder|reply|ver traducción|see translation|editado|edited|\d+\s*(h|d|sem|w|m|s|min)|me gusta|likes?)$/i.test(
              t
            )
          ) {
            continue;
          }
          if (t.length > bestText.length) {
            bestText = t;
          }
        }

        results.push({
          pk,
          username: foundAuthor,
          text: bestText || "Comentario en publicación",
        });
      }

      // Strategy B: Fallback for comment rows with `<time>` + Reply button when `/c/` permalink isn't rendered
      const timeEls = Array.from(root.querySelectorAll("time"));
      for (const timeEl of timeEls) {
        if (timeEl.closest('a[href*="/c/"]')) continue;
        let row: Element | null = timeEl.parentElement;
        for (let depth = 0; depth < 6 && row && row !== root; depth++) {
          if (processedContainers.has(row)) break;
          const rowText = row.textContent || "";
          const hasReplyBtn = /\b(Responder|Reply)\b/i.test(rowText);
          if (hasReplyBtn) {
            const userAnchors = Array.from(
              row.querySelectorAll('a[href^="/"]')
            ) as HTMLAnchorElement[];
            let author: string | null = null;
            for (const a of userAnchors) {
              const m = (a.getAttribute("href") || "").match(
                /^\/([a-zA-Z0-9._]{1,30})\/$/
              );
              const txt = (a.textContent || "").trim();
              if (m && txt && txt.toLowerCase() === m[1].toLowerCase()) {
                author = m[1];
                break;
              }
            }
            if (author) {
              processedContainers.add(row);
              const spans = Array.from(row.querySelectorAll("span"));
              let bestText = "";
              for (const sp of spans) {
                if (sp.closest("a") || sp.closest("time") || sp.closest("button")) continue;
                const t = (sp.textContent || "").trim();
                if (
                  !t ||
                  t.toLowerCase() === author.toLowerCase() ||
                  /^(responder|reply|ver traducción|see translation|\d+\s*(h|d|sem|w|m|s|min)|\d+\s*me gusta|\d+\s*likes?)$/i.test(
                    t
                  )
                ) {
                  continue;
                }
                if (t.length > bestText.length) bestText = t;
              }
              results.push({
                username: author,
                text: bestText || "Comentario en publicación",
              });
            }
            break;
          }
          row = row.parentElement;
        }
      }

      return results;
    })
    .catch(() => []);

  let added = 0;

  // Build quick lookup of existing username+text signatures so synthetic DOM IDs don't duplicate JSON comments
  const existingSignatures = new Set<string>();
  for (const c of collected.values()) {
    const sig = `${normalizeUsername(c.username)}::${c.text
      .trim()
      .toLowerCase()
      .slice(0, 40)}`;
    existingSignatures.add(sig);
  }

  for (let i = 0; i < domItems.length; i++) {
    const item = domItems[i];
    if (!isValidIgUsername(item.username)) continue;

    if (item.pk && collected.has(item.pk)) {
      continue;
    }

    const normUser = normalizeUsername(item.username);
    const normText = item.text.trim().toLowerCase().slice(0, 40);
    const sig = `${normUser}::${normText}`;

    // If no pk, skip if we already captured this exact user+comment from JSON
    if (!item.pk && existingSignatures.has(sig)) {
      continue;
    }

    // Avoid mistaking caption by owner if no pk
    if (
      !item.pk &&
      i === 0 &&
      meta.ownerUsername &&
      normUser === normalizeUsername(meta.ownerUsername)
    ) {
      continue;
    }

    const id = item.pk || `dom-${normUser}-${ normText.slice(0, 16) || i }`;
    if (!collected.has(id)) {
      collected.set(id, {
        id,
        username: item.username,
        text: item.text,
      });
      existingSignatures.add(sig);
      added += 1;
    }
  }

  return added;
}

export async function scrapeInstagramComments(
  rawUrl: string
): Promise<ScrapeResult> {
  const parsed = parseInstagramPostUrl(rawUrl);
  if (!parsed.isValid || !parsed.shortcode) {
    throw new Error(
      "URL de Instagram no válida. Usa un enlace como https://www.instagram.com/p/CODIGO/ o /reel/CODIGO/."
    );
  }

  // Navigating via `/p/{shortcode}/` opens the 2-column post view with comments open immediately (even for Reels!)
  const targetViewUrl = `https://www.instagram.com/p/${parsed.shortcode}/`;

  const session = getSessionStatus();
  const browser = await launchLocalBrowser(true);

  const collected = new Map<string, RawComment>();
  const meta: {
    ownerUsername?: string;
    mediaId?: string;
    captionPk?: string;
    shortcode?: string;
    expectedCount?: number;
  } = { shortcode: parsed.shortcode };

  try {
    const contextOptions: Parameters<Browser["newContext"]>[0] = {
      viewport: { width: 1366, height: 920 },
      locale: "es-ES",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
      ...(session.connected && fs.existsSync(STORAGE_STATE_PATH)
        ? { storageState: STORAGE_STATE_PATH }
        : {}),
    };

    const context: BrowserContext = await browser.newContext(contextOptions);
    const page = await context.newPage();

    // 1. Intercept ALL Instagram JSON / GraphQL / Relay / REST responses (including streamed multi-chunk responses)
    page.on("response", async (response) => {
      try {
        const url = response.url();
        if (!url.includes("instagram.com")) return;
        if (
          !url.includes("/graphql") &&
          !url.includes("/api/") &&
          !url.includes("/ajax/") &&
          !url.includes("__a=1")
        ) {
          return;
        }
        const text = await response.text();
        for (const payload of parseJsonPayloads(text)) {
          extractFromIgJson(payload, collected, meta);
        }
      } catch {
        // Ignore aborted or binary responses
      }
    });

    await page.goto(targetViewUrl, {
      waitUntil: "domcontentloaded",
      timeout: 35000,
    });

    await page.waitForTimeout(3000);

    // Check if redirected to login wall
    if (page.url().includes("/accounts/login")) {
      return {
        postUrl: parsed.normalizedUrl,
        shortcode: parsed.shortcode,
        comments: [],
        requiresAuth: true,
        warning:
          "Instagram solicitó iniciar sesión para ver los comentarios de esta publicación. Conecta tu sesión de Instagram arriba en un clic.",
      };
    }

    // Parse embedded Relay / JSON script blocks in the initial HTML
    const embeddedPayloads = await page.evaluate(() => {
      const payloads: string[] = [];
      document
        .querySelectorAll('script[type="application/json"]')
        .forEach((s) => {
          if (
            s.textContent &&
            (s.textContent.includes("comment") ||
              s.textContent.includes("shortcode") ||
              s.textContent.includes("media_id") ||
              s.textContent.includes("pk"))
          ) {
            payloads.push(s.textContent);
          }
        });

      const iosMeta = document
        .querySelector('meta[property="al:ios:url"]')
        ?.getAttribute("content");

      return { payloads, iosMeta };
    });

    for (const rawScript of embeddedPayloads.payloads) {
      for (const payload of parseJsonPayloads(rawScript)) {
        extractFromIgJson(payload, collected, meta);
      }
    }

    if (!meta.mediaId && embeddedPayloads.iosMeta) {
      const m = embeddedPayloads.iosMeta.match(/id=(\d+)/);
      if (m) meta.mediaId = m[1];
    }
    if (!meta.mediaId) {
      meta.mediaId = shortcodeToMediaId(parsed.shortcode) ?? undefined;
    }

    // If Instagram redirected to `/reel/` view where comments drawer is closed, open it first
    await page
      .evaluate(() => {
        if (window.location.pathname.startsWith("/reel")) {
          const commentIcons = Array.from(
            document.querySelectorAll(
              'svg[aria-label="Comentario"], svg[aria-label="Comentarios"], svg[aria-label="Comment"], svg[aria-label="Comments"]'
            )
          );
          for (const svg of commentIcons) {
            const btn = svg.closest('div[role="button"], button') as HTMLElement | null;
            if (btn) {
              btn.click();
              break;
            }
          }
        }
      })
      .catch(() => {});

    // Try switching comment sort order from algorithmic "Para ti" / "For you" to "Más recientes" / "Newest" if dropdown is present
    try {
      const openedSortMenu = await page.evaluate(() => {
        const candidates = Array.from(
          document.querySelectorAll('div[role="button"], button, span')
        );
        for (const el of candidates) {
          if (el.closest("a")) continue;
          const txt = (el.textContent || "").trim();
          if (/^(Para ti|For you|Más relevantes|Most relevant)$/i.test(txt)) {
            const clickable =
              (el.closest('div[role="button"], button') as HTMLElement | null) ||
              (el as HTMLElement);
            clickable.click();
            return true;
          }
        }
        return false;
      });

      if (openedSortMenu) {
        await page.waitForTimeout(700);
        const switchedSort = await page.evaluate(() => {
          const options = Array.from(
            document.querySelectorAll(
              '[role="menuitem"], [role="option"], [role="button"], button, span'
            )
          );
          for (const opt of options) {
            const txt = (opt.textContent || "").trim();
            if (
              /^(Más recientes|Newest|Todos los comentarios|All comments)$/i.test(
                txt
              )
            ) {
              (opt as HTMLElement).click();
              return true;
            }
          }
          return false;
        });
        if (switchedSort) {
          await page.waitForTimeout(1500);
        } else {
          await page.keyboard.press("Escape").catch(() => {});
        }
      }
    } catch {
      // Ignore if post doesn't show a sort selector
    }

    // 2. Fast authenticated REST v1 pagination + child_comments (replies) fetcher
    if (session.connected && meta.mediaId) {
      const apiBatches = await page
        .evaluate(
          async ({ mediaId, appId, asbdId }) => {
            const batches: unknown[] = [];
            const csrfMatch = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
            const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : "";

            const headers: Record<string, string> = {
              "X-IG-App-ID": appId,
              "X-ASBD-ID": asbdId,
              "X-Requested-With": "XMLHttpRequest",
            };
            if (csrfToken) headers["X-CSRFToken"] = csrfToken;

            let minId: string | null = null;
            let maxId: string | null = null;
            const parentsWithReplies: string[] = [];

            for (let pageIdx = 0; pageIdx < 100; pageIdx++) {
              const params = new URLSearchParams({
                can_support_threading: "true",
                permalink_enabled: "false",
              });
              if (minId) params.set("min_id", minId);
              else if (maxId) params.set("max_id", maxId);

              try {
                const res = await fetch(
                  `https://www.instagram.com/api/v1/media/${mediaId}/comments/?${params.toString()}`,
                  { credentials: "include", headers }
                );
                if (!res.ok) break;
                const json = await res.json();
                batches.push(json);

                if (Array.isArray(json.comments)) {
                  for (const c of json.comments) {
                    const totalChild = Number(c?.child_comment_count || 0);
                    const previewLen = Array.isArray(c?.preview_child_comments)
                      ? c.preview_child_comments.length
                      : 0;
                    if (c?.pk && totalChild > previewLen) {
                      parentsWithReplies.push(String(c.pk));
                    }
                  }
                }

                if (json.next_min_id) {
                  minId = String(json.next_min_id);
                  maxId = null;
                } else if (json.next_max_id) {
                  maxId = String(json.next_max_id);
                  minId = null;
                } else {
                  break;
                }
              } catch {
                break;
              }
            }

            // Also fetch full child_comments for threads that had collapsed replies
            for (const parentPk of parentsWithReplies.slice(0, 60)) {
              let childMaxId: string | null = null;
              for (let cPage = 0; cPage < 10; cPage++) {
                const cp = new URLSearchParams();
                if (childMaxId) cp.set("max_id", childMaxId);
                try {
                  const r = await fetch(
                    `https://www.instagram.com/api/v1/media/${mediaId}/comments/${parentPk}/child_comments/?${cp.toString()}`,
                    { credentials: "include", headers }
                  );
                  if (!r.ok) break;
                  const cj = await r.json();
                  batches.push(cj);
                  if (cj.next_max_child_cursor) {
                    childMaxId = String(cj.next_max_child_cursor);
                  } else {
                    break;
                  }
                } catch {
                  break;
                }
              }
            }

            return batches;
          },
          { mediaId: meta.mediaId, appId: IG_APP_ID, asbdId: IG_ASBD_ID }
        )
        .catch(() => []);

      for (const batch of apiBatches) {
        extractFromIgJson(batch, collected, meta, true);
      }
    }

    // 3. UNCONDITIONAL Playwright Interactive UI Expansion:
    // Scrolls the comment list + clicks ALL "Cargar más / Ver más / Ver respuestas / Ver comentarios ocultos" buttons!
    let idleRounds = 0;
    let totalClicks = 0;
    let scrollPasses = 0;

    for (let step = 0; step < 65; step++) {
      scrollPasses += 1;
      const beforeCount = collected.size;

      const uiStep = await page
        .evaluate(() => {
          let clicked = 0;

          const root =
            document.querySelector('[role="dialog"] article') ||
            document.querySelector('[role="dialog"]') ||
            document.querySelector("article") ||
            document.querySelector("main") ||
            document.body;

          // A. Click "+" / "Load more comments" SVG icon buttons
          const loadMoreSvgs = Array.from(
            root.querySelectorAll("svg[aria-label]")
          );
          for (const svg of loadMoreSvgs) {
            const aria = (svg.getAttribute("aria-label") || "").trim();
            if (
              /cargar más comentarios|ver más comentarios|más comentarios|load more comments|more comments/i.test(
                aria
              )
            ) {
              const btn =
                (svg.closest('button, [role="button"]') as HTMLElement | null) ||
                (svg.parentElement as HTMLElement | null);
              if (btn) {
                btn.scrollIntoView({ block: "center" });
                btn.click();
                clicked += 1;
              }
            }
          }

          // B. Click text buttons: "Ver más comentarios", "Ver comentarios ocultos", "Ver respuestas (X)", etc.
          const clickables = Array.from(
            root.querySelectorAll('button, div[role="button"], span[role="button"], span')
          );

          for (const el of clickables) {
            // Never click anchor links (profile/post navigation)
            if (el.closest("a")) continue;

            // Avoid clicking parent containers with huge combined text; inspect compact button labels
            const rawText = (el.textContent || "").replace(/\s+/g, " ").trim();
            if (!rawText || rawText.length > 90) continue;

            // Never click "Ocultar respuestas" / "Hide replies" / "Ocultar comentarios"
            if (/\b(ocultar|hide)\b/i.test(rawText)) continue;

            const isExpandComments =
              /^(cargar|ver|mostrar)\s+(más|todos(\s+los)?)\s*(\d+\s*)?comentarios/i.test(
                rawText
              ) ||
              /^(load|view|see|show)\s+(more|all)\s*(\d+\s*)?comments/i.test(
                rawText
              );

            const isHiddenComments =
              /\b(ver|mostrar)\s+comentarios\s+ocultos\b/i.test(rawText) ||
              /\b(view|see|show)\s+hidden\s+comments\b/i.test(rawText);

            const isExpandReplies =
              /^(ver|mostrar)\s+(todas\s+las\s+)?(\d+\s+)?respuestas(\s*\(\d+\))?$/i.test(
                rawText
              ) ||
              /^(ver|mostrar)\s+\d+\s+respuestas?\s+más$/i.test(rawText) ||
              /^(view|show|see)\s+(all\s+)?(\d+\s+)?replies(\s*\(\d+\))?$/i.test(
                rawText
              ) ||
              /^(view|show|see)\s+\d+\s+more\s+replies$/i.test(rawText);

            if (isExpandComments || isHiddenComments || isExpandReplies) {
              const target =
                (el.closest('button, [role="button"]') as HTMLElement | null) ||
                (el as HTMLElement);

              // Skip if this exact element is inside another button we already clicked in this pass
              if (target.dataset.igClickedStep === "1") continue;
              target.dataset.igClickedStep = "1";

              target.scrollIntoView({ block: "center" });
              target.click();
              clicked += 1;
            }
          }

          // Clean temporary markers so dynamically updated buttons ("Ver 5 respuestas más") can be clicked again next pass
          root
            .querySelectorAll('[data-ig-clicked-step="1"]')
            .forEach((n) => n.removeAttribute("data-ig-clicked-step"));

          // C. Find the best scrollable comments container and scroll to bottom
          const candidates = Array.from(
            root.querySelectorAll("ul, div, section")
          ).filter((el) => {
            const st = window.getComputedStyle(el);
            const canScroll =
              st.overflowY === "auto" ||
              st.overflowY === "scroll" ||
              st.overflowY === "overlay";
            return (
              canScroll &&
              el.scrollHeight > el.clientHeight + 15 &&
              el.clientHeight > 120
            );
          });

          // Rank by number of comment/profile links inside so we always scroll the comments pane
          candidates.sort((a, b) => {
            const aLinks = a.querySelectorAll('a[href^="/"]').length;
            const bLinks = b.querySelectorAll('a[href^="/"]').length;
            return bLinks - aLinks || b.scrollHeight - a.scrollHeight;
          });

          let scrolled = false;
          let wheelTarget: { x: number; y: number } | null = null;

          if (candidates.length > 0) {
            const primary = candidates[0] as HTMLElement;
            const prevTop = primary.scrollTop;
            // Jiggle slightly up then to max scrollHeight to trigger IntersectionObserver sentinels
            if (primary.scrollTop > 100) {
              primary.scrollTop = primary.scrollTop - 80;
            }
            primary.scrollTop = primary.scrollHeight;
            if (Math.abs(primary.scrollTop - prevTop) > 4) {
              scrolled = true;
            }
            const rect = primary.getBoundingClientRect();
            if (rect.width > 40 && rect.height > 40) {
              wheelTarget = {
                x: Math.round(rect.left + rect.width / 2),
                y: Math.round(rect.top + rect.height / 2),
              };
            }
          } else {
            // Document-level scroll fallback
            const prevWin = window.scrollY;
            window.scrollBy(0, 1200);
            if (Math.abs(window.scrollY - prevWin) > 4) {
              scrolled = true;
            }
          }

          // D. Detect active loading spinner inside comments area
          const hasSpinner = Boolean(
            root.querySelector(
              '[role="progressbar"], svg[aria-label*="Cargando"], svg[aria-label*="Loading"]'
            )
          );

          return { clicked, scrolled, wheelTarget, hasSpinner };
        })
        .catch(() => ({
          clicked: 0,
          scrolled: false,
          wheelTarget: null,
          hasSpinner: false,
        }));

      totalClicks += uiStep.clicked;

      // Also dispatch real mouse wheel events on the comments pane so virtualized / IntersectionObserver lists fire
      if (uiStep.wheelTarget) {
        await page.mouse
          .move(uiStep.wheelTarget.x, uiStep.wheelTarget.y)
          .catch(() => {});
        await page.mouse.wheel(0, 1400).catch(() => {});
      }

      // Wait for network GraphQL pagination responses to arrive
      await page.waitForTimeout(
        uiStep.clicked > 0 || uiStep.hasSpinner ? 1350 : 900
      );

      // Periodically harvest DOM comments in case earlier rows get virtualized out
      if (step % 4 === 3) {
        await harvestDomComments(page, collected, meta);
      }

      const gainedComments = collected.size - beforeCount;
      if (
        gainedComments === 0 &&
        uiStep.clicked === 0 &&
        !uiStep.scrolled &&
        !uiStep.hasSpinner
      ) {
        idleRounds += 1;
        if (idleRounds >= 3) {
          break;
        }
      } else {
        idleRounds = 0;
      }
    }

    // Final DOM harvest pass to catch every expanded / hidden comment rendered on screen
    const domAddedAtEnd = await harvestDomComments(page, collected, meta);

    const comments = Array.from(collected.values());

    console.info(
      `[ig-scraper] shortcode=${parsed.shortcode} | total=${comments.length} | clicks=${totalClicks} | scrollPasses=${scrollPasses} | domAddedAtEnd=${domAddedAtEnd}`
    );

    if (comments.length === 0 && !session.connected) {
      return {
        postUrl: parsed.normalizedUrl,
        shortcode: parsed.shortcode,
        ownerUsername: meta.ownerUsername,
        comments: [],
        requiresAuth: true,
        warning:
          "Instagram ocultó la lista de comentarios para visitantes sin sesión. Haz clic en «Conectar Instagram» para iniciar sesión una sola vez y cargar todos los comentarios de cualquier URL.",
      };
    }

    return {
      postUrl: parsed.normalizedUrl,
      shortcode: parsed.shortcode,
      ownerUsername: meta.ownerUsername,
      comments,
      requiresAuth: false,
      warning: buildCompletenessWarning({
        readCount: comments.length,
        expectedCount: meta.expectedCount,
        sessionConnected: session.connected,
      }),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
