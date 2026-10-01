"use client";

import * as React from "react";
import { ChevronDown, FileDiff } from "lucide-react";
import { changeLines, type ChangeMap } from "@/domain/audit-format";
import { cn } from "@/lib/utils";

export interface ChangeListProps {
  changes?: ChangeMap | null;
  reason?: string;
  /** Rótulos próprios do evento (payload.labels). */
  labels?: Record<string, string>;
  /** Começa aberto (padrão: fechado, para não alongar a linha do tempo). */
  defaultOpen?: boolean;
  className?: string;
}

/**
 * Alterações "campo: antes → depois" de um evento (D29), colapsáveis. Os valores chegam já redigidos pelo servidor
 * (quantias sem "Visualizar valores", salário); a formatação mascara sensíveis de novo por garantia.
 */
export function ChangeList({ changes, reason, labels, defaultOpen = false, className }: ChangeListProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const id = React.useId();
  const lines = changeLines(changes, { labels });
  // Sem alterações não há o que abrir (o motivo, quando existe, já costuma estar na descrição do evento).
  if (lines.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-1", className)} data-testid="change-list">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-8 w-fit items-center gap-1 rounded-md px-1 -mx-1 text-xs font-medium text-secondary hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        <FileDiff className="size-3.5" aria-hidden />
        {open ? "Ocultar alterações" : `Ver alterações (${lines.length})`}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <ul id={id} className="flex flex-col gap-0.5 rounded-md border border-border bg-surface-hover/40 px-2.5 py-2 text-xs" data-testid="change-lines">
          {lines.map((l) => (
            <li key={l.field} className="break-words">
              <span className="text-muted">{l.label}:</span> <span className="text-muted-light line-through decoration-muted-light/60">{l.from}</span> → <span className="font-medium text-foreground">{l.to}</span>
            </li>
          ))}
          {reason ? <li className="mt-1 break-words text-muted">Motivo: {reason}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
