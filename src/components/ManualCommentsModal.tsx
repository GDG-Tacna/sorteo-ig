"use client";

import { useState } from "react";
import { ClipboardPaste, X } from "lucide-react";
import { parseManualCommentsInput, type RawComment } from "@/lib/giveaway";

interface ManualCommentsModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (comments: RawComment[], labelUrl: string) => void;
}

export function ManualCommentsModal({
  open,
  onClose,
  onImport,
}: ManualCommentsModalProps) {
  const [rawText, setRawText] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = parseManualCommentsInput(rawText);
    if (parsed.length < 2) {
      setError(
        "Ingresa al menos 2 comentarios válidos (ejemplo: @usuario: comentario)."
      );
      return;
    }
    onImport(parsed, customUrl.trim() || "Carga manual de comentarios");
    setRawText("");
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-modal-title"
    >
      <div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-[#DADCE0] bg-white shadow-xl">
        <div className="grid h-1.5 w-full grid-cols-4">
          <div className="bg-[#4285F4]" />
          <div className="bg-[#EA4335]" />
          <div className="bg-[#FBBC05]" />
          <div className="bg-[#34A853]" />
        </div>

        <form onSubmit={handleSubmit} className="p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2
                id="manual-modal-title"
                className="text-lg font-semibold text-[#202124] sm:text-xl"
              >
                Importar comentarios manualmente
              </h2>
              <p className="mt-1 text-sm text-[#5F6368]">
                Pega una lista en formato{" "}
                <code className="rounded bg-[#F8F9FA] px-1.5 py-0.5 text-xs text-[#202124]">
                  @usuario: comentario
                </code>
                , CSV o JSON. Los usuarios repetidos solo contarán una vez.
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

          <div className="mt-4 space-y-3">
            <input
              type="text"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="URL o título de referencia (opcional)"
              className="w-full rounded-xl border border-[#DADCE0] px-3.5 py-2.5 text-sm text-[#202124] outline-none transition focus:border-[#4285F4] focus:ring-2 focus:ring-[#4285F4]/20"
            />
            <textarea
              rows={7}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={`@ana.dev: ¡Participando!\n@carlos_ux: Quiero ganar\n@ana.dev: Segundo comentario (contará solo 1 vez)\n@luisa.pm: Éxitos a todos`}
              className="w-full rounded-2xl border border-[#DADCE0] p-3.5 text-sm text-[#202124] outline-none transition focus:border-[#4285F4] focus:ring-2 focus:ring-[#4285F4]/20"
            />
          </div>

          {error && (
            <p className="mt-3 text-xs font-medium text-[#EA4335]">{error}</p>
          )}

          <div className="mt-5 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-[#DADCE0] px-4 py-2.5 text-sm font-medium text-[#5F6368] transition hover:bg-[#F8F9FA]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full bg-[#4285F4] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#3367D6]"
            >
              <ClipboardPaste className="h-4 w-4" />
              Cargar participantes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
