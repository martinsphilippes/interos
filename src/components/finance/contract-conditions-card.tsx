"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { SALE_PAYMENT_METHODS, type Contract, type ContractReadjustment } from "@/domain/types";
import { MAX_SETUP_INSTALLMENTS, SALE_PAYMENT_METHOD_LABELS } from "@/domain/sale-closing";
import { describeReadjustment, READJUSTMENT_INDEX_LABELS, READJUSTMENT_TYPE_LABELS } from "@/domain/contract-snapshot";
import { updateContractConditionsAction } from "@/server/finance/actions";
import { RECURRENCE_LABELS, type UpdateConditionsInput } from "@/server/finance/schemas";
import { dateKey, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFinanceAction } from "./use-finance-action";

export type ConditionsContract = Pick<Contract, "id" | "billingDay" | "firstDueDate" | "recurrence" | "termMonths" | "paymentCondition" | "startDate" | "endDate" | "version" | "paymentMethod" | "setupInstallments" | "autoRenew" | "renewalTermMonths" | "readjustment" | "noticeDays">;

export interface ConditionsForm {
  billingDay: string;
  firstDueDate: string;
  recurrence: Contract["recurrence"];
  termMonths: string;
  paymentCondition: string;
  paymentMethod: string;
  setupInstallments: string;
  autoRenew: boolean;
  renewalTermMonths: string;
  readjustmentType: ContractReadjustment["type"];
  readjustmentPercent: string;
  readjustmentIndex: NonNullable<ContractReadjustment["index"]> | "";
  noticeDays: string;
}

export function conditionsFormFromContract(c: ConditionsContract): ConditionsForm {
  return {
    billingDay: String(c.billingDay),
    firstDueDate: c.firstDueDate ? dateKey(c.firstDueDate) : "",
    recurrence: c.recurrence,
    termMonths: String(c.termMonths),
    paymentCondition: c.paymentCondition ?? "",
    paymentMethod: c.paymentMethod ?? "",
    setupInstallments: String(c.setupInstallments ?? 1),
    autoRenew: c.autoRenew ?? false,
    renewalTermMonths: String(c.renewalTermMonths ?? c.termMonths),
    readjustmentType: c.readjustment?.type ?? "nenhum",
    readjustmentPercent: c.readjustment?.percent !== undefined ? String(c.readjustment.percent).replace(".", ",") : "",
    readjustmentIndex: c.readjustment?.index ?? "",
    noticeDays: String(c.noticeDays ?? 30),
  };
}

const pct = (v: string) => Number(v.trim().replace(",", "."));

/** Entrada da action a partir do formulário (campos de renovação só quando fazem sentido). */
export function conditionsPayload(form: ConditionsForm, contract: Pick<ConditionsContract, "setupInstallments" | "autoRenew" | "renewalTermMonths" | "readjustment" | "noticeDays">): Omit<UpdateConditionsInput, "contractId"> {
  const touchedRenewal = form.autoRenew || contract.autoRenew !== undefined || contract.renewalTermMonths !== undefined || contract.readjustment !== undefined || contract.noticeDays !== undefined || form.readjustmentType !== "nenhum";
  const readjustment: ContractReadjustment = form.readjustmentType === "percentual" ? { type: "percentual", percent: pct(form.readjustmentPercent) } : form.readjustmentType === "indice" ? { type: "indice", index: form.readjustmentIndex || undefined } : { type: "nenhum" };
  return {
    billingDay: Number(form.billingDay),
    firstDueDate: form.firstDueDate || undefined,
    recurrence: form.recurrence,
    termMonths: Number(form.termMonths),
    paymentCondition: form.paymentCondition,
    paymentMethod: (form.paymentMethod || undefined) as UpdateConditionsInput["paymentMethod"],
    // Contrato antigo sem parcelamento continua sem o campo enquanto ficar "à vista".
    setupInstallments: contract.setupInstallments || form.setupInstallments !== "1" ? Number(form.setupInstallments) : undefined,
    ...(touchedRenewal ? { autoRenew: form.autoRenew, renewalTermMonths: Number(form.renewalTermMonths) || undefined, readjustment, noticeDays: Number(form.noticeDays) || undefined } : {}),
  };
}

export interface ConditionsFieldsProps {
  id: string;
  form: ConditionsForm;
  onChange: (form: ConditionsForm) => void;
  hasPaymentMethod: boolean;
  /** Mostrar o bloco "Renovação" (renovação automática, prazo, reajuste, antecedência). */
  renewal?: boolean;
}

/** Campos das condições do contrato (reutilizados pelo card de condições e pelo diálogo de aditivo). */
export function ConditionsFields({ id, form, onChange, hasPaymentMethod, renewal = true }: ConditionsFieldsProps) {
  const set = (patch: Partial<ConditionsForm>) => onChange({ ...form, ...patch });
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Dia de vencimento" htmlFor={`${id}-d`} required hint="Entre 1 e 28">
          <Input id={`${id}-d`} inputMode="numeric" value={form.billingDay} onChange={(e) => set({ billingDay: e.target.value })} className="h-11 md:h-9" />
        </FormField>
        <FormField label="Primeiro vencimento" htmlFor={`${id}-f`} hint="Vazio = próximo dia de vencimento">
          <DateInput id={`${id}-f`} value={form.firstDueDate} onChange={(e) => set({ firstDueDate: e.target.value })} className="h-11 md:h-9" />
        </FormField>
        <FormField label="Recorrência" htmlFor={`${id}-r`} required>
          <Select id={`${id}-r`} value={form.recurrence} onChange={(e) => set({ recurrence: e.target.value as Contract["recurrence"] })} options={Object.entries(RECURRENCE_LABELS).map(([value, label]) => ({ value, label }))} />
        </FormField>
        <FormField label="Prazo (meses)" htmlFor={`${id}-t`} required>
          <Input id={`${id}-t`} inputMode="numeric" value={form.termMonths} onChange={(e) => set({ termMonths: e.target.value })} className="h-11 md:h-9" />
        </FormField>
        <FormField label="Forma de pagamento" htmlFor={`${id}-pm`}>
          <Select id={`${id}-pm`} value={form.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value })} placeholder={hasPaymentMethod ? undefined : "Não informada (boleto)"} options={SALE_PAYMENT_METHODS.map((m) => ({ value: m, label: SALE_PAYMENT_METHOD_LABELS[m] }))} />
        </FormField>
        <FormField label="Parcelas da adesão" htmlFor={`${id}-pi`}>
          <Select id={`${id}-pi`} value={form.setupInstallments} onChange={(e) => set({ setupInstallments: e.target.value })} options={Array.from({ length: MAX_SETUP_INSTALLMENTS }, (_, i) => ({ value: String(i + 1), label: i === 0 ? "À vista (1x)" : `${i + 1}x` }))} />
        </FormField>
      </div>
      <FormField label="Condição de pagamento" htmlFor={`${id}-c`}>
        <Input id={`${id}-c`} value={form.paymentCondition} onChange={(e) => set({ paymentCondition: e.target.value })} placeholder="Ex.: adesão à vista via PIX; mensalidade por boleto" className="h-11 md:h-9" />
      </FormField>
      {renewal ? (
        <fieldset className="grid gap-4 rounded-lg border border-border p-3 sm:grid-cols-2" data-testid="renewal-fields">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Renovação</legend>
          <Switch label="Renovação automática" description={form.autoRenew ? "Ao fim da vigência o contrato é renovado pela varredura diária (aditivo de renovação)." : "Sem renovação automática: o CS negocia a renovação na janela de 90 dias."} checked={form.autoRenew} onCheckedChange={(v) => set({ autoRenew: v })} className="w-full rounded-lg border border-border px-3 py-2 sm:col-span-2" />
          <FormField label="Prazo da renovação (meses)" htmlFor={`${id}-rt`} hint="Padrão: o prazo do contrato">
            <Input id={`${id}-rt`} inputMode="numeric" value={form.renewalTermMonths} onChange={(e) => set({ renewalTermMonths: e.target.value })} className="h-11 md:h-9" />
          </FormField>
          <FormField label="Antecedência (dias)" htmlFor={`${id}-nd`} hint="Dias antes do fim da vigência para renovar">
            <Input id={`${id}-nd`} inputMode="numeric" value={form.noticeDays} onChange={(e) => set({ noticeDays: e.target.value })} className="h-11 md:h-9" />
          </FormField>
          <FormField label="Reajuste" htmlFor={`${id}-rj`} hint="Índice: o valor NÃO é buscado automaticamente — o CS informa a cada renovação">
            <Select id={`${id}-rj`} value={form.readjustmentType} onChange={(e) => set({ readjustmentType: e.target.value as ContractReadjustment["type"] })} options={(Object.keys(READJUSTMENT_TYPE_LABELS) as ContractReadjustment["type"][]).map((t) => ({ value: t, label: READJUSTMENT_TYPE_LABELS[t] }))} />
          </FormField>
          {form.readjustmentType === "percentual" ? (
            <FormField label="Percentual (%)" htmlFor={`${id}-rp`} required>
              <Input id={`${id}-rp`} inputMode="decimal" value={form.readjustmentPercent} onChange={(e) => set({ readjustmentPercent: e.target.value })} placeholder="Ex.: 5" className="h-11 md:h-9" />
            </FormField>
          ) : form.readjustmentType === "indice" ? (
            <FormField label="Índice" htmlFor={`${id}-ri`} required>
              <Select id={`${id}-ri`} value={form.readjustmentIndex} onChange={(e) => set({ readjustmentIndex: e.target.value as ConditionsForm["readjustmentIndex"] })} placeholder="Escolha" options={(Object.keys(READJUSTMENT_INDEX_LABELS) as NonNullable<ContractReadjustment["index"]>[]).map((i) => ({ value: i, label: READJUSTMENT_INDEX_LABELS[i] }))} />
            </FormField>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
}

export interface ContractConditionsCardProps {
  contract: ConditionsContract;
  canEdit: boolean;
  sent: boolean;
  /** Contrato assinado/liberado: alterações entram por aditivo. */
  amendable?: boolean;
}

/** Condições: dia de vencimento, primeira data, recorrência, prazo, condição de pagamento e renovação. */
export function ContractConditionsCard({ contract, canEdit, sent, amendable }: ContractConditionsCardProps) {
  const id = React.useId();
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState<ConditionsForm>(() => conditionsFormFromContract(contract));
  const { pending, run } = useFinanceAction();

  const save = async () => {
    const ok = await run(
      () => updateContractConditionsAction({ contractId: contract.id, ...conditionsPayload(form, contract) }),
      (d) => (d.versioned ? `Condições salvas: contrato v${contract.version + 1} criado (reenvie para assinatura)` : "Condições salvas"),
    );
    if (ok) setEditing(false);
  };

  const renewalText = contract.autoRenew ? `Automática · ${contract.renewalTermMonths ?? contract.termMonths} meses · ${describeReadjustment(contract.readjustment)}${contract.readjustment?.pending ? "" : ""} · ${contract.noticeDays ?? 30} dias antes` : contract.autoRenew === false ? `Pelo CS (sem renovação automática)${contract.readjustment ? ` · ${describeReadjustment(contract.readjustment)}` : ""}` : "Não definida (renovação negociada pelo CS)";
  const rows: [string, string][] = [
    ["Dia de vencimento", `Dia ${contract.billingDay}`],
    ["Primeiro vencimento", contract.firstDueDate ? formatDate(contract.firstDueDate) : "Definido ao gerar as cobranças"],
    ["Recorrência", RECURRENCE_LABELS[contract.recurrence]],
    ["Prazo", `${contract.termMonths} meses`],
    ["Forma de pagamento", contract.paymentMethod ? SALE_PAYMENT_METHOD_LABELS[contract.paymentMethod] : "Não informada (boleto)"],
    ["Parcelas da adesão", (contract.setupInstallments ?? 1) > 1 ? `${contract.setupInstallments}x` : "À vista"],
    ["Condição de pagamento", contract.paymentCondition || "—"],
    ["Vigência", contract.startDate ? `${formatDate(contract.startDate)} a ${formatDate(contract.endDate)}` : "Começa na liberação"],
    ["Renovação", renewalText],
  ];

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Condições</CardTitle>
          <CardDescription>Base para gerar as cobranças.{amendable && !canEdit ? " Contrato assinado: alterações entram por aditivo (seção Aditivos)." : ""}</CardDescription>
        </div>
        {canEdit && !editing ? (
          <Button
            variant="outline"
            size="sm"
            className="h-10 md:h-8"
            onClick={() => {
              setForm(conditionsFormFromContract(contract));
              setEditing(true);
            }}
          >
            <Pencil /> Editar
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="pt-0">
        {editing ? (
          <div className="flex flex-col gap-4">
            {sent ? <p className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning-fg">Alterar as condições após o envio cria a versão {contract.version + 1} e exige nova assinatura.</p> : null}
            <ConditionsFields id={id} form={form} onChange={setForm} hasPaymentMethod={Boolean(contract.paymentMethod)} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(false)} disabled={pending} className="h-11 md:h-9">
                Cancelar
              </Button>
              <Button onClick={save} loading={pending} className="h-11 md:h-9">
                Salvar condições
              </Button>
            </div>
          </div>
        ) : (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-sm">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
