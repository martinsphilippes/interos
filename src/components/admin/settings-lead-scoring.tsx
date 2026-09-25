"use client";

import * as React from "react";
import type { LeadScoring } from "@/server/admin/schemas";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { numberToInput, parseNumber } from "./admin-model";
import { KeyValueEditor, recordToRows, rowsToRecord, type KeyValueRow } from "./key-value-editor";
import { SettingsSection } from "./settings-section";
import { useSaveSetting } from "./use-save-setting";

export interface SettingsLeadScoringProps {
  value: LeadScoring;
  stored: boolean;
  /** Chaves reais de origens de lead e categorias de produto (sugestões para as tabelas). */
  originKeys: string[];
  interestKeys: string[];
}

export function SettingsLeadScoring({ value, stored, originKeys, interestKeys }: SettingsLeadScoringProps) {
  const { pending, error, setError, save } = useSaveSetting("lead_scoring");
  const [origem, setOrigem] = React.useState<KeyValueRow[]>(() => recordToRows(value.origem));
  const [interesse, setInteresse] = React.useState<KeyValueRow[]>(() => recordToRows(value.interesse));
  const [cidade, setCidade] = React.useState<KeyValueRow[]>(() => recordToRows(value.cidade));
  const [quente, setQuente] = React.useState(numberToInput(value.limiares.quente));
  const [morno, setMorno] = React.useState(numberToInput(value.limiares.morno));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const tables = [
      ["origem", rowsToRecord(origem, "ponto de origem")],
      ["interesse", rowsToRecord(interesse, "ponto de interesse")],
      ["cidade", rowsToRecord(cidade, "ponto de cidade")],
    ] as const;
    for (const [, result] of tables) {
      if (!result.ok) {
        setError(result.error);
        return;
      }
    }
    const q = parseNumber(quente);
    const m = parseNumber(morno);
    if (Number.isNaN(q) || Number.isNaN(m)) {
      setError("Informe os limiares de lead quente e morno");
      return;
    }
    if (m >= q) {
      setError("O limiar de lead morno deve ser menor que o de lead quente");
      return;
    }
    const [o, i, c] = tables.map(([, r]) => (r.ok ? r.value : {}));
    save({ origem: o, interesse: i, cidade: c, limiares: { quente: q, morno: m } } satisfies LeadScoring, "Lead scoring salvo");
  };

  return (
    <SettingsSection title="Lead scoring" description="Pontos somados a cada lead conforme origem, interesse e cidade. A soma define a temperatura: quente, morno ou frio." stored={stored} pending={pending} error={error} onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Lead quente a partir de (pontos)" htmlFor="ls-quente" required>
          <Input id="ls-quente" type="number" inputMode="numeric" min={0} max={1000} step={1} value={quente} onChange={(e) => setQuente(e.target.value)} required className="tabular-nums" />
        </FormField>
        <FormField label="Lead morno a partir de (pontos)" htmlFor="ls-morno" required hint="Abaixo disso o lead é frio.">
          <Input id="ls-morno" type="number" inputMode="numeric" min={0} max={1000} step={1} value={morno} onChange={(e) => setMorno(e.target.value)} required className="tabular-nums" />
        </FormField>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <FormField label="Pontos por origem" hint="Chave da origem de lead (lead_sources).">
          <KeyValueEditor rows={origem} onChange={setOrigem} keyLabel="Origem" valueLabel="Pontos" keyPlaceholder="ex.: indicacao" suggestions={originKeys} step="1" addLabel="Adicionar origem" emptyText="Nenhuma origem pontuada." />
        </FormField>
        <FormField label="Pontos por interesse" hint="Categoria de produto de interesse.">
          <KeyValueEditor rows={interesse} onChange={setInteresse} keyLabel="Interesse" valueLabel="Pontos" keyPlaceholder="ex.: erp" suggestions={interestKeys} step="1" addLabel="Adicionar interesse" emptyText="Nenhum interesse pontuado." />
        </FormField>
        <FormField label="Pontos por cidade" hint="Nome da cidade como aparece no cadastro.">
          <KeyValueEditor rows={cidade} onChange={setCidade} keyLabel="Cidade" valueLabel="Pontos" keyPlaceholder="ex.: Juazeiro do Norte" step="1" addLabel="Adicionar cidade" emptyText="Nenhuma cidade pontuada." />
        </FormField>
      </div>
    </SettingsSection>
  );
}
