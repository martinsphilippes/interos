"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { USER_PRESENCES, USER_PRESENCE_LABELS, type UserPresence } from "@/domain/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { toast } from "@/components/ui/toast";
import { setPresence } from "@/server/users/presence";
import { cn } from "@/lib/utils";

const PRESENCE_TONE: Record<UserPresence, StatusTone> = { online: "success", ausente: "warning", ocupado: "danger", pausa: "secondary" };

export interface PresenceSelectProps {
  /** Presença salva no usuário (padrão: online). */
  value?: UserPresence;
  /** Motivo da pausa atual e os motivos disponíveis (sem motivos, a opção «Pausa» não aparece). */
  pauseReasonKey?: string;
  pauseReasons?: { key: string; label: string }[];
  className?: string;
}

/**
 * Seletor de presença da top bar (Online/Ausente/Ocupado e Pausa com motivo), salvo em users.presence. Em pausa, a
 * Central não entrega conversas novas; o gerente vê o motivo e há quanto tempo.
 */
export function PresenceSelect({ value = "online", pauseReasonKey, pauseReasons = [], className }: PresenceSelectProps) {
  const [current, setCurrent] = React.useState<{ presence: UserPresence; reason?: string }>({ presence: value, reason: pauseReasonKey });
  const [pending, startTransition] = React.useTransition();
  const reasonLabel = current.presence === "pausa" ? pauseReasons.find((r) => r.key === current.reason)?.label : undefined;
  const label = reasonLabel ? `Pausa · ${reasonLabel}` : USER_PRESENCE_LABELS[current.presence];

  const choose = (next: UserPresence, reason?: string) => {
    if (next === current.presence && reason === current.reason) return;
    const previous = current;
    setCurrent({ presence: next, reason });
    startTransition(async () => {
      const result = await setPresence({ presence: next, pauseReasonKey: reason });
      if (!result.ok) {
        setCurrent(previous);
        toast.error(result.error);
      }
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Presença: ${label}`}
          aria-busy={pending || undefined}
          className={cn(
            "inline-flex h-10 min-w-[132px] items-center gap-2 rounded-lg border border-border-strong bg-surface-muted px-3 text-sm font-medium text-foreground transition-colors hover:border-muted-light/60 data-[state=open]:border-brand",
            className,
          )}
        >
          <StatusDot tone={PRESENCE_TONE[current.presence]} pulse={current.presence === "online"} />
          <span className="max-w-[140px] flex-1 truncate text-left">{label}</span>
          <ChevronDown className="size-4 text-muted" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Sua presença</DropdownMenuLabel>
        {USER_PRESENCES.filter((p) => p !== "pausa").map((p) => (
          <DropdownMenuItem key={p} onSelect={() => choose(p)}>
            <StatusDot tone={PRESENCE_TONE[p]} />
            <span className="flex-1">{USER_PRESENCE_LABELS[p]}</span>
            {p === current.presence ? <Check className="!text-brand-fg" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
        {pauseReasons.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Pausa</DropdownMenuLabel>
            {pauseReasons.map((r) => (
              <DropdownMenuItem key={r.key} onSelect={() => choose("pausa", r.key)}>
                <StatusDot tone={PRESENCE_TONE.pausa} />
                <span className="flex-1">{r.label}</span>
                {current.presence === "pausa" && current.reason === r.key ? <Check className="!text-brand-fg" aria-hidden /> : null}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
