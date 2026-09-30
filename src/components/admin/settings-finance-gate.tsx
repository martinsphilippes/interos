"use client";

import * as React from "react";
import type { FinanceiroAlertasConfig, GateFinanceiroConfig } from "@/server/admin/schemas";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
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

/** Alertas do circuito de contratos (varredura diária "contratos_alertas"). */
export function SettingsFinanceAlerts({ value, stored }: { value: FinanceiroAlertasConfig; stored: boolean }) {
  const { pending, error, save } = useSaveSetting("financeiro_alertas");
  const [form, setForm] = React.useState({ diasSemAssinatura: String(value.diasSemAssinatura), horasPagoSemLiberacao: String(value.horasPagoSemLiberacao), diasLiberadoSemInicio: String(value.diasLiberadoSemInicio) });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save({ diasSemAssinatura: Number(form.diasSemAssinatura), horasPagoSemLiberacao: Number(form.horasPagoSemLiberacao), diasLiberadoSemInicio: Number(form.diasLiberadoSemInicio) }, "Alertas de contratos salvos");
  };

  return (
    <SettingsSection
      title="Alertas de contratos parados"
      description="A varredura diária cria tarefa de follow-up ao vendedor, alerta o Financeiro e avisa a Implantação quando o contrato fica parado além destes prazos. Cada alerta é criado uma única vez por contrato."
      stored={stored}
      pending={pending}
      error={error}
      onSubmit={submit}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Aguardando assinatura (dias)" htmlFor="fa-assinatura" required hint="Tarefa de follow-up para o vendedor">
          <Input id="fa-assinatura" type="number" inputMode="numeric" min={1} max={90} value={form.diasSemAssinatura} onChange={(e) => setForm((f) => ({ ...f, diasSemAssinatura: e.target.value }))} />
        </FormField>
        <FormField label="Pago sem liberação (horas)" htmlFor="fa-pago" required hint="Tarefa para o gestor financeiro">
          <Input id="fa-pago" type="number" inputMode="numeric" min={1} max={720} value={form.horasPagoSemLiberacao} onChange={(e) => setForm((f) => ({ ...f, horasPagoSemLiberacao: e.target.value }))} />
        </FormField>
        <FormField label="Liberado sem início da implantação (dias)" htmlFor="fa-liberado" required hint="Aviso ao responsável e ao gestor de implantação">
          <Input id="fa-liberado" type="number" inputMode="numeric" min={1} max={90} value={form.diasLiberadoSemInicio} onChange={(e) => setForm((f) => ({ ...f, diasLiberadoSemInicio: e.target.value }))} />
        </FormField>
      </div>
    </SettingsSection>
  );
}
