"use client";

import * as React from "react";
import type { SlaState } from "@/domain/constants";
import type { SlaLive } from "@/server/support/queries";
import { SlaBadge } from "@/components/ui/sla-badge";
import type { BadgeProps } from "@/components/ui/badge";

/**
 * Estado do SLA recalculado no navegador (mesma regra de computeSlaState em src/server/sla.ts, que não
 * pode ser importado no cliente). Pausado e concluído ficam congelados.
 */
export function slaStateAt(sla: SlaLive, now: number): { state: SlaState; remainingMs: number; consumedPct: number } {
  const start = new Date(sla.startedAt).getTime();
  const due = new Date(sla.dueAt).getTime();
  const reference = sla.status === "concluido" && sla.completedAt ? new Date(sla.completedAt).getTime() : sla.status === "pausado" && sla.pausedAt ? new Date(sla.pausedAt).getTime() : now;
  const consumedPct = Math.max(0, ((reference - start) / Math.max(due - start, 1)) * 100);
  const remainingMs = due - reference;
  let state: SlaState;
  if (sla.status === "concluido") state = remainingMs < 0 ? "violado" : "concluido";
  else if (sla.status === "pausado") state = "pausado";
  else if (remainingMs < 0) state = "violado";
  else if (consumedPct >= sla.riskPct) state = "em_risco";
  else if (consumedPct >= sla.attentionPct) state = "em_atencao";
  else state = "dentro_do_prazo";
  return { state, remainingMs, consumedPct };
}

/** Relógio compartilhado que avança a cada minuto (parte do instante calculado no servidor). */
export function useMinuteClock(): number | null {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    // Primeiro tique após a hidratação: evita divergência entre SSR e navegador.
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  return now;
}

/** Badge de SLA no instante `now` (null = estado calculado no servidor). Use com um relógio único em listas. */
export function SlaBadgeAt({ sla, now, size = "sm", timeOnly }: { sla?: SlaLive; now: number | null; size?: BadgeProps["size"]; timeOnly?: boolean }) {
  if (!sla) return <span className="text-xs text-muted-light">—</span>;
  const view = now === null ? sla.view : slaStateAt(sla, now);
  return <SlaBadge state={view.state} remainingMs={view.remainingMs} size={size} timeOnly={timeOnly} />;
}

/** Badge de SLA com contagem regressiva ao vivo (relógio próprio). */
export function LiveSlaBadge({ sla, size = "sm", timeOnly }: { sla?: SlaLive; size?: BadgeProps["size"]; timeOnly?: boolean }) {
  const now = useMinuteClock();
  return <SlaBadgeAt sla={sla} now={now} size={size} timeOnly={timeOnly} />;
}

/** Situação do prazo de primeira resposta (texto curto). */
export function responseDueLabel(sla: SlaLive | undefined, firstResponseAt: string | undefined, now: number): { label: string; tone: "success" | "danger" | "warning" | "muted" } | null {
  if (!sla?.responseDueAt) return null;
  if (firstResponseAt) return firstResponseAt <= sla.responseDueAt ? { label: "Respondido no prazo", tone: "success" } : { label: "Respondido fora do prazo", tone: "danger" };
  const remaining = new Date(sla.responseDueAt).getTime() - now;
  if (remaining < 0) return { label: "Resposta atrasada", tone: "danger" };
  return { label: "Aguardando 1ª resposta", tone: remaining < 30 * 60_000 ? "warning" : "muted" };
}
