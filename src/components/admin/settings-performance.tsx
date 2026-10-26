"use client";

import * as React from "react";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import type { GamificacaoConfig, PremiosVendasConfig, SequenciaConfig } from "@/server/admin/schemas";
import { POINT_RULES } from "@/server/performance/schemas";
import { STREAK_CRITERIA, STREAK_CRITERION_LABELS, STREAK_RULE_TEXT, type StreakCriterion } from "@/server/performance/streak-rules";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { numberToInput, parseNumber } from "./admin-model";
import { SettingsSection } from "./settings-section";
import { useSaveSetting } from "./use-save-setting";

/**
 * Pontos por evento (padrão da empresa e, quando preciso, pontos próprios de cada departamento) e multiplicadores usados
 * no ranking "todos normalizado". Os níveis valem para a empresa toda (ranking comparável entre áreas).
 */
export function SettingsGamification({ value, stored }: { value: GamificacaoConfig; stored: boolean }) {
  const { pending, error, setError, save } = useSaveSetting("gamificacao");
  const [points, setPoints] = React.useState<Record<string, string>>(() => Object.fromEntries(POINT_RULES.map((r) => [r.key, numberToInput(value.pontos[r.key] ?? 0)])));
  // Pontos próprios por departamento: vazio = usa o padrão da empresa.
  const [own, setOwn] = React.useState<Record<DepartmentKey, Record<string, string>>>(
    () =>
      Object.fromEntries(
        DEPARTMENT_KEYS.map((d) => [d, Object.fromEntries(POINT_RULES.map((r) => [r.key, value.pontosPorDepartamento?.[d]?.[r.key] !== undefined ? numberToInput(value.pontosPorDepartamento[d]![r.key]) : ""]))]),
      ) as Record<DepartmentKey, Record<string, string>>,
  );
  const [scope, setScope] = React.useState<DepartmentKey | "">("");
  const [mult, setMult] = React.useState<Record<DepartmentKey, string>>(() => Object.fromEntries(DEPARTMENT_KEYS.map((d) => [d, numberToInput(value.multiplicadores[d] ?? 1)])) as Record<DepartmentKey, string>);
  const customCount = (d: DepartmentKey) => POINT_RULES.filter((r) => own[d][r.key].trim() !== "").length;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const pontos: Record<string, number> = { ...value.pontos };
    for (const r of POINT_RULES) {
      const n = parseNumber(points[r.key]);
      if (!Number.isInteger(n) || n < 0) return setError(`Informe pontos inteiros em "${r.label}"`);
      pontos[r.key] = n;
    }
    const pontosPorDepartamento: Partial<Record<DepartmentKey, Record<string, number>>> = {};
    for (const d of DEPARTMENT_KEYS) {
      const rules: Record<string, number> = {};
      for (const r of POINT_RULES) {
        const raw = own[d][r.key].trim();
        if (!raw) continue;
        const n = parseNumber(raw);
        if (!Number.isInteger(n) || n < 0) return setError(`Informe pontos inteiros em "${r.label}" (${DEPARTMENT_LABELS[d]}) ou deixe vazio para usar o padrão`);
        // Igual ao padrão não precisa ser guardado como exceção.
        if (n !== pontos[r.key]) rules[r.key] = n;
      }
      if (Object.keys(rules).length > 0) pontosPorDepartamento[d] = rules;
    }
    const multiplicadores = {} as Record<DepartmentKey, number>;
    for (const d of DEPARTMENT_KEYS) {
      const n = parseNumber(mult[d]);
      if (Number.isNaN(n) || n <= 0) return setError(`Informe um multiplicador válido para ${DEPARTMENT_LABELS[d]}`);
      multiplicadores[d] = n;
    }
    save({ pontos, multiplicadores, pontosPorDepartamento, niveis: value.niveis }, "Gamificação salva");
  };

  return (
    <SettingsSection
      title="Gamificação"
      description="Pontos creditados a cada evento. O padrão vale para a empresa; escolha um departamento para dar pontos próprios a ele (vazio = usa o padrão). Os níveis valem para todos."
      stored={stored}
      pending={pending}
      error={error}
      onSubmit={submit}
    >
      <div className="flex flex-col gap-5">
        <FormField label="Pontos de" htmlFor="gp-scope" hint={scope ? `Vazio = usa o padrão da empresa. ${DEPARTMENT_LABELS[scope]} tem ${customCount(scope)} regra(s) própria(s).` : "Padrão da empresa: vale para todos os departamentos sem pontos próprios."}>
          <Select id="gp-scope" value={scope} onChange={(e) => setScope(e.target.value as DepartmentKey | "")} className="h-11 sm:max-w-[320px] md:h-9">
            <option value="">Padrão da empresa</option>
            {DEPARTMENT_KEYS.map((d) => (
              <option key={d} value={d}>
                {DEPARTMENT_LABELS[d]}
                {customCount(d) ? ` · ${customCount(d)} próprio(s)` : ""}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="gamification-points">
          {POINT_RULES.map((r) =>
            scope ? (
              <FormField key={`${scope}-${r.key}`} label={r.label} htmlFor={`gp-${scope}-${r.key}`} hint={`${r.who} · padrão: ${points[r.key] || 0}`}>
                <Input
                  id={`gp-${scope}-${r.key}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step="1"
                  placeholder={`padrão (${points[r.key] || 0})`}
                  value={own[scope][r.key]}
                  onChange={(e) => setOwn((s) => ({ ...s, [scope]: { ...s[scope], [r.key]: e.target.value } }))}
                  className="tabular-nums"
                />
              </FormField>
            ) : (
              <FormField key={r.key} label={r.label} htmlFor={`gp-${r.key}`} hint={r.who} required>
                <Input id={`gp-${r.key}`} type="number" inputMode="numeric" min={0} step="1" value={points[r.key]} onChange={(e) => setPoints((s) => ({ ...s, [r.key]: e.target.value }))} required className="tabular-nums" />
              </FormField>
            ),
          )}
        </div>
        <div>
          <p className="label-caps mb-2">Multiplicadores por departamento</p>
          <p className="mb-2 text-xs text-muted">Usados no ranking “todos normalizado” para comparar funções com volumes de eventos diferentes.</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {DEPARTMENT_KEYS.map((d) => (
              <FormField key={d} label={DEPARTMENT_LABELS[d]} htmlFor={`gm-${d}`} required>
                <Input id={`gm-${d}`} type="number" inputMode="decimal" min={0.1} max={10} step="0.1" value={mult[d]} onChange={(e) => setMult((s) => ({ ...s, [d]: e.target.value }))} required className="tabular-nums" />
              </FormField>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted">Níveis (iguais para a empresa toda): {value.niveis.map((n) => `${n.nome} (${n.minimo} pts)`).join(" · ")}.</p>
      </div>
    </SettingsSection>
  );
}

const PRIZE_FIELDS: { key: "adesao" | "recorrencia" | "hardware"; label: string }[] = [
  { key: "adesao", label: "Meta de adesão/setup batida" },
  { key: "recorrencia", label: "Meta de recorrência batida" },
  { key: "hardware", label: "Meta de hardware batida" },
];

function prizeToInput(v: string | number): string {
  return typeof v === "number" ? numberToInput(v) : v;
}

/** Prêmios de meta mensal batida em Vendas (setting "premios_vendas"). */
export function SettingsSalesPrizes({ value, stored }: { value: PremiosVendasConfig; stored: boolean }) {
  const { pending, error, setError, save } = useSaveSetting("premios_vendas");
  const [form, setForm] = React.useState(() => ({ salarioMinimo: numberToInput(value.salarioMinimo), adesao: prizeToInput(value.adesao), recorrencia: prizeToInput(value.recorrencia), hardware: prizeToInput(value.hardware) }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const salarioMinimo = parseNumber(form.salarioMinimo);
    if (Number.isNaN(salarioMinimo) || salarioMinimo <= 0) return setError("Informe o salário mínimo de referência");
    const out: PremiosVendasConfig = { salarioMinimo, adesao: 0, recorrencia: 0, hardware: 0 };
    for (const f of PRIZE_FIELDS) {
      const raw = form[f.key].trim();
      if (/^\d+(?:[.,]\d+)?_salarios?$/.test(raw)) out[f.key] = raw;
      else {
        const n = parseNumber(raw);
        if (Number.isNaN(n) || n < 0) return setError(`Em "${f.label}" use N_salario (ex.: 1_salario) ou um valor em R$`);
        out[f.key] = n;
      }
    }
    save(out, "Prêmios de vendas salvos");
  };

  return (
    <SettingsSection
      title="Prêmios de vendas"
      description="Prêmio pago quando o vendedor bate a meta mensal de cada tipo de receita. Use 1_salario (salários mínimos) ou um valor fixo em R$."
      stored={stored}
      pending={pending}
      error={error}
      onSubmit={submit}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Salário mínimo de referência (R$)" htmlFor="pv-salario" required>
          <Input id="pv-salario" type="number" inputMode="decimal" min={0} step="0.01" value={form.salarioMinimo} onChange={(e) => setForm((s) => ({ ...s, salarioMinimo: e.target.value }))} required className="tabular-nums" />
        </FormField>
        {PRIZE_FIELDS.map((f) => (
          <FormField key={f.key} label={f.label} htmlFor={`pv-${f.key}`} hint="Ex.: 1_salario ou 500" required>
            <Input id={`pv-${f.key}`} value={form[f.key]} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} required />
          </FormField>
        ))}
      </div>
    </SettingsSection>
  );
}

/** Regra da sequência em dias exibida no Ranking e em Meu Desempenho (setting "gamificacao.sequencia"). */
export function SettingsStreak({ value, stored }: { value: SequenciaConfig; stored: boolean }) {
  const { pending, error, setError, save } = useSaveSetting("gamificacao.sequencia");
  const [criterio, setCriterio] = React.useState<StreakCriterion>(value.criterio);
  const [maxDias, setMaxDias] = React.useState(numberToInput(value.maxDias));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseNumber(maxDias);
    if (!Number.isInteger(n) || n < 5 || n > 365) return setError("Informe a janela em dias úteis (5 a 365)");
    save({ criterio, maxDias: n }, "Regra da sequência salva");
  };

  return (
    <SettingsSection
      title="Sequência em dias"
      description="Critério para um dia útil contar na sequência do Ranking e de Meu Desempenho. A sequência para no primeiro dia útil que não cumpre a regra."
      stored={stored}
      pending={pending}
      error={error}
      onSubmit={submit}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Regra da sequência" htmlFor="seq-criterio" hint={STREAK_RULE_TEXT[criterio]} required>
          <Select
            id="seq-criterio"
            value={criterio}
            onChange={(e) => setCriterio(e.target.value as StreakCriterion)}
            options={STREAK_CRITERIA.map((c) => ({ value: c, label: STREAK_CRITERION_LABELS[c] }))}
          />
        </FormField>
        <FormField label="Janela máxima (dias úteis)" htmlFor="seq-max" hint="Quantos dias úteis para trás o cálculo olha." required>
          <Input id="seq-max" type="number" inputMode="numeric" min={5} max={365} step="1" value={maxDias} onChange={(e) => setMaxDias(e.target.value)} required className="tabular-nums" />
        </FormField>
      </div>
    </SettingsSection>
  );
}
