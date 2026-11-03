"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Chrome,
  KeyRound,
  Loader2,
  LogOut,
  ShieldCheck,
  X,
} from "lucide-react";

interface SessionModalProps {
  open: boolean;
  connected: boolean;
  userId?: string;
  onClose: () => void;
  onStatusChange: (status: { connected: boolean; userId?: string }) => void;
}

export function SessionModal({
  open,
  connected,
  userId,
  onClose,
  onStatusChange,
}: SessionModalProps) {
  const [loadingBrowser, setLoadingBrowser] = useState(false);
  const [loadingCookie, setLoadingCookie] = useState(false);
  const [showCookieInput, setShowCookieInput] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleBrowserLogin() {
    setError(null);
    setLoadingBrowser(true);
    try {
      const res = await fetch("/api/ig/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "browser-login" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "No se pudo iniciar sesión.");
      }
      onStatusChange(data);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al abrir el navegador."
      );
    } finally {
      setLoadingBrowser(false);
    }
  }

  async function handleCookieSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoadingCookie(true);
    try {
      const res = await fetch("/api/ig/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cookie", sessionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Cookie no válida.");
      }
      setSessionId("");
      onStatusChange(data);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al guardar la cookie."
      );
    } finally {
      setLoadingCookie(false);
    }
  }

  async function handleDisconnect() {
    setError(null);
    try {
      await fetch("/api/ig/session", { method: "DELETE" });
      onStatusChange({ connected: false });
      onClose();
    } catch {
      setError("No se pudo desconectar la sesión.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-modal-title"
    >
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-[#DADCE0] bg-white shadow-xl">
        {/* 4-color Google top accent */}
        <div className="grid h-1.5 w-full grid-cols-4">
          <div className="bg-[#4285F4]" />
          <div className="bg-[#EA4335]" />
          <div className="bg-[#FBBC05]" />
          <div className="bg-[#34A853]" />
        </div>

        <div className="p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2
                id="session-modal-title"
                className="text-lg font-semibold text-[#202124] sm:text-xl"
              >
                Conexión local con Instagram
              </h2>
              <p className="mt-1 text-sm text-[#5F6368]">
                Instagram requiere sesión activa para leer todos los comentarios
                de cualquier publicación pública.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-[#5F6368] transition hover:bg-[#F8F9FA] hover:text-[#202124]"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {connected ? (
            <div className="mt-5 rounded-2xl border border-[#34A853]/30 bg-[#34A853]/5 p-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-[#34A853]" />
                <div className="text-sm">
                  <p className="font-medium text-[#202124]">
                    Sesión conectada localmente
                  </p>
                  {userId && (
                    <p className="text-xs text-[#5F6368]">ID cuenta: {userId}</p>
                  )}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleBrowserLogin}
                  disabled={loadingBrowser}
                  className="inline-flex items-center gap-2 rounded-full border border-[#DADCE0] bg-white px-4 py-2 text-xs font-medium text-[#202124] transition hover:bg-[#F8F9FA] disabled:opacity-50"
                >
                  {loadingBrowser ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4285F4]" />
                  ) : (
                    <Chrome className="h-3.5 w-3.5 text-[#4285F4]" />
                  )}
                  Cambiar cuenta
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="inline-flex items-center gap-2 rounded-full border border-[#EA4335]/30 bg-white px-4 py-2 text-xs font-medium text-[#EA4335] transition hover:bg-[#EA4335]/5"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Cerrar sesión guardada
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              <button
                type="button"
                onClick={handleBrowserLogin}
                disabled={loadingBrowser}
                className="flex w-full items-center justify-center gap-2.5 rounded-full bg-[#4285F4] px-5 py-3.5 text-sm font-semibold text-white shadow-xs transition hover:bg-[#3367D6] disabled:opacity-60"
              >
                {loadingBrowser ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Esperando inicio de sesión en Chrome...
                  </>
                ) : (
                  <>
                    <Chrome className="h-4 w-4" />
                    Iniciar sesión en navegador (1 clic)
                  </>
                )}
              </button>

              <p className="text-center text-xs text-[#5F6368]">
                Se abrirá una ventana local de Chrome en{" "}
                <span className="font-medium text-[#202124]">instagram.com</span>
                . Al iniciar sesión, se guardará automáticamente en tu equipo.
              </p>

              <div className="border-t border-[#DADCE0] pt-4">
                <button
                  type="button"
                  onClick={() => setShowCookieInput((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5F6368] hover:text-[#202124]"
                >
                  <KeyRound className="h-3.5 w-3.5 text-[#FBBC05]" />
                  {showCookieInput
                    ? "Ocultar opción avanzada (cookie sessionid)"
                    : "Opción avanzada: pegar cookie sessionid"}
                </button>

                {showCookieInput && (
                  <form onSubmit={handleCookieSave} className="mt-3 space-y-2.5">
                    <input
                      type="password"
                      value={sessionId}
                      onChange={(e) => setSessionId(e.target.value)}
                      placeholder="Pega aquí el valor de tu cookie sessionid..."
                      className="w-full rounded-xl border border-[#DADCE0] px-3.5 py-2.5 text-sm text-[#202124] outline-none transition focus:border-[#4285F4] focus:ring-2 focus:ring-[#4285F4]/20"
                    />
                    <button
                      type="submit"
                      disabled={loadingCookie || !sessionId.trim()}
                      className="inline-flex items-center gap-2 rounded-full bg-[#34A853] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#2d9249] disabled:opacity-50"
                    >
                      {loadingCookie && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      Guardar cookie
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-xl border border-[#EA4335]/30 bg-[#EA4335]/5 px-4 py-3 text-xs text-[#EA4335]">
              {error}
            </div>
          )}

          <div className="mt-5 flex items-center gap-2 rounded-xl bg-[#F8F9FA] px-3.5 py-2.5 text-xs text-[#5F6368]">
            <ShieldCheck className="h-4 w-4 shrink-0 text-[#34A853]" />
            <span>
              Tus credenciales nunca salen de tu computadora (guardado en{" "}
              <code className="text-[#202124]">.ig-session/</code>).
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
