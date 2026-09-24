import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface DataListItem {
  key?: string;
  icon?: React.ReactNode;
  label: React.ReactNode;
  /** Valor já formatado; vazio mostra "—". */
  value?: React.ReactNode;
  href?: string;
}

export interface DataListProps {
  items: DataListItem[];
  /** Largura da coluna de rótulos (padrão 9rem). */
  labelWidth?: string;
  className?: string;
}

/** Pares rótulo/valor com ícone ("Dados gerais" do Cliente 360º). */
export function DataList({ items, labelWidth = "9rem", className }: DataListProps) {
  return (
    <dl className={cn("flex flex-col divide-y divide-border/70", className)}>
      {items.map((item, i) => {
        const value = item.value === undefined || item.value === null || item.value === "" ? <span className="text-muted-light">—</span> : item.value;
        return (
          <div key={item.key ?? i} className="grid items-center gap-3 py-2.5 first:pt-0 last:pb-0" style={{ gridTemplateColumns: `${labelWidth} minmax(0,1fr)` }}>
            <dt className="flex min-w-0 items-center gap-2.5 text-sm text-muted">
              {item.icon ? <span className="shrink-0 text-muted [&_svg]:size-4">{item.icon}</span> : null}
              <span className="truncate">{item.label}</span>
            </dt>
            <dd className="min-w-0 break-words text-sm text-foreground">
              {item.href ? (
                <Link href={item.href} className="hover:text-brand-fg hover:underline">
                  {value}
                </Link>
              ) : (
                value
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
