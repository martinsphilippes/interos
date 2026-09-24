"use client";

import { RefreshCw } from "lucide-react";
import { recalculateAllHealthAction, recalculateHealth } from "@/server/cs/actions";
import { HEALTH_LEVEL_LABELS } from "@/server/cs/schemas";
import type { HealthLevel } from "@/domain/constants";
import { Button } from "@/components/ui/button";
import { useCsAction } from "./use-cs";

/** Recalcula a carteira inteira (gestores e administradores). */
export function RecalculateAllButton() {
  const { pending, run } = useCsAction();
  return (
    <Button size="sm" variant="outline" loading={pending} onClick={() => run(() => recalculateAllHealthAction(), (d) => `${d.count} cliente(s) recalculado(s) · ${d.changed} mudaram de nível · ${d.risk} em risco`)}>
      {!pending ? <RefreshCw /> : null} Recalcular carteira
    </Button>
  );
}

export function RecalculateClientButton({ clientId, size = "sm", variant = "outline" }: { clientId: string; size?: "sm" | "md"; variant?: "outline" | "ghost" | "primary" }) {
  const { pending, run } = useCsAction();
  return (
    <Button
      size={size}
      variant={variant}
      loading={pending}
      className="min-h-[44px] md:min-h-0"
      onClick={() => run(() => recalculateHealth({ clientId }), (d) => `Saúde recalculada: ${d.score} (${HEALTH_LEVEL_LABELS[d.level as HealthLevel] ?? d.level})`)}
    >
      {!pending ? <RefreshCw /> : null} Recalcular saúde
    </Button>
  );
}
