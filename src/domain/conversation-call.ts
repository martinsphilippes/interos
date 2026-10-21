/**
 * Ligar a partir da conversa da Central: quais números o atendente pode escolher (o da conversa, o do contato, do
 * cliente, do lead ou o que o visitante do chat informou) e como a ligação aparece na conversa.
 */
import { displayPhone, nationalNumber } from "./phone";
import { CALL_STATUS_LABELS } from "./telephony";
import type { CallStatus } from "./types";

export interface CallNumber {
  /** De quem é o número (ex.: «WhatsApp desta conversa», «Maria · celular»). */
  label: string;
  /** Número como está no cadastro (o softphone/aparelho normaliza). */
  number: string;
}

export interface CallSource {
  label: string;
  numbers: (string | undefined | null)[];
}

/** Números válidos (com DDD), sem repetir, na ordem das fontes; no máximo 8. */
export function callNumbers(sources: CallSource[]): CallNumber[] {
  const seen = new Set<string>();
  const out: CallNumber[] = [];
  for (const s of sources) {
    for (const raw of s.numbers) {
      const d = nationalNumber(raw);
      if (d.length < 10 || d.length > 11 || seen.has(d)) continue;
      seen.add(d);
      out.push({ label: s.label, number: d });
    }
  }
  return out.slice(0, 8);
}

/** Resultado de uma ligação feita pelo aparelho (sem a telefonia do INTEROS), registrado à mão. */
export const MANUAL_CALL_OUTCOMES = ["atendida", "sem_resposta", "ocupado"] as const satisfies readonly CallStatus[];
export type ManualCallOutcome = (typeof MANUAL_CALL_OUTCOMES)[number];

export const MANUAL_CALL_OUTCOME_LABELS: Record<ManualCallOutcome, string> = {
  atendida: "Atendeu",
  sem_resposta: "Não atendeu / caixa postal",
  ocupado: "Ocupado",
};

function duration(seconds: number | undefined): string | undefined {
  if (!seconds) return undefined;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m} min ${String(s).padStart(2, "0")} s` : `${s} s`;
}

/** Ligação na linha do tempo da conversa: título e detalhe. */
export function callThreadText(call: { direction: "entrada" | "saida"; number?: string; status?: CallStatus; durationSeconds?: number; manual: boolean; authorName?: string; note?: string }): { title: string; description?: string } {
  const who = call.number ? displayPhone(call.number) : "";
  const title = call.direction === "entrada" ? `Ligação recebida${who ? ` de ${who}` : ""}` : `Ligação para ${who || "o cliente"}`;
  const parts = [
    call.authorName ? (call.direction === "entrada" ? `atendida por ${call.authorName}` : `por ${call.authorName}`) : undefined,
    call.status && call.status !== "em_andamento" ? CALL_STATUS_LABELS[call.status].toLowerCase() : call.status === "em_andamento" ? "em andamento" : undefined,
    duration(call.durationSeconds),
    call.manual ? "pelo aparelho (registro manual)" : undefined,
    call.note?.trim() || undefined,
  ].filter(Boolean);
  return { title, description: parts.length ? parts.join(" · ") : undefined };
}
