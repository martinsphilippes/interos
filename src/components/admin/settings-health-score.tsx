"use client";

import * as React from "react";
import type { HealthScoreConfig } from "@/server/admin/schemas";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { numberToInput, parseNumber } from "./admin-model";
import { KeyValueEditor, recordToRows, rowsToRecord, type KeyValueRow } from "./key-value-editor";
import { SettingsSection } from "./settings-section";
import { useSaveSetting } from "./use-save-setting";

export function SettingsHealthScore({ value, stored }: { value: HealthScoreConfig; stored: boolean }) {
  const { pending, error, setError, save } = useSaveSetting("health_score");
  const [pesos, setPesos] = React.useState<KeyValueRow[]>(() => recordToRows(value.pesos));
  const [saudavel, setSaudavel] = React.useState(numberToInput(value.limiares.saudavel));
  const [atencao, setAtencao] = React.useState(numberToInput(value.limiares.atencao));

  const total = pesos.reduce((s, r) => s + (Number.isNaN(parseNumber(r.value)) ? 0 : parseNumber(r.value)), 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = rowsToRecord(pesos, "peso");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (Object.keys(result.value).length === 0) {
      setError("Informe pelo menos um fator com peso");
      return;
    }
    const s = parseNumber(saudavel);
    const a = parseNumber(atencao);
    if (Number.isNaN(s) || Number.isNaN(a)) {
      setError("Informe os limiares de saudável e atenção");
      return;
    }
    if (a >= s) {
      setError("O limiar de atenção deve ser menor que o de saudável");
      return;
    }
    save({ pesos: result.value, limiares: { saudavel: s, atencao: a } } satisfies HealthScoreConfig, "Health score salvo");
  };

  return (
    <SettingsSection title="Health score" description="Pesos de cada fator no cálculo da saúde do cliente (0–100) e limiares que definem saudável, atenção e risco." stored={stored} pending={pending} error={error} onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Saudável a partir de" htmlFor="hs-saudavel" required>
          <Input id="hs-saudavel" type="number" inputMode="decimal" min={0} max={100} step={1} value={saudavel} onChange={(e) => setSaudavel(e.target.value)} required className="tabular-nums" />
        </FormField>
        <FormField label="Atenção a partir de" htmlFor="hs-atencao" required hint="Abaixo disso o cliente está em risco.">
          <Input id="hs-atencao" type="number" inputMode="decimal" min={0} max={100} step={1} value={atencao} onChange={(e) => setAtencao(e.target.value)} required className="tabular-nums" />
        </FormField>
      </div>
      <FormField label="Pesos por fator" hint={`Soma atual: ${numberToInput(total)}${Math.abs(total - 100) > 0.001 ? " (recomendado: 100)" : ""}`}>
        <KeyValueEditor rows={pesos} onChange={setPesos} keyLabel="Fator" valueLabel="Peso" keyPlaceholder="ex.: uso" step="1" addLabel="Adicionar fator" emptyText="Nenhum fator definido." />
      </FormField>
    </SettingsSection>
  );
}
