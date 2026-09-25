import Link from "next/link";
import { AlertOctagon, AlertTriangle, ArrowRight, Info, Lightbulb, ShieldCheck } from "lucide-react";
import { DEPARTMENT_LABELS } from "@/domain/constants";
import type { Insight, InsightSeverity } from "@/server/insights/rules";
import { SEVERITY_LABELS } from "@/server/insights/rules";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

const TONE: Record<InsightSeverity, { badge: "danger" | "warning" | "info"; border: string; icon: React.ReactNode }> = {
  critico: { badge: "danger", border: "border-l-danger", icon: <AlertOctagon aria-hidden /> },
  atencao: { badge: "warning", border: "border-l-warning", icon: <AlertTriangle aria-hidden /> },
  info: { badge: "info", border: "border-l-info", icon: <Info aria-hidden /> },
};

export interface InsightListProps {
  insights: Insight[];
  /** Texto do estado vazio. */
  emptyText?: string;
  /** Mostra no máximo N itens. */
  limit?: number;
  /** Versão enxuta (sem ação sugerida), para blocos laterais e Meu Dia. */
  compact?: boolean;
  className?: string;
}

/**
 * Lista de insights (gargalos detectados por regras): severidade, departamento, explicação com números,
 * evidências clicáveis e ação sugerida. Reutilizável no dashboard do gestor, no cockpit e no Meu Dia.
 */
export function InsightList({ insights, emptyText = "Nenhum gargalo detectado pelas regras neste período.", limit, compact, className }: InsightListProps) {
  const items = limit ? insights.slice(0, limit) : insights;
  if (items.length === 0) {
    return <EmptyState size="sm" icon={<ShieldCheck />} title="Tudo sob controle" description={emptyText} className={className} />;
  }
  return (
    <ul className={cn("flex flex-col gap-3", className)}>
      {items.map((insight) => {
        const tone = TONE[insight.severity];
        return (
          <li key={insight.key} className={cn("rounded-lg border border-l-4 border-border bg-surface p-3.5 shadow-card", tone.border)}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={tone.badge} size="sm">
                {tone.icon} {SEVERITY_LABELS[insight.severity]}
              </Badge>
              <span className="text-xs text-muted">{DEPARTMENT_LABELS[insight.department]}</span>
            </div>
            <h3 className="mt-1.5 text-sm font-semibold leading-snug text-foreground">{insight.title}</h3>
            <p className="mt-1 text-sm text-muted">{insight.explanation}</p>
            {insight.evidence.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {insight.evidence.slice(0, compact ? 3 : 6).map((e) => (
                  <Link
                    key={`${e.href}-${e.label}`}
                    href={e.href}
                    className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border bg-surface-muted px-2.5 text-xs text-foreground transition-colors hover:border-border-strong hover:bg-surface-hover"
                  >
                    {e.label}
                    <ArrowRight className="size-3 text-muted" aria-hidden />
                  </Link>
                ))}
              </div>
            ) : null}
            {!compact ? (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-foreground">
                <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
                <span>
                  <span className="font-medium">Ação sugerida:</span> {insight.suggestedAction}
                </span>
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
