"use client";

import * as React from "react";
import type { OportunidadeConfig } from "@/server/admin/schemas";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { numberToInput, parseNumber } from "./admin-model";
import { SettingsSection } from "./settings-section";
import { useSaveSetting } from "./use-save-setting";

export function SettingsOpportunity({ value, stored }: { value: OportunidadeConfig; stored: boolean }) {
  const { pending, error, setError, save } = useSaveSetting("oportunidade");
  const [dias, setDias] = React.useState(numberToInput(value.diasSemMovimentoParaParada));
  const [horas, setHoras] = React.useState(numberToInput(value.horasSemInteracaoFollowup));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const d = parseNumber(dias);
    const h = parseNumber(horas);
    if (Number.isNaN(d) || Number.isNaN(h)) {
      setError("Informe números válidos");
      return;
    }
    save({ diasSemMovimentoParaParada: d, horasSemInteracaoFollowup: h } satisfies OportunidadeConfig, "Parâmetros de oportunidades salvos");
  };

  return (
    <SettingsSection title="Oportunidades" description="Regras de acompanhamento do funil de vendas: quando uma oportunidade é considerada parada e quando o vendedor recebe tarefa de follow-up." stored={stored} pending={pending} error={error} onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Dias sem movimento para considerar parada" htmlFor="op-dias" required hint="Sem mudança de etapa nem atividade registrada.">
          <Input id="op-dias" type="number" inputMode="numeric" min={1} max={365} step={1} value={dias} onChange={(e) => setDias(e.target.value)} required className="tabular-nums" />
        </FormField>
        <FormField label="Horas sem interação para gerar follow-up" htmlFor="op-horas" required hint="Cria tarefa de follow-up para o vendedor.">
          <Input id="op-horas" type="number" inputMode="numeric" min={1} max={8760} step={1} value={horas} onChange={(e) => setHoras(e.target.value)} required className="tabular-nums" />
        </FormField>
      </div>
    </SettingsSection>
  );
}
