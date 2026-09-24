import * as React from "react";
import { cn } from "@/lib/utils";

export interface SectionTitleProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Contador/badge ao lado do título. */
  count?: number;
  actions?: React.ReactNode;
  className?: string;
  as?: "h2" | "h3";
}

/** Título de seção dentro de uma página (abaixo do PageHeader). */
export function SectionTitle({ title, description, count, actions, className, as: Tag = "h2" }: SectionTitleProps) {
  return (
    <div className={cn("mb-3 flex items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <Tag className="flex items-center gap-2 text-base font-semibold leading-tight tracking-tight text-foreground">
          {title}
          {count !== undefined ? <span className="rounded-md border border-border bg-surface-hover px-2 py-0.5 text-xs font-medium tabular-nums text-muted">{count}</span> : null}
        </Tag>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
