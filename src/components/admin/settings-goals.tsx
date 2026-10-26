"use client";

import * as React from "react";
import { ScreenLink } from "@/components/auth/access-provider";
import type { MetasReferencia } from "@/server/admin/schemas";
import { DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import { REFERENCE_GOALS, type ReferenceGoalField, type ReferenceGoalRow } from "@/domain/reference-goals";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { fractionToPercentInput, numberToInput, parseNumber, percentInputToFraction } from "./admin-model";
import { SettingsSection } from "./settings-section";
import { useSaveSetting } from "./use-save-setting";

function toInput(kind: ReferenceGoalRow["kind"], value: number): string {
  return kind === "percent" ? fractionToPercentInput(value) : numberToInput(value);
}

/**
 * Metas de referência por departamento. Cada meta é a meta mensal do indicador correspondente (Administração ›
 * Indicadores): salvar aqui leva o valor para o indicador, e mudar o indicador aparece aqui. Sem o indicador cadastrado,
 * o valor fica só nesta configuração.
 */
export function SettingsGoals({ value, stored, rows }: { value: MetasReferencia; stored: boolean; rows?: ReferenceGoalRow[] }) {
  const { pending, error, setError, save } = useSaveSetting("metas_referencia");
  // Linhas vindas do servidor (com a meta do indicador); sem elas, a configuração pura com os departamentos.
  const list: ReferenceGoalRow[] = React.useMemo(
    () => rows ?? REFERENCE_GOALS.map((d) => ({ ...d, value: value[d.field], source: "configuracao" as const })),
    [rows, value],
  );
  const [form, setForm] = React.useState<Record<ReferenceGoalField, string>>(() => Object.fromEntries(list.map((r) => [r.field, toInput(r.kind, r.value)])) as Record<ReferenceGoalField, string>);
  const departments = Array.from(new Set(list.map((r) => r.department)));
  const [department, setDepartment] = React.useState<DepartmentKey | "">("");
  const shown = list.filter((r) => !department || r.department === department);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const out: Partial<MetasReferencia> = {};
    for (const r of list) {
      const n = r.kind === "percent" ? percentInputToFraction(form[r.field]) : parseNumber(form[r.field]);
      if (Number.isNaN(n)) {
        setError(`Informe um número válido em "${r.label}" (${DEPARTMENT_LABELS[r.department]})`);
        return;
      }
      out[r.field] = n;
    }
    save(out, "Metas por departamento salvas (e levadas aos indicadores)");
  };

  return (
    <SettingsSection
      title="Metas de referência por departamento"
      description="Cada meta é a meta mensal do indicador do departamento (Administração › Indicadores): mudar aqui muda lá, e vice-versa. Percentuais de 0 a 100."
      stored={stored}
      pending={pending}
      error={error}
      onSubmit={submit}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Select value={department} onChange={(e) => setDepartment(e.target.value as DepartmentKey | "")} aria-label="Filtrar por departamento" className="h-11 sm:max-w-[240px] md:h-9">
            <option value="">Todos os departamentos</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {DEPARTMENT_LABELS[d]}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted">
            Meta do mês por departamento ou colaborador:{" "}
            <ScreenLink href="/performance/metas" className="font-medium text-brand-fg hover:underline">
              Performance › Metas
            </ScreenLink>{" "}
            ·{" "}
            <ScreenLink href="/admin/indicadores" className="font-medium text-brand-fg hover:underline">
              Indicadores
            </ScreenLink>
          </p>
        </div>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="reference-goals">
          {shown.map((r) => (
            <li key={r.field} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <Badge variant="info" size="sm">
                    {DEPARTMENT_LABELS[r.department]}
                  </Badge>
                  <label htmlFor={`meta-${r.field}`}>{r.label}</label>
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {r.hint}{" "}
                  {r.source === "indicador" ? (
                    <>
                      · meta do indicador <span className="font-medium">{r.kpiName}</span>
                      {r.kpiActive === false ? " (inativo)" : ""}
                    </>
                  ) : r.kpiName ? (
                    <>· o indicador {r.kpiName} ainda não tem meta: salvar aqui define a meta dele</>
                  ) : (
                    <>· indicador não cadastrado: o valor vale só aqui até você cadastrá-lo</>
                  )}
                </p>
              </div>
              <Input
                id={`meta-${r.field}`}
                inputMode="decimal"
                value={form[r.field]}
                onChange={(e) => setForm((s) => ({ ...s, [r.field]: e.target.value }))}
                required
                className="h-11 tabular-nums sm:w-[140px] md:h-9"
              />
            </li>
          ))}
        </ul>
      </div>
    </SettingsSection>
  );
}
