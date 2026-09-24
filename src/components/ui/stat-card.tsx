import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconTile } from "./icon-tile";
import { MetricDelta } from "./metric-delta";
import { toneSolid, toneText, type Tone } from "./tone";

/** Tons aceitos pelo StatCard (inclui brand/purple/secondary do design system escuro). */
export type StatTone = Tone;

export interface StatCardProps {
  label: string;
  /** Valor já formatado (use formatCurrency/formatNumber). */
  value: React.ReactNode;
  /** Variação vs. período anterior; direção define a seta e `tone` a cor (padrão: up verde, down vermelho). */
  delta?: { value: string; direction: "up" | "down" | "flat"; tone?: StatTone; label?: string };
  icon?: React.ReactNode;
  /** Cor semântica do quadrado do ícone (nunca decorativa). */
  tone?: StatTone;
  /** Pinta o valor com a cor do tom (ex.: "Violados 4" em vermelho). */
  valueTone?: boolean;
  /** Drill-down: torna o card clicável. */
  href?: string;
  hint?: string;
  /** Barra de progresso 0–100 sob o valor (ex.: "Meta global 91%"). */
  progress?: number;
  compact?: boolean;
  className?: string;
}

/**
 * Card de indicador no padrão das referências: ícone em quadrado tingido à esquerda, rótulo muted,
 * valor grande (26–30px) e linha de variação "↑ 12,4% vs. mês anterior". Sem ícone, o valor ocupa a largura.
 */
export function StatCard({ label, value, delta, icon, tone = "neutral", valueTone, href, hint, progress, compact, className }: StatCardProps) {
  const deltaLine =
    delta || hint ? (
      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs">
        {delta ? <MetricDelta value={delta.value} direction={delta.direction} tone={delta.tone} label={delta.label} /> : null}
        {!delta?.label && hint ? <span className="truncate text-muted">{hint}</span> : null}
      </div>
    ) : null;
  const progressBar =
    progress !== undefined ? (
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-track">
        <div className={cn("h-full rounded-full", toneSolid[tone === "neutral" ? "brand" : tone])} style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
      </div>
    ) : null;
  // Compacto (grades de 2 colunas no celular): rótulo na largura toda, valor e ícone lado a lado abaixo.
  const compactContent = (
    <div className="min-w-0">
      <p data-slot="stat-label" className="truncate text-[13px] font-medium text-muted">
        {label}
      </p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className={cn("min-w-0 truncate text-xl font-semibold leading-7 tabular-nums tracking-tight", valueTone ? toneText[tone] : "text-foreground")}>{value}</p>
        {icon ? <IconTile icon={icon} tone={tone} size="sm" /> : null}
      </div>
      {progressBar}
      {deltaLine}
    </div>
  );
  const content = compact ? compactContent : (
    <div className="flex items-start gap-3.5">
      {icon ? <IconTile icon={icon} tone={tone} size="md" className="mt-0.5" /> : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p data-slot="stat-label" className="truncate text-[13px] font-medium text-muted">
              {label}
            </p>
            <p
              className={cn(
                "mt-1 font-semibold tabular-nums tracking-tight",
                "text-[26px] leading-8 md:text-[28px] md:leading-9",
                valueTone ? toneText[tone] : "text-foreground",
              )}
            >
              {value}
            </p>
          </div>
          {href ? <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-light" aria-hidden /> : null}
        </div>
        {progressBar}
        {deltaLine}
      </div>
    </div>
  );
  const base = cn("block rounded-xl border border-border bg-surface shadow-card", compact ? "p-3.5" : "p-4 md:p-5", className);
  if (href) {
    return (
      <Link href={href} className={cn(base, "transition-colors hover:border-border-strong hover:bg-surface-hover/60")}>
        {content}
      </Link>
    );
  }
  return <div className={base}>{content}</div>;
}
