import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatTone = "neutral" | "success" | "warning" | "danger" | "info";

const toneText: Record<StatTone, string> = {
  neutral: "text-muted",
  success: "text-success-fg",
  warning: "text-warning-fg",
  danger: "text-danger-fg",
  info: "text-info-fg",
};

const toneIconBg: Record<StatTone, string> = {
  neutral: "bg-surface-hover text-muted",
  success: "bg-success-soft text-success-fg",
  warning: "bg-warning-soft text-warning-fg",
  danger: "bg-danger-soft text-danger-fg",
  info: "bg-info-soft text-info-fg",
};

export interface StatCardProps {
  label: string;
  /** Valor já formatado (use formatCurrency/formatNumber). */
  value: React.ReactNode;
  /** Variação: número (ex.: 12 => "+12%") ou texto livre; direção define a seta. */
  delta?: { value: string; direction: "up" | "down" | "flat"; tone?: StatTone; label?: string };
  icon?: React.ReactNode;
  /** Cor do ícone / destaque semântico (nunca decorativo). */
  tone?: StatTone;
  /** Drill-down: torna o card clicável. */
  href?: string;
  hint?: string;
  compact?: boolean;
  className?: string;
}

export function StatCard({ label, value, delta, icon, tone = "neutral", href, hint, compact, className }: StatCardProps) {
  const DeltaIcon = delta?.direction === "up" ? ArrowUpRight : delta?.direction === "down" ? ArrowDownRight : Minus;
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label-caps truncate">{label}</p>
          <p className={cn("mt-1 font-semibold tabular-nums tracking-tight text-foreground", compact ? "text-xl" : "text-2xl md:text-[28px] md:leading-9")}>{value}</p>
        </div>
        {icon ? (
          <span className={cn("flex shrink-0 items-center justify-center rounded-md [&_svg]:size-4", compact ? "size-8" : "size-9", toneIconBg[tone])}>{icon}</span>
        ) : href ? (
          <ChevronRight className="size-4 shrink-0 text-muted-light" />
        ) : null}
      </div>
      {delta || hint ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          {delta ? (
            <span className={cn("inline-flex items-center gap-0.5 font-medium tabular-nums", toneText[delta.tone ?? "neutral"])}>
              <DeltaIcon className="size-3.5" />
              {delta.value}
            </span>
          ) : null}
          {delta?.label || hint ? <span className="truncate text-muted">{delta?.label ?? hint}</span> : null}
        </div>
      ) : null}
    </>
  );
  const base = cn("block rounded-lg border border-border bg-surface shadow-card", compact ? "p-3.5" : "p-4 md:p-5", className);
  if (href) {
    return (
      <Link href={href} className={cn(base, "transition-colors hover:border-border-strong hover:bg-surface-muted")}>
        {content}
      </Link>
    );
  }
  return <div className={base}>{content}</div>;
}
