"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Info, Settings2 } from "lucide-react";
import type { OperationHealth } from "@/server/kpis/operation-health";
import type { OperationHealthConfig } from "@/server/kpis/health-schemas";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScoreGauge } from "@/components/ui/score-gauge";
import { toneForPercent, toneText } from "@/components/ui/tone";
import { OperationHealthSettingsForm, type KpiOption } from "./operation-health-settings";

export interface OperationHealthCardProps {
  health: OperationHealth;
  /** Componentes mostrados sob o medidor (padrão: produtividade, sla, qualidade). */
  highlight?: string[];
  /** Admin/diretoria: dados do editor de configuração. */
  config?: { value: OperationHealthConfig; kpis: KpiOption[] };
}

function scoreText(score: number | null): string {
  return score === null ? "—" : `${Math.round(score)}`;
}

/**
 * Saúde da operação: medidor 0–100 com a faixa, as notas de Produtividade/SLA/Qualidade e o "ver detalhes"
 * explicando cada componente (peso, contribuição, indicadores, normalização e link do drill-down).
 */
export function OperationHealthCard({ health, highlight = ["produtividade", "sla", "qualidade"], config }: OperationHealthCardProps) {
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const shown = highlight.map((k) => health.components.find((c) => c.key === k)).filter((c): c is OperationHealth["components"][number] => Boolean(c));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-base font-semibold">
          Saúde da operação
          <button type="button" onClick={() => setOpen(true)} className="inline-flex size-6 items-center justify-center rounded-full text-muted hover:text-foreground" aria-label="Como a saúde é calculada">
            <Info className="size-4" aria-hidden />
          </button>
        </h3>
        <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-[44px] items-center gap-0.5 text-[13px] font-medium text-brand-fg hover:text-brand-hover md:min-h-0">
          Ver detalhes <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
      <div className="mt-3">
        <ScoreGauge value={health.score === null ? null : Math.round(health.score)} label={health.band?.label ?? "Sem dados"} tone={health.tone} />
      </div>
      <dl className="mt-4 grid grid-cols-3 divide-x divide-border text-center">
        {shown.map((c) => {
          const tone = toneForPercent(c.score, 80, 60);
          return (
            <div key={c.key} className="px-1">
              <dt className="truncate text-xs text-muted">{c.label}</dt>
              <dd className={cn("mt-0.5 text-2xl font-semibold tabular-nums", toneText[tone])}>{c.score === null ? "—" : `${Math.round(c.score)}%`}</dd>
              <dd className={cn("text-[11px]", toneText[tone])}>{c.score === null ? "sem dados" : c.score >= 80 ? "Dentro da meta" : c.score >= 60 ? "Atenção" : "Crítico"}</dd>
            </div>
          );
        })}
      </dl>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(false); }}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Configurar Saúde da operação" : `Saúde da operação · ${health.scopeLabel}`}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Componentes, pesos, indicadores e faixas. Vale para o Cockpit e para o Dashboard do Gestor."
                : `${health.period.label}. Nota geral = média ponderada dos componentes com dado; cada componente = média ponderada das notas (0–100) dos seus indicadores.`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="max-h-[70dvh] overflow-y-auto scrollbar-thin">
            {editing && config ? (
              <OperationHealthSettingsForm value={config.value} kpis={config.kpis} onSaved={() => setEditing(false)} />
            ) : (
              <div className="flex flex-col gap-4">
                <p className="text-sm">
                  Nota <span className="font-semibold tabular-nums">{scoreText(health.score)}/100</span> · faixa <span className={cn("font-semibold", toneText[health.tone])}>{health.band?.label ?? "—"}</span>. Faixas:{" "}
                  {[...health.bands].sort((a, b) => b.min - a.min).map((b) => `${b.label} ≥ ${b.min}`).join(" · ")}.
                </p>
                <ul className="flex flex-col gap-3">
                  {health.components.map((c) => (
                    <li key={c.key} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-semibold">
                          {c.label} <span className="font-normal text-muted">· peso {c.weight}</span>
                        </p>
                        <p className="text-sm tabular-nums">
                          <span className={cn("font-semibold", toneText[toneForPercent(c.score, 80, 60)])}>{scoreText(c.score)}</span>
                          <span className="text-muted"> · contribui {c.contribution === null ? "—" : `${Math.round(c.contribution * 10) / 10} pts`}</span>
                        </p>
                      </div>
                      {c.description ? <p className="mt-1 text-xs text-muted">{c.description}</p> : null}
                      <ul className="mt-2 divide-y divide-border text-sm">
                        {c.items.map((i) => (
                          <li key={i.kpiKey} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                            <span className="min-w-0">
                              {i.href ? (
                                <Link href={i.href} className="font-medium hover:text-brand-fg hover:underline">
                                  {i.name}
                                </Link>
                              ) : (
                                <span className="font-medium">{i.name}</span>
                              )}
                              <span className="block text-xs text-muted">
                                {i.valueText} · {i.normalization} · peso {i.weight}
                                {i.note ? ` · ${i.note}` : ""}
                              </span>
                            </span>
                            <span className="shrink-0 font-semibold tabular-nums">{scoreText(i.score)}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
                {config ? (
                  <Button variant="outline" className="self-start" onClick={() => setEditing(true)}>
                    <Settings2 /> Configurar componentes
                  </Button>
                ) : null}
              </div>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
