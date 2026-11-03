"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import {
  AlertCircle,
  Check,
  ClipboardPaste,
  Copy,
  ExternalLink,
  History,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  deduplicateParticipants,
  DEMO_COMMENTS,
  parseInstagramPostUrl,
  pickTwoWinners,
  type DrawRound,
  type Participant,
  type RawComment,
} from "@/lib/giveaway";
import { WinnerCard } from "./WinnerCard";
import { SessionModal } from "./SessionModal";
import { ManualCommentsModal } from "./ManualCommentsModal";

const GOOGLE_COLORS = ["#4285F4", "#EA4335", "#FBBC05", "#34A853"];

export function GiveawayApp() {
  // URL & scraping state
  const [urlInput, setUrlInput] = useState("");
  const [activePostUrl, setActivePostUrl] = useState<string | null>(null);
  const [postOwner, setPostOwner] = useState<string | undefined>(undefined);
  const [rawComments, setRawComments] = useState<RawComment[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchWarning, setFetchWarning] = useState<string | null>(null);
  const [requiresAuthHint, setRequiresAuthHint] = useState(false);

  // Session & modals
  const [sessionConnected, setSessionConnected] = useState(false);
  const [sessionUserId, setSessionUserId] = useState<string | undefined>();
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);

  // Giveaway rules & N-rounds state
  const [excludePostOwner, setExcludePostOwner] = useState(true);
  const [excludePreviousWinners, setExcludePreviousWinners] = useState(false);
  const [currentWinners, setCurrentWinners] = useState<
    [Participant, Participant] | null
  >(null);
  const [isRolling, setIsRolling] = useState(false);
  const [rollingPair, setRollingPair] = useState<[string, string]>([
    "...",
    "...",
  ]);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [rounds, setRounds] = useState<DrawRound[]>([]);
  const [copiedBoth, setCopiedBoth] = useState(false);

  // Bottom tabs & search
  const [activeTab, setActiveTab] = useState<"participants" | "history">(
    "participants"
  );
  const [participantQuery, setParticipantQuery] = useState("");

  const urlInputRef = useRef<HTMLInputElement>(null);

  // Check local Instagram Playwright session on mount & restore saved history
  useEffect(() => {
    fetch("/api/ig/session")
      .then((r) => r.json())
      .then((data) => {
        if (typeof data?.connected === "boolean") {
          setSessionConnected(data.connected);
          setSessionUserId(data.userId);
        }
      })
      .catch(() => {});

    try {
      const saved = localStorage.getItem("sorteo-ig-rounds");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setRounds(parsed);
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("sorteo-ig-rounds", JSON.stringify(rounds));
    } catch {
      // Ignore storage errors
    }
  }, [rounds]);

  // Unique participants (1 user = 1 vote regardless of comment count)
  const uniqueParticipants = useMemo(() => {
    return deduplicateParticipants(rawComments, {
      excludeUsername: excludePostOwner ? postOwner : undefined,
    });
  }, [rawComments, excludePostOwner, postOwner]);

  const duplicateCommentsRemoved = Math.max(
    0,
    rawComments.length - uniqueParticipants.length
  );

  // Rounds belonging to the currently active post
  const currentPostRounds = useMemo(() => {
    if (!activePostUrl) return [];
    return rounds.filter((r) => r.postUrl === activePostUrl);
  }, [rounds, activePostUrl]);

  const previousWinnerUsernamesForPost = useMemo(() => {
    const set = new Set<string>();
    for (const r of currentPostRounds) {
      set.add(r.winners[0].normalizedUsername);
      set.add(r.winners[1].normalizedUsername);
    }
    return Array.from(set);
  }, [currentPostRounds]);

  const eligibleRemainingCount = useMemo(() => {
    if (!excludePreviousWinners) return uniqueParticipants.length;
    const prevSet = new Set(previousWinnerUsernamesForPost);
    return uniqueParticipants.filter((p) => !prevSet.has(p.normalizedUsername))
      .length;
  }, [
    uniqueParticipants,
    excludePreviousWinners,
    previousWinnerUsernamesForPost,
  ]);

  const filteredParticipants = useMemo(() => {
    const q = participantQuery.trim().replace(/^@+/, "").toLowerCase();
    if (!q) return uniqueParticipants;
    return uniqueParticipants.filter(
      (p) =>
        p.normalizedUsername.includes(q) ||
        (p.fullName && p.fullName.toLowerCase().includes(q)) ||
        p.comments.some((c) => c.toLowerCase().includes(q))
    );
  }, [uniqueParticipants, participantQuery]);

  function fireGoogleConfetti() {
    confetti({
      particleCount: 65,
      spread: 70,
      origin: { y: 0.62 },
      colors: GOOGLE_COLORS,
      disableForReducedMotion: true,
    });
  }

  async function handleFetchComments(e?: React.FormEvent) {
    e?.preventDefault();
    setFetchError(null);
    setDrawError(null);
    setRequiresAuthHint(false);

    const parsed = parseInstagramPostUrl(urlInput);
    if (!parsed.isValid) {
      setFetchError(
        "Ingresa un enlace válido de una publicación o reel de Instagram (ej. https://www.instagram.com/p/CODIGO/)."
      );
      return;
    }

    // Drop the previous post so a failed load can't draw from the wrong comments
    setRawComments([]);
    setActivePostUrl(null);
    setPostOwner(undefined);
    setCurrentWinners(null);
    setFetchWarning(null);

    setIsLoadingComments(true);
    try {
      const res = await fetch("/api/ig/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: parsed.normalizedUrl }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Error al obtener los comentarios.");
      }

      if (data.requiresAuth || (data.comments?.length ?? 0) === 0) {
        setRequiresAuthHint(Boolean(data.requiresAuth));
        setFetchError(
          data.warning ||
            "No se encontraron comentarios públicos en esta publicación."
        );
        return;
      }

      setRawComments(data.comments);
      setActivePostUrl(data.postUrl || parsed.normalizedUrl);
      setPostOwner(data.ownerUsername);
      setFetchWarning(data.warning || null);
      setParticipantQuery("");
    } catch (err) {
      setFetchError(
        err instanceof Error
          ? err.message
          : "No se pudieron obtener los comentarios."
      );
    } finally {
      setIsLoadingComments(false);
    }
  }

  function handleLoadDemo() {
    setFetchError(null);
    setFetchWarning(null);
    setDrawError(null);
    setRequiresAuthHint(false);
    const demoUrl = "https://www.instagram.com/p/DEMO-GOOGLE-DEV/";
    setUrlInput(demoUrl);
    setActivePostUrl(demoUrl);
    setPostOwner(undefined);
    setRawComments(DEMO_COMMENTS);
    setCurrentWinners(null);
    setParticipantQuery("");
  }

  function handleManualImport(comments: RawComment[], labelUrl: string) {
    setFetchError(null);
    setFetchWarning(null);
    setDrawError(null);
    setRequiresAuthHint(false);
    setUrlInput(labelUrl.startsWith("http") ? labelUrl : "");
    setActivePostUrl(labelUrl);
    setPostOwner(undefined);
    setRawComments(comments);
    setCurrentWinners(null);
    setParticipantQuery("");
  }

  function handleRunGiveaway() {
    if (isRolling) return;
    setDrawError(null);

    try {
      const { winners, eligiblePoolSize } = pickTwoWinners(uniqueParticipants, {
        excludedUsernames: excludePreviousWinners
          ? previousWinnerUsernamesForPost
          : [],
      });

      setIsRolling(true);

      // Animate rolling names from uniqueParticipants for 1.35s
      const names = uniqueParticipants.map((p) => p.username);
      let tick = 0;
      const interval = setInterval(() => {
        tick += 1;
        const a = names[(tick * 3) % names.length] || winners[0].username;
        const b = names[(tick * 7 + 1) % names.length] || winners[1].username;
        setRollingPair([a, b]);
      }, 75);

      setTimeout(() => {
        clearInterval(interval);
        setIsRolling(false);
        setCurrentWinners(winners);

        const newRound: DrawRound = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          roundNumber: currentPostRounds.length + 1,
          postUrl: activePostUrl || "Publicación de Instagram",
          createdAt: new Date().toISOString(),
          winners,
          eligibleCount: eligiblePoolSize,
        };

        setRounds((prev) => [newRound, ...prev]);
        fireGoogleConfetti();
      }, 1350);
    } catch (err) {
      setDrawError(
        err instanceof Error
          ? err.message
          : "No hay suficientes participantes elegibles."
      );
    }
  }

  async function handleCopyBothWinners() {
    if (!currentWinners) return;
    const text = `Ganadores del sorteo:\n1. @${currentWinners[0].username}\n2. @${currentWinners[1].username}`;
    await navigator.clipboard.writeText(text);
    setCopiedBoth(true);
    setTimeout(() => setCopiedBoth(false), 2000);
  }

  function handleResetForNewUrl() {
    setUrlInput("");
    setFetchError(null);
    setDrawError(null);
    urlInputRef.current?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const allWinnerUsernamesSet = useMemo(() => {
    const s = new Set<string>();
    for (const r of currentPostRounds) {
      s.add(r.winners[0].normalizedUsername);
      s.add(r.winners[1].normalizedUsername);
    }
    return s;
  }, [currentPostRounds]);

  return (
    <div className="flex min-h-dvh flex-col bg-white text-[#202124]">
      {/* Subtle 4-color Google top bar */}
      <div className="grid h-1 w-full grid-cols-4">
        <div className="bg-[#4285F4]" />
        <div className="bg-[#EA4335]" />
        <div className="bg-[#FBBC05]" />
        <div className="bg-[#34A853]" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-[#DADCE0]/60 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <div
              className="flex items-center gap-1"
              aria-hidden="true"
              title="Paleta Google"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-[#4285F4]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#EA4335]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#FBBC05]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#34A853]" />
            </div>
            <span className="text-base font-bold tracking-tight text-[#202124] sm:text-lg">
              Sorteo <span className="text-[#4285F4]">I</span>
              <span className="text-[#EA4335]">G</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setManualModalOpen(true)}
              className="hidden items-center gap-1.5 rounded-full border border-[#DADCE0] bg-white px-3.5 py-1.5 text-xs font-medium text-[#5F6368] transition hover:bg-[#F8F9FA] hover:text-[#202124] sm:inline-flex"
            >
              <ClipboardPaste className="h-3.5 w-3.5 text-[#4285F4]" />
              Importar lista
            </button>

            <button
              type="button"
              onClick={() => setSessionModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-[#DADCE0] bg-white px-3.5 py-1.5 text-xs font-medium text-[#202124] transition hover:bg-[#F8F9FA]"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  sessionConnected ? "bg-[#34A853]" : "bg-[#FBBC05]"
                }`}
              />
              <span>
                {sessionConnected ? "IG conectado" : "Conectar Instagram"}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        {/* Hero + URL Control */}
        <section className="mx-auto max-w-3xl text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#DADCE0] bg-[#F8F9FA] px-3.5 py-1 text-xs font-medium text-[#5F6368]">
            <span className="h-2 w-2 rounded-full bg-[#34A853]" />2 ganadores
            únicos · 1 voto por persona
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-[#202124] sm:text-4xl lg:text-[42px] lg:leading-tight">
            Elige <span className="text-[#4285F4]">dos ganadores</span> de
            cualquier publicación de Instagram
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[#5F6368] sm:text-base">
            Pega el enlace del post o reel. Si una persona comentó varias veces,
            su participación cuenta{" "}
            <strong className="font-semibold text-[#202124]">
              una sola vez
            </strong>
            . Ejecuta la dinámica cuantas veces quieras.
          </p>

          {/* Google-Search-inspired URL Input Bar */}
          <form onSubmit={handleFetchComments} className="mt-7">
            <div className="flex flex-col gap-2.5 rounded-3xl border border-[#DADCE0] bg-white p-2 shadow-sm transition focus-within:border-[#4285F4] focus-within:shadow-md sm:flex-row sm:items-center sm:rounded-full sm:pl-4">
              <div className="flex flex-1 items-center gap-2.5 px-2 py-1.5 sm:px-0 sm:py-0">
                <Link2 className="h-5 w-5 shrink-0 text-[#4285F4]" />
                <input
                  ref={urlInputRef}
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://www.instagram.com/p/..."
                  aria-label="URL de la publicación de Instagram"
                  className="w-full bg-transparent text-base text-[#202124] placeholder-[#5F6368]/70 outline-none sm:text-sm"
                />
                {urlInput && (
                  <button
                    type="button"
                    onClick={() => setUrlInput("")}
                    className="rounded-full p-1 text-[#5F6368] transition hover:bg-[#F8F9FA] hover:text-[#202124]"
                    aria-label="Limpiar URL"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={isLoadingComments}
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#4285F4] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#3367D6] disabled:opacity-60 sm:rounded-full"
              >
                {isLoadingComments ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando comentarios...
                  </>
                ) : (
                  "Obtener comentarios"
                )}
              </button>
            </div>

            {/* Animated 4-color Google loading bar */}
            {isLoadingComments && (
              <div className="mx-auto mt-3 h-1 max-w-md overflow-hidden rounded-full bg-[#F8F9FA]">
                <div className="animate-google-progress grid h-full w-full grid-cols-4">
                  <div className="bg-[#4285F4]" />
                  <div className="bg-[#EA4335]" />
                  <div className="bg-[#FBBC05]" />
                  <div className="bg-[#34A853]" />
                </div>
              </div>
            )}
          </form>

          {/* Quick Secondary Actions */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-[#5F6368]">
            <button
              type="button"
              onClick={handleLoadDemo}
              className="inline-flex items-center gap-1.5 font-medium text-[#4285F4] hover:underline"
            >
              <Sparkles className="h-3.5 w-3.5 text-[#FBBC05]" />
              Probar con publicación de ejemplo
            </button>
            <span className="hidden text-[#DADCE0] sm:inline">•</span>
            <button
              type="button"
              onClick={() => setManualModalOpen(true)}
              className="inline-flex items-center gap-1.5 font-medium text-[#5F6368] hover:text-[#202124] hover:underline"
            >
              <ClipboardPaste className="h-3.5 w-3.5 text-[#34A853]" />
              Pegar comentarios manualmente
            </button>
          </div>

          {/* Fetch Error / Auth Prompt */}
          {fetchError && (
            <div className="mt-5 rounded-2xl border border-[#EA4335]/35 bg-[#EA4335]/5 p-4 text-left">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#EA4335]" />
                <div className="flex-1 text-sm">
                  <p className="font-medium text-[#202124]">{fetchError}</p>
                  {requiresAuthHint && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSessionModalOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#4285F4] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#3367D6]"
                      >
                        Conectar Instagram ahora
                      </button>
                      <button
                        type="button"
                        onClick={() => setManualModalOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[#DADCE0] bg-white px-4 py-2 text-xs font-medium text-[#202124] transition hover:bg-[#F8F9FA]"
                      >
                        O pegar lista manual
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Loaded Post + Giveaway Stage */}
        {rawComments.length > 0 && (
          <section className="mt-10 space-y-8">
            {/* Incomplete comment list warning */}
            {fetchWarning && (
              <div
                role="status"
                className="flex items-start gap-3 rounded-2xl border border-[#FBBC05]/60 bg-[#FBBC05]/10 p-4 text-sm font-medium text-[#202124]"
              >
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#FBBC05]" />
                <div className="flex-1">
                  <p>{fetchWarning}</p>
                  {!sessionConnected && (
                    <button
                      type="button"
                      onClick={() => setSessionModalOpen(true)}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#4285F4] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#3367D6]"
                    >
                      Conectar Instagram ahora
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Metrics & Active URL Banner */}
            <div className="rounded-3xl border border-[#DADCE0] bg-[#F8F9FA] p-5 sm:p-6">
              <div className="flex flex-col justify-between gap-3 border-b border-[#DADCE0]/70 pb-4 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wider text-[#5F6368]">
                    Publicación activa
                  </p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-[#202124]">
                      {activePostUrl}
                    </p>
                    {activePostUrl?.startsWith("http") && (
                      <a
                        href={activePostUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-[#4285F4] hover:opacity-80"
                        aria-label="Abrir publicación en Instagram"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleResetForNewUrl}
                  className="inline-flex self-start rounded-full border border-[#DADCE0] bg-white px-3.5 py-1.5 text-xs font-medium text-[#202124] transition hover:bg-[#F8F9FA] sm:self-auto"
                >
                  Cargar otra URL
                </button>
              </div>

              {/* 3 Stat Cards in Google Palette */}
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-[#DADCE0]/80 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[#5F6368]">
                      Comentarios leídos
                    </span>
                    <span className="h-2.5 w-2.5 rounded-full bg-[#4285F4]" />
                  </div>
                  <p className="mt-1.5 text-2xl font-bold text-[#202124]">
                    {rawComments.length}
                  </p>
                </div>

                <div className="rounded-2xl border border-[#DADCE0]/80 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[#5F6368]">
                      Usuarios únicos (1 voto c/u)
                    </span>
                    <span className="h-2.5 w-2.5 rounded-full bg-[#34A853]" />
                  </div>
                  <p className="mt-1.5 text-2xl font-bold text-[#34A853]">
                    {uniqueParticipants.length}
                  </p>
                </div>

                <div className="rounded-2xl border border-[#DADCE0]/80 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[#5F6368]">
                      Votos duplicados filtrados
                    </span>
                    <span className="h-2.5 w-2.5 rounded-full bg-[#EA4335]" />
                  </div>
                  <p className="mt-1.5 text-2xl font-bold text-[#202124]">
                    {duplicateCommentsRemoved}
                  </p>
                </div>
              </div>

              {/* Rule Toggles */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-[#5F6368]">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex cursor-pointer items-center gap-2 select-none">
                    <input
                      type="checkbox"
                      checked={excludePreviousWinners}
                      onChange={(e) =>
                        setExcludePreviousWinners(e.target.checked)
                      }
                      className="h-4 w-4 rounded border-[#DADCE0] accent-[#4285F4]"
                    />
                    <span className="font-medium text-[#202124]">
                      No repetir ganadores de rondas previas ({eligibleRemainingCount}{" "}
                      elegibles)
                    </span>
                  </label>

                  {postOwner && (
                    <label className="inline-flex cursor-pointer items-center gap-2 select-none">
                      <input
                        type="checkbox"
                        checked={excludePostOwner}
                        onChange={(e) => setExcludePostOwner(e.target.checked)}
                        className="h-4 w-4 rounded border-[#DADCE0] accent-[#4285F4]"
                      />
                      <span>Excluir autor (@{postOwner})</span>
                    </label>
                  )}
                </div>

                <span>
                  Rondas realizadas en este post:{" "}
                  <strong className="text-[#202124]">
                    {currentPostRounds.length}
                  </strong>
                </span>
              </div>
            </div>

            {/* Primary Draw Trigger (Run N Times) */}
            <div className="flex flex-col items-center text-center">
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleRunGiveaway}
                  disabled={isRolling || uniqueParticipants.length < 2}
                  className="inline-flex min-h-13 items-center justify-center gap-2.5 rounded-full bg-[#34A853] px-8 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-[#2d9249] active:scale-[0.99] disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-5 w-5 ${isRolling ? "animate-spin" : ""}`}
                  />
                  {isRolling
                    ? "Seleccionando 2 ganadores..."
                    : currentWinners
                      ? `Volver a sortear (Ronda #${currentPostRounds.length + 1})`
                      : "Elegir 2 ganadores"}
                </button>

                {currentWinners && !isRolling && (
                  <button
                    type="button"
                    onClick={handleCopyBothWinners}
                    className="inline-flex min-h-13 items-center justify-center gap-2 rounded-full border border-[#DADCE0] bg-white px-5 py-3.5 text-sm font-medium text-[#202124] transition hover:bg-[#F8F9FA]"
                  >
                    {copiedBoth ? (
                      <>
                        <Check className="h-4 w-4 text-[#34A853]" />
                        Ganadores copiados
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 text-[#4285F4]" />
                        Copiar ambos usuarios
                      </>
                    )}
                  </button>
                )}
              </div>

              {drawError && (
                <p className="mt-3 rounded-full border border-[#EA4335]/30 bg-[#EA4335]/5 px-4 py-1.5 text-xs font-medium text-[#EA4335]">
                  {drawError}
                </p>
              )}
            </div>

            {/* 2 Winner Cards Grid (1 col mobile, 2 cols tablet & desktop) */}
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <WinnerCard
                slot={1}
                participant={currentWinners ? currentWinners[0] : null}
                rollingUsername={rollingPair[0]}
                isRolling={isRolling}
              />
              <WinnerCard
                slot={2}
                participant={currentWinners ? currentWinners[1] : null}
                rollingUsername={rollingPair[1]}
                isRolling={isRolling}
              />
            </div>

            {/* Participants & N-Rounds History Section */}
            <div className="overflow-hidden rounded-3xl border border-[#DADCE0] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DADCE0] bg-[#F8F9FA] px-4 py-3 sm:px-6">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab("participants")}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition sm:text-sm ${
                      activeTab === "participants"
                        ? "bg-[#4285F4] text-white"
                        : "text-[#5F6368] hover:bg-white hover:text-[#202124]"
                    }`}
                  >
                    <Users className="h-4 w-4" />
                    Participantes únicos ({uniqueParticipants.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab("history")}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition sm:text-sm ${
                      activeTab === "history"
                        ? "bg-[#4285F4] text-white"
                        : "text-[#5F6368] hover:bg-white hover:text-[#202124]"
                    }`}
                  >
                    <History className="h-4 w-4" />
                    Historial de sorteos ({rounds.length})
                  </button>
                </div>

                {activeTab === "participants" && (
                  <div className="relative w-full sm:w-64">
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#5F6368]" />
                    <input
                      type="text"
                      value={participantQuery}
                      onChange={(e) => setParticipantQuery(e.target.value)}
                      placeholder="Buscar @usuario..."
                      className="w-full rounded-full border border-[#DADCE0] bg-white py-1.5 pr-3 pl-9 text-xs text-[#202124] outline-none focus:border-[#4285F4]"
                    />
                  </div>
                )}

                {activeTab === "history" && rounds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setRounds([])}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#DADCE0] bg-white px-3 py-1.5 text-xs font-medium text-[#EA4335] transition hover:bg-[#EA4335]/5"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Limpiar historial
                  </button>
                )}
              </div>

              {activeTab === "participants" ? (
                <div className="max-h-96 divide-y divide-[#DADCE0]/60 overflow-y-auto">
                  {filteredParticipants.length === 0 ? (
                    <p className="p-8 text-center text-sm text-[#5F6368]">
                      No se encontraron participantes con ese filtro.
                    </p>
                  ) : (
                    filteredParticipants.map((p, idx) => {
                      const dotColor = GOOGLE_COLORS[idx % GOOGLE_COLORS.length];
                      const hasWon = allWinnerUsernamesSet.has(
                        p.normalizedUsername
                      );
                      return (
                        <div
                          key={p.normalizedUsername}
                          className="flex flex-col justify-between gap-2 px-4 py-3.5 transition hover:bg-[#F8F9FA]/60 sm:flex-row sm:items-center sm:px-6"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: dotColor }}
                              />
                              <a
                                href={`https://www.instagram.com/${p.username}/`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="truncate text-sm font-semibold text-[#202124] hover:text-[#4285F4] hover:underline"
                              >
                                @{p.username}
                              </a>
                              {hasWon && (
                                <span className="rounded-full bg-[#FBBC05]/20 px-2 py-0.5 text-[11px] font-semibold text-[#202124]">
                                  Ganador
                                </span>
                              )}
                            </div>
                            {p.comments[0] && (
                              <p className="mt-0.5 truncate pl-4 text-xs text-[#5F6368]">
                                {p.comments[0]}
                              </p>
                            )}
                          </div>

                          <div className="flex shrink-0 items-center gap-2 pl-4 sm:pl-0">
                            {p.commentCount > 1 && (
                              <span className="rounded-full bg-[#F8F9FA] px-2.5 py-0.5 text-[11px] text-[#5F6368]">
                                {p.commentCount} comentarios
                              </span>
                            )}
                            <span className="rounded-full border border-[#34A853]/30 bg-[#34A853]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#34A853]">
                              1 voto
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                <div className="max-h-96 divide-y divide-[#DADCE0]/60 overflow-y-auto">
                  {rounds.length === 0 ? (
                    <p className="p-8 text-center text-sm text-[#5F6368]">
                      Aún no has ejecutado ningún sorteo. Haz clic en «Elegir 2
                      ganadores».
                    </p>
                  ) : (
                    rounds.map((r) => (
                      <div
                        key={r.id}
                        className="flex flex-col justify-between gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-6"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-[#4285F4]/10 px-2.5 py-0.5 text-xs font-bold text-[#4285F4]">
                              Ronda #{r.roundNumber}
                            </span>
                            <span className="text-xs text-[#5F6368]">
                              {new Date(r.createdAt).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              })}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-xs text-[#5F6368]">
                            {r.postUrl}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#4285F4]/30 bg-[#4285F4]/5 px-3 py-1 text-xs font-semibold text-[#202124]">
                            <span className="h-2 w-2 rounded-full bg-[#4285F4]" />
                            @{r.winners[0].username}
                          </span>
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#34A853]/30 bg-[#34A853]/5 px-3 py-1 text-xs font-semibold text-[#202124]">
                            <span className="h-2 w-2 rounded-full bg-[#34A853]" />
                            @{r.winners[1].username}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Standalone History Section if user has previous rounds before loading a new URL */}
        {rawComments.length === 0 && rounds.length > 0 && (
          <section className="mx-auto mt-12 max-w-3xl">
            <div className="flex items-center justify-between pb-3">
              <h2 className="text-sm font-semibold text-[#202124]">
                Sorteos recientes ({rounds.length})
              </h2>
              <button
                type="button"
                onClick={() => setRounds([])}
                className="text-xs font-medium text-[#EA4335] hover:underline"
              >
                Limpiar historial
              </button>
            </div>
            <div className="divide-y divide-[#DADCE0]/70 overflow-hidden rounded-2xl border border-[#DADCE0] bg-white">
              {rounds.slice(0, 5).map((r) => (
                <div
                  key={r.id}
                  className="flex flex-col justify-between gap-2 px-4 py-3.5 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-[#4285F4]">
                      Ronda #{r.roundNumber}
                    </span>
                    <p className="truncate text-xs text-[#5F6368]">{r.postUrl}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-semibold">
                    <span className="rounded-full bg-[#4285F4]/10 px-3 py-1 text-[#202124]">
                      @{r.winners[0].username}
                    </span>
                    <span className="rounded-full bg-[#34A853]/10 px-3 py-1 text-[#202124]">
                      @{r.winners[1].username}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Minimal Footer */}
      <footer className="border-t border-[#DADCE0]/60 bg-[#F8F9FA] py-5">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-4 text-xs text-[#5F6368] sm:flex-row sm:px-6 lg:px-8">
          <p>
            Selección aleatoria criptográfica · 1 usuario único = 1 voto · 2
            ganadores distintos
          </p>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#4285F4]" />
            <span className="h-2 w-2 rounded-full bg-[#EA4335]" />
            <span className="h-2 w-2 rounded-full bg-[#FBBC05]" />
            <span className="h-2 w-2 rounded-full bg-[#34A853]" />
          </div>
        </div>
      </footer>

      <SessionModal
        open={sessionModalOpen}
        connected={sessionConnected}
        userId={sessionUserId}
        onClose={() => setSessionModalOpen(false)}
        onStatusChange={(st) => {
          setSessionConnected(st.connected);
          setSessionUserId(st.userId);
        }}
      />

      <ManualCommentsModal
        open={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
        onImport={handleManualImport}
      />
    </div>
  );
}
