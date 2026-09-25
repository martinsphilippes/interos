"use client";

import * as React from "react";
import type { SlaState } from "@/domain/constants";
import { SlaBadge } from "@/components/ui/sla-badge";

/**
 * SLA com contagem regressiva: parte do tempo restante calculado no servidor e desconta a cada
 * minuto no navegador (pausado e concluído não contam).
 */
export function SlaCountdown({ state, remainingMs }: { state: SlaState; remainingMs: number }) {
  const [elapsed, setElapsed] = React.useState(0);
  const ticking = state !== "pausado" && state !== "concluido";
  React.useEffect(() => {
    if (!ticking) return;
    const started = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - started), 60_000);
    return () => clearInterval(id);
  }, [ticking]);
  const remaining = remainingMs - elapsed;
  const live: SlaState = ticking && remaining < 0 ? "violado" : state;
  return <SlaBadge state={live} remainingMs={remaining} size="md" />;
}
