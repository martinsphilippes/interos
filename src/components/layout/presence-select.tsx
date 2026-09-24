"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { USER_PRESENCES, USER_PRESENCE_LABELS, type UserPresence } from "@/domain/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { toast } from "@/components/ui/toast";
import { setPresence } from "@/server/users/presence";
import { cn } from "@/lib/utils";

const PRESENCE_TONE: Record<UserPresence, StatusTone> = { online: "success", ausente: "warning", ocupado: "danger" };

export interface PresenceSelectProps {
  /** Presença salva no usuário (padrão: online). */
  value?: UserPresence;
  className?: string;
}

/** Seletor de presença (Online/Ausente/Ocupado) da top bar, salvo em users.presence. */
export function PresenceSelect({ value = "online", className }: PresenceSelectProps) {
  const [current, setCurrent] = React.useState<UserPresence>(value);
  const [pending, startTransition] = React.useTransition();

  const choose = (next: UserPresence) => {
    if (next === current) return;
    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      const result = await setPresence({ presence: next });
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
          aria-label={`Presença: ${USER_PRESENCE_LABELS[current]}`}
          aria-busy={pending || undefined}
          className={cn(
            "inline-flex h-10 min-w-[132px] items-center gap-2 rounded-lg border border-border-strong bg-surface-muted px-3 text-sm font-medium text-foreground transition-colors hover:border-muted-light/60 data-[state=open]:border-brand",
            className,
          )}
        >
          <StatusDot tone={PRESENCE_TONE[current]} pulse={current === "online"} />
          <span className="flex-1 text-left">{USER_PRESENCE_LABELS[current]}</span>
          <ChevronDown className="size-4 text-muted" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Sua presença</DropdownMenuLabel>
        {USER_PRESENCES.map((p) => (
          <DropdownMenuItem key={p} onSelect={() => choose(p)}>
            <StatusDot tone={PRESENCE_TONE[p]} />
            <span className="flex-1">{USER_PRESENCE_LABELS[p]}</span>
            {p === current ? <Check className="!text-brand-fg" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
