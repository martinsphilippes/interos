"use client";

import * as React from "react";
import type { MetasReferencia } from "@/server/admin/schemas";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { fractionToPercentInput, numberToInput, parseNumber, percentInputToFraction } from "./admin-model";
import { SettingsSection } from "./settings-section";
import { useSaveSetting } from "./use-save-setting";

type Field = { key: keyof MetasReferencia; label: string; hint: string; kind: "percent" | "score" | "currency" };

/** Campos da configuração, na ordem de exibição. `percent` é gravado como fração (0.03). */
const FIELDS: Field[] = [
  { key: "csat", label: "CSAT mínimo (0–10)", hint: "Nota média de satisfação no suporte.", kind: "score" },
  { key: "churnMax", label: "Churn máximo mensal (%)", hint: "Cancelamentos sobre a base ativa.", kind: "percent" },
  { key: "reincidenciaMax", label: "Reincidência máxima de chamados (%)", hint: "Chamados reabertos ou repetidos.", kind: "percent" },
  { key: "slaSuporte", label: "Cumprimento de SLA no suporte (%)", hint: "Chamados resolvidos dentro do prazo.", kind: "percent" },
  { key: "implantacaoPrazo", label: "Implantações no prazo (%)", hint: "Go-live até a data prevista.", kind: "percent" },
  { key: "ativacao7dias", label: "Ativação em até 7 dias (%)", hint: "Clientes ativados na primeira semana.", kind: "percent" },
  { key: "mrrCrescimento", label: "Crescimento mensal de MRR (%)", hint: "Meta de expansão da receita recorrente.", kind: "percent" },
  { key: "ticketMedio", label: "Ticket médio de venda (R$)", hint: "Valor mensal médio por nova venda.", kind: "currency" },
];

function toInput(field: Field, value: number): string {
  return field.kind === "percent" ? fractionToPercentInput(value) : numberToInput(value);
}

export function SettingsGoals({ value, stored }: { value: MetasReferencia; stored: boolean }) {
  const { pending, error, setError, save } = useSaveSetting("metas_referencia");
  const [form, setForm] = React.useState<Record<keyof MetasReferencia, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, toInput(f, value[f.key])])) as Record<keyof MetasReferencia, string>);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const out: Partial<MetasReferencia> = {};
    for (const f of FIELDS) {
      const n = f.kind === "percent" ? percentInputToFraction(form[f.key]) : parseNumber(form[f.key]);
      if (Number.isNaN(n)) {
        setError(`Informe um número válido em "${f.label}"`);
        return;
      }
      out[f.key] = n;
    }
    save(out, "Metas de referência salvas");
  };

  return (
    <SettingsSection title="Metas de referência" description="Metas da empresa usadas como padrão em indicadores, bônus e alertas. Percentuais são informados de 0 a 100." stored={stored} pending={pending} error={error} onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FIELDS.map((f) => (
          <FormField key={f.key} label={f.label} htmlFor={`meta-${f.key}`} hint={f.hint} required>
            <Input
              id={`meta-${f.key}`}
              type="number"
              inputMode="decimal"
              step={f.kind === "score" ? "0.1" : f.kind === "currency" ? "1" : "0.1"}
              min={0}
              max={f.kind === "score" ? 10 : f.kind === "percent" ? 100 : undefined}
              value={form[f.key]}
              onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
              required
              className="tabular-nums"
            />
          </FormField>
        ))}
      </div>
    </SettingsSection>
  );
}
