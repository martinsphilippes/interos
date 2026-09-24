"use client";

import * as React from "react";
import { Calculator } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format";
import { REVENUE_TYPE_LABELS, REVENUE_TYPES, describeRule, estimateCommission, type CommissionRuleView } from "./model";

/**
 * Simulador de comissão: o vendedor digita adesão, mensalidade e hardware de um negócio e vê a
 * comissão estimada por tipo, com as regras ativas carregadas do banco (as mesmas do cálculo real).
 */
export function CommissionSimulator({ rules }: { rules: CommissionRuleView[] }) {
  const id = React.useId();
  const [values, setValues] = React.useState({ setup: "", recorrencia: "", hardware: "" });
  const parsed = { setup: Number(values.setup.replace(",", ".")) || 0, recorrencia: Number(values.recorrencia.replace(",", ".")) || 0, hardware: Number(values.hardware.replace(",", ".")) || 0 };
  const estimate = estimateCommission(rules, parsed);
  const inputLabel = { setup: "Adesão/setup (R$)", recorrencia: "Mensalidade (R$)", hardware: "Hardware (R$)" } as const;

  if (rules.length === 0) return <p className="text-sm text-muted">Nenhuma regra de comissão ativa cadastrada.</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        {REVENUE_TYPES.map((t) => (
          <label key={t} htmlFor={`${id}-${t}`} className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{inputLabel[t]}</span>
            <Input id={`${id}-${t}`} type="number" inputMode="decimal" min={0} step="0.01" value={values[t]} onChange={(e) => setValues((v) => ({ ...v, [t]: e.target.value }))} placeholder="0" />
          </label>
        ))}
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {REVENUE_TYPES.map((t) => {
          const rule = estimate.rules[t];
          return (
            <li key={t} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="block text-sm">{REVENUE_TYPE_LABELS[t]}</span>
                <span className="block truncate text-xs text-muted">{rule ? describeRule(rule) : "Sem regra ativa"}</span>
              </span>
              <span className="text-sm font-semibold tabular-nums">{formatCurrency(estimate[t])}</span>
            </li>
          );
        })}
        <li className="flex items-center justify-between gap-3 bg-surface-muted px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <Calculator className="size-4 text-muted" /> Comissão estimada
          </span>
          <span className="text-base font-bold tabular-nums">{formatCurrency(estimate.total)}</span>
        </li>
      </ul>
      <p className="text-xs text-muted">Estimativa com as regras padrão por tipo de receita. Regras específicas de produto são aplicadas no cálculo real ao ganhar o negócio.</p>
    </div>
  );
}
