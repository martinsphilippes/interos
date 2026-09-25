"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface CollapsibleBlockProps {
  title: string;
  count?: number;
  description?: string;
  /** Link "ver todos" no cabeçalho. */
  action?: React.ReactNode;
  /** Começa recolhido no celular (no desktop está sempre aberto). */
  defaultCollapsed?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * Bloco secundário do Meu Dia: cartão com cabeçalho. No celular o cabeçalho é um botão que
 * recolhe/expande o conteúdo; a partir de md o conteúdo fica sempre visível.
 */
export function CollapsibleBlock({ title, count, description, action, defaultCollapsed = false, className, children }: CollapsibleBlockProps) {
  const [open, setOpen] = React.useState(!defaultCollapsed);
  const contentId = React.useId();
  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 md:px-5 md:pt-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={contentId}
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left md:pointer-events-none md:min-h-0"
        >
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2 text-base font-semibold leading-tight tracking-tight text-foreground">
              <span className="truncate">{title}</span>
              {count !== undefined ? <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium tabular-nums text-muted">{count}</span> : null}
            </span>
            {description ? <span className="mt-0.5 text-xs text-muted">{description}</span> : null}
          </span>
          <ChevronDown className={cn("ml-auto size-4 shrink-0 text-muted transition-transform md:hidden", open && "rotate-180")} aria-hidden />
        </button>
        {action ? <div className="shrink-0 text-sm">{action}</div> : null}
      </div>
      <div id={contentId} className={cn("px-4 pb-4 md:px-5 md:pb-5", !open && "hidden md:block")}>
        {children}
      </div>
    </Card>
  );
}
