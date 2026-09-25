import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { toneSolid, toneText, type Tone } from "./tone";

export interface ProgressListItem {
  key?: string;
  label: React.ReactNode;
  /** Preenchimento da barra, 0–100 (valores acima de 100 enchem a barra). */
  value: number;
  /** Texto à direita (padrão: "NN%"). Ex.: "88/95%", "R$ 1.350,00". */
  display?: React.ReactNode;
  tone?: Tone;
  /** Pinta o texto da direita com a cor do tom (ex.: sobrecarga "110%" em vermelho). */
  emphasize?: boolean;
  icon?: React.ReactNode;
  href?: string;
  /** Linha secundária sob o rótulo. */
  hint?: React.ReactNode;
}

export interface ProgressListProps {
  items: ProgressListItem[];
  /** "inline": rótulo | barra | valor na mesma linha · "stacked": rótulo e valor acima da barra. */
  layout?: "inline" | "stacked";
  /** Escala 0–25–50–75–100% sob as barras (layout inline). */
  showScale?: boolean;
  emptyText?: string;
  className?: string;
}

/** Lista de rótulo + barra + valor ("Metas do departamento", "Carga de trabalho", "Desempenho por departamento"). */
export function ProgressList({ items, layout = "inline", showScale, emptyText = "Sem dados no período.", className }: ProgressListProps) {
  if (items.length === 0) return <p className={cn("py-6 text-center text-sm text-muted", className)}>{emptyText}</p>;
  return (
    <div className={className}>
      <ul className={cn("flex flex-col", layout === "stacked" ? "gap-4" : "gap-3")}>
        {items.map((item, i) => {
          const tone = item.tone ?? "brand";
          const width = Math.max(0, Math.min(100, item.value));
          const right = item.display ?? `${Math.round(item.value)}%`;
          const bar = (
            <div className="h-2 w-full overflow-hidden rounded-full bg-track" aria-hidden>
              <div className={cn("h-full rounded-full transition-[width] duration-300", toneSolid[tone])} style={{ width: `${width}%` }} />
            </div>
          );
          const label = (
            <span className="flex min-w-0 items-center gap-2">
              {item.icon ? <span className={cn("shrink-0 [&_svg]:size-4", toneText[tone])}>{item.icon}</span> : null}
              <span className="min-w-0">
                <span className="block truncate text-sm text-foreground">{item.label}</span>
                {item.hint ? <span className="block truncate text-xs text-muted">{item.hint}</span> : null}
              </span>
            </span>
          );
          const valueNode = <span className={cn("shrink-0 text-right text-sm font-medium tabular-nums", item.emphasize ? toneText[tone] : "text-foreground")}>{right}</span>;
          const row =
            layout === "stacked" ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  {label}
                  {valueNode}
                </div>
                {bar}
              </div>
            ) : (
              <div className="grid grid-cols-[minmax(0,8.5rem)_1fr_auto] items-center gap-3 sm:grid-cols-[minmax(0,11rem)_1fr_auto]">
                {label}
                {bar}
                <span className="min-w-12 text-right">{valueNode}</span>
              </div>
            );
          return (
            <li key={item.key ?? i}>
              {item.href ? (
                <Link href={item.href} className="-mx-2 block rounded-lg px-2 py-1 transition-colors hover:bg-surface-hover">
                  {row}
                </Link>
              ) : (
                row
              )}
            </li>
          );
        })}
      </ul>
      {showScale && layout === "inline" ? (
        <div className="mt-2 grid grid-cols-[minmax(0,8.5rem)_1fr_auto] gap-3 text-[11px] text-muted-light sm:grid-cols-[minmax(0,11rem)_1fr_auto]" aria-hidden>
          <span />
          <span className="flex justify-between tabular-nums">
            <span>0%</span>
            <span>25%</span>
            <span>50%</span>
            <span>75%</span>
            <span>100%</span>
          </span>
          <span className="min-w-12" />
        </div>
      ) : null}
    </div>
  );
}
