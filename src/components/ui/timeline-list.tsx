import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { toneSoft, type Tone } from "./tone";

export interface TimelineListItem {
  id: string;
  icon: React.ReactNode;
  tone?: Tone;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Data/hora já formatada (ou <RelativeTime/>). */
  date?: React.ReactNode;
  href?: string;
}

export interface TimelineListProps {
  items: TimelineListItem[];
  emptyText?: string;
  className?: string;
}

/** Linha do tempo compacta: ícone circular colorido + título + subtítulo + data, ligados por uma linha vertical. */
export function TimelineList({ items, emptyText = "Nenhum evento registrado.", className }: TimelineListProps) {
  if (items.length === 0) return <p className={cn("py-6 text-center text-sm text-muted", className)}>{emptyText}</p>;
  return (
    <ol className={cn("flex flex-col", className)}>
      {items.map((item, i) => {
        const body = (
          <div className="flex min-w-0 flex-1 items-start justify-between gap-3 pb-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
              {item.subtitle ? <p className="mt-0.5 truncate text-xs text-muted">{item.subtitle}</p> : null}
            </div>
            {item.date ? <span className="shrink-0 text-right text-xs tabular-nums text-muted">{item.date}</span> : null}
          </div>
        );
        return (
          <li key={item.id} className="relative flex gap-3">
            {i < items.length - 1 ? <span className="absolute left-4 top-9 bottom-1 w-px -translate-x-1/2 bg-border-strong" aria-hidden /> : null}
            <span className={cn("relative flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4", toneSoft[item.tone ?? "neutral"])} aria-hidden>
              {item.icon}
            </span>
            {item.href ? (
              <Link href={item.href} className="-mx-1 flex min-w-0 flex-1 rounded-md px-1 transition-colors hover:bg-surface-hover/60">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
}
