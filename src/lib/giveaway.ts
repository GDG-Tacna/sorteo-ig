export interface RawComment {
  id: string;
  username: string;
  fullName?: string;
  text: string;
  avatarUrl?: string;
  timestamp?: string;
}

export interface Participant {
  username: string;
  normalizedUsername: string;
  fullName?: string;
  avatarUrl?: string;
  comments: string[];
  commentCount: number;
}

export interface DrawRound {
  id: string;
  roundNumber: number;
  postUrl: string;
  createdAt: string;
  winners: [Participant, Participant];
  eligibleCount: number;
}

export interface ParsedInstagramUrl {
  isValid: boolean;
  normalizedUrl: string;
  shortcode: string | null;
  kind: "p" | "reel" | "tv" | null;
}

const RESERVED_IG_PATHS = new Set([
  "explore",
  "accounts",
  "direct",
  "stories",
  "reels",
  "p",
  "tv",
  "about",
  "legal",
  "developer",
  "reel",
]);

/**
 * Parses and normalizes any public Instagram post/reel/tv URL.
 * Supports both `instagram.com/p/CODE` and `instagram.com/user/p/CODE`.
 */
export function parseInstagramPostUrl(input: string): ParsedInstagramUrl {
  const trimmed = input.trim();
  if (!trimmed) {
    return { isValid: false, normalizedUrl: "", shortcode: null, kind: null };
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    const host = url.hostname.toLowerCase();
    if (
      host !== "instagram.com" &&
      host !== "www.instagram.com" &&
      host !== "m.instagram.com"
    ) {
      return { isValid: false, normalizedUrl: "", shortcode: null, kind: null };
    }

    const segments = url.pathname.split("/").filter(Boolean);
    // Patterns:
    // 1. /p/{shortcode} | /reel/{shortcode} | /reels/{shortcode} | /tv/{shortcode}
    // 2. /{username}/p/{shortcode} | /{username}/reel/{shortcode}
    let kindRaw: string | undefined;
    let shortcode: string | undefined;

    if (
      segments.length >= 2 &&
      ["p", "reel", "reels", "tv"].includes(segments[0].toLowerCase())
    ) {
      kindRaw = segments[0].toLowerCase();
      shortcode = segments[1];
    } else if (
      segments.length >= 3 &&
      ["p", "reel", "reels", "tv"].includes(segments[1].toLowerCase())
    ) {
      kindRaw = segments[1].toLowerCase();
      shortcode = segments[2];
    }

    if (!kindRaw || !shortcode || !/^[A-Za-z0-9_-]{5,40}$/.test(shortcode)) {
      return { isValid: false, normalizedUrl: "", shortcode: null, kind: null };
    }

    const kind: "p" | "reel" | "tv" =
      kindRaw === "reels" ? "reel" : (kindRaw as "p" | "reel" | "tv");

    return {
      isValid: true,
      normalizedUrl: `https://www.instagram.com/${kind}/${shortcode}/`,
      shortcode,
      kind,
    };
  } catch {
    return { isValid: false, normalizedUrl: "", shortcode: null, kind: null };
  }
}

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

export function isValidIgUsername(raw: string): boolean {
  const clean = normalizeUsername(raw);
  if (!clean || clean.length > 30) return false;
  if (RESERVED_IG_PATHS.has(clean)) return false;
  return /^[a-z0-9._]+$/.test(clean);
}

/**
 * Deduplicates comments by user so each person gets strictly 1 vote/entry
 * regardless of how many comments they posted.
 */
export function deduplicateParticipants(
  comments: RawComment[],
  options?: { excludeUsername?: string }
): Participant[] {
  const excluded = options?.excludeUsername
    ? normalizeUsername(options.excludeUsername)
    : null;

  const map = new Map<string, Participant>();

  for (const item of comments) {
    const cleanDisplay = item.username.trim().replace(/^@+/, "");
    const normalized = normalizeUsername(cleanDisplay);

    if (!isValidIgUsername(normalized)) continue;
    if (excluded && normalized === excluded) continue;

    const commentText = item.text?.trim() || "";
    const existing = map.get(normalized);

    if (!existing) {
      map.set(normalized, {
        username: cleanDisplay,
        normalizedUsername: normalized,
        fullName: item.fullName?.trim() || undefined,
        avatarUrl: item.avatarUrl || undefined,
        comments: commentText ? [commentText] : [],
        commentCount: 1,
      });
    } else {
      existing.commentCount += 1;
      if (commentText) {
        existing.comments.push(commentText);
      }
      if (!existing.fullName && item.fullName?.trim()) {
        existing.fullName = item.fullName.trim();
      }
      if (!existing.avatarUrl && item.avatarUrl) {
        existing.avatarUrl = item.avatarUrl;
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Explains why the extracted comments may not be the full list, since drawing
 * from a partial list would silently leave real participants out.
 */
export function buildCompletenessWarning(input: {
  readCount: number;
  expectedCount?: number;
  sessionConnected: boolean;
}): string | undefined {
  const { readCount, expectedCount, sessionConnected } = input;
  if (readCount === 0) return undefined;

  const isShort = expectedCount !== undefined && readCount < expectedCount;

  if (!sessionConnected) {
    const readSummary = isShort
      ? `Se leyeron ${readCount} de los ${expectedCount} comentarios que reporta Instagram. `
      : "";
    return `${readSummary}Sin sesión, Instagram solo muestra una parte de los comentarios y puede faltar gente. Conecta Instagram y vuelve a cargar antes de hacer un sorteo real.`;
  }

  if (isShort) {
    return `Se leyeron ${readCount} de los ${expectedCount} comentarios que reporta Instagram. La diferencia puede deberse a comentarios ocultos o a un límite de Instagram: si es grande, vuelve a cargar antes de sortear.`;
  }

  return undefined;
}

function getCryptoRandomInt(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0;
  const array = new Uint32Array(1);
  // Rejection sampling to avoid modulo bias
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  let value = 0;
  do {
    crypto.getRandomValues(array);
    value = array[0];
  } while (value >= limit);
  return value % maxExclusive;
}

/**
 * Selects strictly 2 distinct participants with uniform probability (1 ticket per unique user).
 */
export function pickTwoWinners(
  participants: Participant[],
  options?: { excludedUsernames?: string[] }
): { winners: [Participant, Participant]; eligiblePoolSize: number } {
  const excludedSet = new Set(
    (options?.excludedUsernames ?? []).map((u) => normalizeUsername(u))
  );

  // Extra safety pass to guarantee uniqueness by normalizedUsername
  const seen = new Set<string>();
  const eligible: Participant[] = [];

  for (const p of participants) {
    const key = normalizeUsername(p.username);
    if (!seen.has(key) && !excludedSet.has(key)) {
      seen.add(key);
      eligible.push(p);
    }
  }

  if (eligible.length < 2) {
    throw new Error(
      `Se necesitan al menos 2 participantes únicos elegibles para el sorteo (actualmente hay ${eligible.length}).`
    );
  }

  // Partial Fisher-Yates shuffle for first 2 positions
  const pool = [...eligible];
  for (let i = 0; i < 2; i++) {
    const j = i + getCryptoRandomInt(pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return {
    winners: [pool[0], pool[1]],
    eligiblePoolSize: eligible.length,
  };
}

/**
 * Parses pasted comments in JSON, CSV, "@user: comentario", or plain username lines.
 */
export function parseManualCommentsInput(rawText: string): RawComment[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  // 1. Try JSON format
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.comments)
          ? parsed.comments
          : [];
      const out: RawComment[] = [];
      list.forEach((entry: Record<string, unknown>, idx: number) => {
        const rawUser =
          (typeof entry.username === "string" && entry.username) ||
          (typeof entry.ownerUsername === "string" && entry.ownerUsername) ||
          (entry.user &&
          typeof (entry.user as Record<string, unknown>).username === "string"
            ? ((entry.user as Record<string, unknown>).username as string)
            : "");
        const text =
          (typeof entry.text === "string" && entry.text) ||
          (typeof entry.comment === "string" && entry.comment) ||
          "";
        if (rawUser && isValidIgUsername(rawUser)) {
          out.push({
            id: `manual-json-${idx}`,
            username: rawUser.trim().replace(/^@+/, ""),
            text,
          });
        }
      });
      if (out.length > 0) return out;
    } catch {
      // Fall through to line-by-line parsing
    }
  }

  // 2. Line-by-line parsing ("@usuario: comentario", "usuario,comentario", "@usuario")
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const results: RawComment[] = [];

  lines.forEach((line, idx) => {
    // Skip obvious CSV header row
    if (
      idx === 0 &&
      /^(username|usuario|user)[,;\t](comment|comentario|text)/i.test(line)
    ) {
      return;
    }

    // Match: @username : comment | @username - comment | username, comment | @username
    const match = line.match(
      /^@?([a-zA-Z0-9._]{1,30})(?:\s*[:\-–,;|\t]\s*(.*))?$/
    );
    if (match && isValidIgUsername(match[1])) {
      results.push({
        id: `manual-line-${idx}`,
        username: match[1],
        text: match[2]?.trim() || "Participando en la dinámica",
      });
    }
  });

  return results;
}

export const DEMO_COMMENTS: RawComment[] = [
  { id: "d1", username: "camila.dev", fullName: "Camila Rojas", text: "¡Participando! Me encanta el contenido 🔥" },
  { id: "d2", username: "mateo_codes", fullName: "Mateo Silva", text: "¡Quiero ganar! Éxitos a todos 🙌" },
  { id: "d3", username: "camila.dev", fullName: "Camila Rojas", text: "Segundo comentario por si acaso jaja ✨" },
  { id: "d4", username: "valeria.ux", fullName: "Valeria Mendoza", text: "Increíble iniciativa, apuntadísima 💙" },
  { id: "d5", username: "diego.cloud", fullName: "Diego Herrera", text: "¡Vamos con toda! 🚀" },
  { id: "d6", username: "sofia.data", fullName: "Sofía Vargas", text: "Qué buena dinámica, participo 🎯" },
  { id: "d7", username: "mateo_codes", fullName: "Mateo Silva", text: "Etiquetando a @diego.cloud 👀" },
  { id: "d8", username: "mateo_codes", fullName: "Mateo Silva", text: "Tercer comentario de prueba 💪" },
  { id: "d9", username: "lucas.frontend", fullName: "Lucas Paredes", text: "¡Yo quiero uno de los cupos!" },
  { id: "d10", username: "andrea_ai", fullName: "Andrea Castro", text: "Excelente post, participando 🌟" },
  { id: "d11", username: "nicolas.js", fullName: "Nicolás Ortiz", text: "Presente desde Perú 🇵🇪" },
  { id: "d12", username: "mariana.pm", fullName: "Mariana Gómez", text: "¡Ojalá salga elegida! 🍀" },
  { id: "d13", username: "valeria.ux", fullName: "Valeria Mendoza", text: "¡Súper recomendado!" },
  { id: "d14", username: "gabriel.rust", fullName: "Gabriel León", text: "Participando ando 🔥🔥" },
  { id: "d15", username: "paula.design", fullName: "Paula Morales", text: "Me sumo al sorteo ✨" },
  { id: "d16", username: "sebastian.go", fullName: "Sebastián Cruz", text: "¡Qué genial! Aquí mi comentario 🙌" },
];
