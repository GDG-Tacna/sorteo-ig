"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, MessageSquare, Trophy } from "lucide-react";
import type { Participant } from "@/lib/giveaway";

interface WinnerCardProps {
  slot: 1 | 2;
  participant: Participant | null;
  rollingUsername?: string;
  isRolling: boolean;
}

export function WinnerCard({
  slot,
  participant,
  rollingUsername,
  isRolling,
}: WinnerCardProps) {
  const [copied, setCopied] = useState(false);

  const isFirst = slot === 1;
  const accentBorder = isFirst ? "border-[#4285F4]/35" : "border-[#34A853]/35";
  const accentBar = isFirst ? "bg-[#4285F4]" : "bg-[#34A853]";
  const badgeBg = isFirst
    ? "bg-[#4285F4]/10 text-[#4285F4]"
    : "bg-[#34A853]/10 text-[#34A853]";
  const avatarBg = isFirst
    ? "bg-[#4285F4] text-white"
    : "bg-[#34A853] text-white";

  async function handleCopy() {
    if (!participant) return;
    await navigator.clipboard.writeText(`@${participant.username}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div
      className={`relative flex flex-col justify-between overflow-hidden rounded-3xl border bg-white p-6 shadow-xs transition-all duration-300 sm:p-7 ${
        participant || isRolling ? accentBorder : "border-[#DADCE0]"
      }`}
    >
      {/* Top single Google-color bar */}
      <div className={`absolute inset-x-0 top-0 h-1.5 ${accentBar}`} />

      <div>
        <div className="flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${badgeBg}`}
          >
            <Trophy className="h-3.5 w-3.5 text-[#FBBC05]" />
            Ganador #{slot}
          </span>

          {participant && !isRolling && (
            <span className="rounded-full bg-[#F8F9FA] px-2.5 py-1 text-[11px] font-medium text-[#5F6368]">
              {participant.commentCount > 1
                ? `${participant.commentCount} comentarios · 1 voto`
                : "1 voto único"}
            </span>
          )}
        </div>

        {isRolling ? (
          <div className="my-7 flex items-center gap-4">
            <div
              className={`flex h-14 w-14 shrink-0 animate-pulse items-center justify-center rounded-2xl text-lg font-bold ${avatarBg}`}
            >
              @
            </div>
            <div className="min-w-0">
              <p className="truncate text-xl font-bold tracking-tight text-[#202124] sm:text-2xl">
                @{rollingUsername || "sorteando"}
              </p>
              <p className="mt-0.5 text-xs text-[#5F6368]">
                Seleccionando al azar...
              </p>
            </div>
          </div>
        ) : participant ? (
          <div className="mt-5">
            <div className="flex items-center gap-4">
              <div
                className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-xl font-bold uppercase shadow-xs ${avatarBg}`}
              >
                {participant.username.slice(0, 2)}
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-xl font-bold tracking-tight text-[#202124] sm:text-2xl">
                  @{participant.username}
                </h3>
                {participant.fullName ? (
                  <p className="truncate text-sm text-[#5F6368]">
                    {participant.fullName}
                  </p>
                ) : (
                  <p className="text-xs text-[#5F6368]">
                    Participante verificado · 1 entrada
                  </p>
                )}
              </div>
            </div>

            {participant.comments.length > 0 && (
              <div className="mt-5 rounded-2xl border border-[#DADCE0]/70 bg-[#F8F9FA] p-3.5">
                <div className="flex items-start gap-2.5">
                  <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-[#5F6368]" />
                  <p className="line-clamp-3 text-sm leading-relaxed text-[#202124]">
                    “{participant.comments[0]}”
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="my-8 text-center">
            <p className="text-sm font-medium text-[#5F6368]">
              Listo para descubrir al Ganador #{slot}
            </p>
          </div>
        )}
      </div>

      {participant && !isRolling && (
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[#DADCE0]/60 pt-4">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[#DADCE0] bg-white px-3.5 py-2 text-xs font-medium text-[#202124] transition hover:bg-[#F8F9FA]"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-[#34A853]" />
                Copiado
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 text-[#5F6368]" />
                Copiar usuario
              </>
            )}
          </button>

          <a
            href={`https://www.instagram.com/${participant.username}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[#DADCE0] bg-white px-3.5 py-2 text-xs font-medium text-[#202124] transition hover:bg-[#F8F9FA]"
          >
            Ver perfil IG
            <ExternalLink className="h-3.5 w-3.5 text-[#4285F4]" />
          </a>
        </div>
      )}
    </div>
  );
}
