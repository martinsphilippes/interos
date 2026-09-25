"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import type { BonusRule } from "@/domain/types";
import { attainmentAgainst, bonusAmount, combineAttainment, resolveTier, sortTiers, weightedAttainment } from "@/server/performance/schemas";
import { formatKpiValue, type KpiUnit } from "@/server/kpis/schemas";
import { formatCurrency, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AttainmentBar } from "@/components/kpis/attainment-bar";
import { formatGap, statusFor } from "./bonus-status";

export interface SimulatorLine {
  block: "individual" | "coletivo";
  kpiKey: string;
  name: string;
  scopeLabel: string;
  unit: KpiUnit;
  suffix?: string;
  direction: "maior_melhor" | "menor_melhor" | "faixa";
  weight: number;
  target: number;
  value: number | null;
}

export interface BonusSimulatorProps {
  rule: Pick<BonusRule, "tiers" | "maxPctOfSalary" | "individualWeight" | "collectiveWeight">;
  lines: SimulatorLine[];
  salary: number | null;
  extrasAmount: number;
  blocked: boolean;
}

/** Faixa do controle deslizante conforme a unidade e a meta do indicador. */
function rangeFor(line: SimulatorLine): { min: number; max: number; step: number } {
  if (line.unit === "percentual") return { min: 0, max: 1, step: 0.01 };
  if (/csat/.test(line.kpiKey)) return { min: 0, max: 10, step: 0.1 };
  const base = Math.max(line.target * 2, (line.value ?? 0) * 1.5, 1);
  const step = base <= 10 ? 0.1 : base <= 200 ? 1 : Math.pow(10, Math.floor(Math.log10(base)) - 2);
  return { min: 0, max: Math.ceil(base / step) * step, step };
}

/**
 * Simulador do bônus: um controle por indicador ("se meu SLA de solução for X% e o CSAT Y...") mostrando o
 * atingimento, a faixa e o valor resultantes. Usa a mesma matemática do motor de bônus (schemas.ts).
 */
export function BonusSimulator({ rule, lines, salary, extrasAmount, blocked }: BonusSimulatorProps) {
  const initial = React.useMemo(() => lines.map((l) => ({ enabled: l.value !== null, value: l.value ?? l.target })), [lines]);
  const [state, setState] = React.useState(initial);
  const id = React.useId();

  const computed = lines.map((l, i) => {
    const s = state[i];
    return { ...l, simulated: s.value, enabled: s.enabled, attainment: s.enabled ? attainmentAgainst(s.value, l.direction, l.target) : null };
  });
  const ind = weightedAttainment(computed.filter((c) => c.block === "individual"));
  const col = weightedAttainment(computed.filter((c) => c.block === "coletivo"));
  const indEmpty = rule.individualWeight > 0 && computed.some((c) => c.block === "individual") && ind === null;
  const colEmpty = rule.collectiveWeight > 0 && computed.some((c) => c.block === "coletivo") && col === null;
  const overall = indEmpty || colEmpty ? null : combineAttainment(ind, col, rule.individualWeight, rule.collectiveWeight).overall;
  const { current, next } = resolveTier(rule.tiers, overall);
  const tierAmount = bonusAmount(salary, rule.maxPctOfSalary, current?.payoutPct ?? 0);
  const total = blocked ? 0 : tierAmount === null ? null : tierAmount + extrasAmount;

  const set = (i: number, patch: Partial<{ enabled: boolean; value: number }>) => setState((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        {computed.map((c, i) => {
          const range = rangeFor(c);
          const inputId = `${id}-${i}`;
          return (
            <div key={`${c.block}-${c.kpiKey}`} className={cn("rounded-lg border border-border p-3", !c.enabled && "bg-surface-muted")}>
              <div className="flex items-start justify-between gap-2">
                <label htmlFor={inputId} className="min-w-0">
                  <span className="block text-sm font-medium">{c.name}</span>
                  <span className="block text-xs text-muted">
                    {c.block === "individual" ? "Individual" : `Coletivo · ${c.scopeLabel}`} · peso {c.weight} · meta {formatKpiValue(c.target, c.unit, c.suffix)}
                  </span>
                </label>
                <Switch size="sm" checked={c.enabled} onCheckedChange={(v) => set(i, { enabled: v })} aria-label={`Incluir ${c.name} na simulação`} />
              </div>
              <div className="mt-2 flex items-center gap-3">
                <input
                  id={inputId}
                  type="range"
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  value={c.simulated}
                  disabled={!c.enabled}
                  onChange={(e) => set(i, { value: Number(e.target.value) })}
                  className="h-11 flex-1 accent-[var(--color-brand)] disabled:opacity-40 md:h-6"
                />
                <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums">{c.enabled ? formatKpiValue(c.simulated, c.unit, c.suffix) : "sem dados"}</span>
              </div>
              {c.enabled ? <AttainmentBar attainment={c.attainment} status={statusFor(c.attainment)} size="sm" className="mt-1" /> : <p className="mt-1 text-xs text-muted">Fora do cálculo (ligue para simular um valor)</p>}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-brand/30 bg-brand-soft/40 p-4 md:flex-row md:items-center md:justify-between">
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className="label-caps">Individual</p>
            <p className="text-lg font-semibold tabular-nums">{formatPercent(ind)}</p>
          </div>
          <div>
            <p className="label-caps">Coletivo</p>
            <p className="text-lg font-semibold tabular-nums">{formatPercent(col)}</p>
          </div>
          <div>
            <p className="label-caps">Geral · faixa</p>
            <p className="text-lg font-semibold tabular-nums">{formatPercent(overall)}</p>
            <p className="text-xs text-muted">
              {overall === null ? "bloco sem dados: não apurável" : `${current?.label ?? "abaixo da faixa mínima"} (${current?.payoutPct ?? 0}%)`}
              {next ? ` · faltam ${formatGap(next.gap)} para ${next.label}` : ""}
            </p>
          </div>
          <div>
            <p className="label-caps">Bônus simulado</p>
            <p className="text-lg font-semibold tabular-nums">{total === null ? "—" : formatCurrency(total)}</p>
            <p className="text-xs text-muted">{blocked ? "mês bloqueado" : salary === null ? "salário não cadastrado" : extrasAmount > 0 ? `inclui ${formatCurrency(extrasAmount)} de extras` : "sem extras"}</p>
          </div>
        </div>
        <Button variant="outline" className="min-h-[44px] md:min-h-0" onClick={() => setState(initial)}>
          <RotateCcw /> Valores atuais
        </Button>
      </div>
      <ul className="flex flex-wrap gap-2 text-xs">
        {sortTiers(rule.tiers).map((t) => (
          <li key={t.minAttainment} className={cn("rounded-full border px-2.5 py-1", current && current.minAttainment === t.minAttainment ? "border-brand bg-brand-soft text-brand-fg" : "border-border text-muted")}>
            {t.label}: ≥ {formatPercent(t.minAttainment)} → {t.payoutPct}%
          </li>
        ))}
      </ul>
    </div>
  );
}
