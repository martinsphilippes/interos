"use client";

import * as React from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCircle, Calculator, CheckCircle2, CircleDashed, Clock3, Star, XCircle } from "lucide-react";
import type { BonusComputation } from "@/server/performance/bonus";
import type { BonusResult } from "@/domain/types";
import { sortTiers } from "@/server/performance/schemas";
import { formatKpiValue } from "@/server/kpis/schemas";
import { formatCompetence, formatCurrency, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CHART_SERIES, chartAxisTick, chartCursor, chartGridProps, chartTooltipClassName } from "@/lib/chart-theme";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { bonusAllocation } from "./bonus-allocation";
import { BonusSimulator, type SimulatorLine } from "./bonus-simulator";
import { formatGap } from "./bonus-status";

/** "Composição do bônus": rosca por critério (rateio do valor da faixa + extras) com a lista ao lado. */
export function BonusCompositionDonut({ c }: { c: BonusComputation }) {
  const lines = bonusAllocation(c).filter((l) => (l.amount ?? 0) > 0);
  const total = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
  if (lines.length === 0) {
    return <EmptyState size="sm" title="Sem valor a compor" description={c.blocked ? "Bônus do mês bloqueado." : c.salary === null ? "Salário base não cadastrado: o valor em reais fica indisponível." : "Nenhum critério gerou valor na competência."} />;
  }
  return (
    <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
      <div className="relative mx-auto size-[180px]" role="img" aria-label={`Composição do bônus: total ${formatCurrency(total)}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={lines} dataKey="amount" nameKey="name" innerRadius={62} outerRadius={86} paddingAngle={2} stroke="none" isAnimationActive={false}>
              {lines.map((l, i) => (
                <Cell key={l.key} fill={CHART_SERIES[i % CHART_SERIES.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-lg font-semibold tabular-nums">{formatCurrency(total)}</span>
          <span className="text-[11px] text-muted">projetado</span>
        </div>
      </div>
      <ul className="flex min-w-0 flex-col gap-2">
        {lines.map((l, i) => (
          <li key={l.key} className="rounded-lg border border-border bg-surface-muted/50 px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: CHART_SERIES[i % CHART_SERIES.length] }} aria-hidden />
                <span className="truncate">{l.name}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{formatCurrency(l.amount)}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-track" aria-hidden>
                <span className="block h-full rounded-full" style={{ width: `${(l.share ?? 0) * 100}%`, background: CHART_SERIES[i % CHART_SERIES.length] }} />
              </span>
              <span className="w-12 text-right text-[11px] tabular-nums text-muted">{formatPercent(l.share)}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Faixa atual": medalha, rótulo configurado, % de pagamento, barra entre a faixa atual e a próxima e o simulador. */
export function BonusTierCard({ c, simulatorLines }: { c: BonusComputation; simulatorLines: SimulatorLine[] }) {
  const [open, setOpen] = React.useState(false);
  const rule = c.rule;
  if (!rule) return null;
  const tiers = sortTiers(rule.tiers);
  const floor = c.tier?.minAttainment ?? 0;
  const ceiling = c.nextTier?.minAttainment ?? Math.max(1, floor);
  const overall = c.overallAttainment ?? 0;
  const pos = ceiling > floor ? Math.max(0, Math.min(1, (overall - floor) / (ceiling - floor))) : 1;
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-4">
        <span className={cn("inline-flex size-20 shrink-0 items-center justify-center rounded-2xl", c.tier && c.tier.payoutPct > 0 ? "bg-gradient-to-b from-warning/60 to-brand/30 text-warning-fg" : "bg-surface-hover text-muted")}>
          <Star className="size-9" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted">Faixa atual</p>
          <p className="truncate text-2xl font-semibold text-warning-fg">{c.overallAttainment === null ? "Sem dados" : (c.tier?.label ?? "Abaixo da faixa mínima")}</p>
          <p className="text-sm text-muted">
            paga {c.payoutPct}% do bônus · {tiers.length} faixa(s) na regra
          </p>
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{formatPercent(floor)}</span>
          <span className="font-semibold text-foreground tabular-nums">{formatPercent(c.overallAttainment)}</span>
          <span>{c.nextTier ? formatPercent(ceiling) : "máx."}</span>
        </div>
        <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-track" aria-hidden>
          <div className="h-full rounded-full bg-gradient-to-r from-brand to-warning" style={{ width: `${pos * 100}%` }} />
        </div>
      </div>
      {c.nextTier ? (
        <p className="flex items-center gap-2 rounded-lg border border-warning/35 bg-warning-soft/40 px-3 py-2 text-sm text-warning-fg">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          Faltam {formatGap(c.nextTier.gap)} de atingimento geral para a faixa {c.nextTier.label}
        </p>
      ) : c.tier ? (
        <p className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-soft/40 px-3 py-2 text-sm text-success-fg">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden /> Faixa máxima da regra
        </p>
      ) : null}
      <Button className="mt-auto h-11" onClick={() => setOpen(true)}>
        <Calculator /> Simular resultado
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>Simular resultado</DialogTitle>
            <DialogDescription>Ajuste os indicadores e veja a faixa e o valor resultantes. Nada é gravado: os dados reais não mudam.</DialogDescription>
          </DialogHeader>
          <DialogBody className="max-h-[72dvh] overflow-y-auto scrollbar-thin">
            <BonusSimulator rule={rule} lines={simulatorLines} salary={c.salary} extrasAmount={c.extrasAmount} blocked={c.blocked} />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** "Faixas de premiação": nomes e limiares configurados na regra, com a faixa atual e a próxima destacadas. */
export function BonusTiersList({ c }: { c: BonusComputation }) {
  if (!c.rule) return null;
  const tiers = sortTiers(c.rule.tiers).reverse();
  const max = Math.max(1, ...tiers.map((t) => t.minAttainment));
  return (
    <ul className="flex flex-col gap-2">
      {tiers.map((t) => {
        const current = c.tier?.minAttainment === t.minAttainment && c.overallAttainment !== null;
        const next = c.nextTier?.minAttainment === t.minAttainment;
        return (
          <li key={t.minAttainment} className={cn("rounded-lg border px-3 py-2.5", current ? "border-warning bg-warning-soft/30" : "border-border bg-surface-muted/50")}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <Star className={cn("size-4 shrink-0", t.payoutPct > 0 ? "text-warning-fg" : "text-muted-light")} aria-hidden />
                <span className="truncate">{t.label}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {current ? (
                  <Badge variant="warning" size="sm">
                    Faixa atual
                  </Badge>
                ) : null}
                {next ? (
                  <Badge variant="purple" size="sm">
                    Próxima faixa
                  </Badge>
                ) : null}
                <span className="text-xs text-muted tabular-nums">paga {t.payoutPct}%</span>
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="w-10 text-xs tabular-nums text-muted">≥ {Math.round(t.minAttainment * 100)}%</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-track" aria-hidden>
                <span className="block h-full rounded-full bg-brand" style={{ width: `${(t.minAttainment / max) * 100}%` }} />
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function lineStatus(attainment: number | null): { label: string; variant: "success" | "warning" | "danger" | "muted"; icon: React.ReactNode } {
  if (attainment === null) return { label: "Sem dados", variant: "muted", icon: <CircleDashed /> };
  if (attainment >= 1) return { label: "Meta atingida", variant: "success", icon: <CheckCircle2 /> };
  if (attainment >= 0.85) return { label: "Em andamento", variant: "warning", icon: <Clock3 /> };
  return { label: "Ainda não atingida", variant: "danger", icon: <XCircle /> };
}

/** "Minhas metas" do bônus: critério, meta, realizado, peso efetivo, valor conquistado (rateio) e status. */
export function BonusGoalsTable({ c }: { c: BonusComputation }) {
  const allocation = new Map(bonusAllocation(c).map((a) => [a.key, a]));
  const rows = [...c.individual.lines.map((l) => ({ l, block: "individual" as const, w: c.weights.individual })), ...c.collective.lines.map((l) => ({ l, block: "coletivo" as const, w: c.weights.collective }))];
  if (rows.length === 0) return <EmptyState size="sm" title="Regra sem indicadores" />;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-y border-border bg-surface-muted text-left text-xs text-muted">
            <th className="px-5 py-2 font-medium">Critério</th>
            <th className="px-3 py-2 text-right font-medium">Meta</th>
            <th className="px-3 py-2 text-right font-medium">Realizado</th>
            <th className="px-3 py-2 text-right font-medium" title="Peso efetivo no atingimento geral (peso do bloco × peso relativo no bloco)">
              Peso
            </th>
            <th className="px-3 py-2 text-right font-medium">Valor conquistado</th>
            <th className="px-5 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(({ l, block, w }) => {
            const a = allocation.get(`${block}-${l.kpiKey}`);
            const s = lineStatus(l.attainment);
            const op = l.direction === "menor_melhor" ? "≤ " : "";
            return (
              <tr key={`${block}-${l.kpiKey}`} className="hover:bg-surface-hover">
                <td className="px-5 py-2.5">
                  <Link href={l.href} className="font-medium hover:text-brand-fg hover:underline">
                    {l.name}
                  </Link>
                  <span className="block text-xs text-muted">
                    {block === "individual" ? "Individual" : `Coletivo · ${l.scopeLabel}`}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted">
                  {op}
                  {formatKpiValue(l.target, l.unit, l.suffix)}
                </td>
                <td className={cn("whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums", l.attainment === null ? "text-muted" : l.attainment >= 1 ? "text-success-fg" : l.attainment >= 0.85 ? "text-warning-fg" : "text-danger-fg")}>
                  {formatKpiValue(l.value, l.unit, l.suffix)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{l.share === null ? `${l.weight}` : formatPercent(l.share * w)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums">{formatCurrency(a?.amount ?? null)}</td>
                <td className="px-5 py-2.5">
                  <Badge variant={s.variant} size="sm" className="gap-1 [&_svg]:size-3.5">
                    {s.icon} {s.label}
                  </Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type HistoryItem = BonusResult & { ruleVersion?: number; salary?: number };

/** "Histórico de premiações": valor pago/projetado por competência fechada (bonus_results). */
export function BonusHistoryChart({ items, height = 200 }: { items: HistoryItem[]; height?: number }) {
  const data = [...items]
    .sort((a, b) => (a.period < b.period ? -1 : 1))
    .slice(-6)
    .map((r) => ({ label: formatCompetence(r.period), total: r.blocked ? 0 : r.projectedAmount + r.extrasAmount, blocked: r.blocked, tier: r.tierLabel }));
  if (data.length === 0) return <EmptyState size="sm" title="Nenhuma competência fechada" description="Quando o gestor fechar o mês, o valor aparece aqui." />;
  return (
    <div style={{ height }} role="img" aria-label="Histórico de premiações por competência">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 22, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} {...chartGridProps} />
          <XAxis dataKey="label" tick={chartAxisTick} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip
            cursor={chartCursor}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !p) return null;
              return (
                <div className={chartTooltipClassName}>
                  <p className="font-semibold capitalize">{p.label}</p>
                  <p className="text-muted">
                    {formatCurrency(p.total)} · {p.blocked ? "bloqueado" : p.tier}
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="total" radius={[6, 6, 0, 0]} maxBarSize={56} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.blocked ? "var(--color-danger)" : "var(--color-info)"} />
            ))}
            <LabelList dataKey="total" position="top" formatter={(v: unknown) => (typeof v === "number" ? formatCurrency(v) : "")} style={{ fill: "var(--color-foreground)", fontSize: 11 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
