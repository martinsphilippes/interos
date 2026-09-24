"use client";

import * as React from "react";
import type { GateFinanceiroConfig } from "@/server/admin/schemas";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "./settings-section";
import { useSaveSetting } from "./use-save-setting";

const PAYMENT_OPTIONS: { value: GateFinanceiroConfig["exigePagamento"]; label: string }[] = [
  { value: "setup", label: "Pagamento da adesão (setup)" },
  { value: "primeira_mensalidade", label: "Pagamento da primeira mensalidade" },
  { value: "nenhum", label: "Sem exigência de pagamento" },
];

/** Critérios que o Financeiro exige antes de liberar o cliente para a implantação. */
export function SettingsFinanceGate({ value, stored }: { value: GateFinanceiroConfig; stored: boolean }) {
  const { pending, error, save } = useSaveSetting("gate_financeiro");
  const [form, setForm] = React.useState<GateFinanceiroConfig>(value);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save(form, "Critérios do gate financeiro salvos");
  };

  return (
    <SettingsSection
      title="Gate financeiro"
      description="O botão “Liberar para implantação” só fica disponível quando todos os critérios abaixo estão cumpridos. Gestores podem liberar por exceção, com motivo registrado na jornada."
      stored={stored}
      pending={pending}
      error={error}
      onSubmit={submit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Switch
          label="Exigir contrato assinado"
          description="Todos os signatários precisam ter assinado."
          checked={form.exigeContratoAssinado}
          onCheckedChange={(v) => setForm((f) => ({ ...f, exigeContratoAssinado: v }))}
          className="w-full rounded-lg border border-border px-3 py-2"
        />
        <Switch
          label="Permitir exceção do gestor"
          description="Gestor libera sem todos os critérios, informando o motivo."
          checked={form.permiteExcecaoGestor}
          onCheckedChange={(v) => setForm((f) => ({ ...f, permiteExcecaoGestor: v }))}
          className="w-full rounded-lg border border-border px-3 py-2"
        />
        <FormField label="Pagamento exigido" htmlFor="gf-pagamento" required>
          <Select id="gf-pagamento" value={form.exigePagamento} onChange={(e) => setForm((f) => ({ ...f, exigePagamento: e.target.value as GateFinanceiroConfig["exigePagamento"] }))}>
            {PAYMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
    </SettingsSection>
  );
}
