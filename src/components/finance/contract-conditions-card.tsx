"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { SALE_PAYMENT_METHODS, type Contract } from "@/domain/types";
import { MAX_SETUP_INSTALLMENTS, SALE_PAYMENT_METHOD_LABELS } from "@/domain/sale-closing";
import { updateContractConditionsAction } from "@/server/finance/actions";
import { RECURRENCE_LABELS } from "@/server/finance/schemas";
import { dateKey, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useFinanceAction } from "./use-finance-action";

export interface ContractConditionsCardProps {
  contract: Pick<Contract, "id" | "billingDay" | "firstDueDate" | "recurrence" | "termMonths" | "paymentCondition" | "startDate" | "endDate" | "version" | "paymentMethod" | "setupInstallments">;
  canEdit: boolean;
  sent: boolean;
}

/** Condições: dia de vencimento, primeira data, recorrência, prazo e condição de pagamento. */
export function ContractConditionsCard({ contract, canEdit, sent }: ContractConditionsCardProps) {
  const id = React.useId();
  const [editing, setEditing] = React.useState(false);
  const initial = React.useCallback(
    () => ({
      billingDay: String(contract.billingDay),
      firstDueDate: contract.firstDueDate ? dateKey(contract.firstDueDate) : "",
      recurrence: contract.recurrence,
      termMonths: String(contract.termMonths),
      paymentCondition: contract.paymentCondition ?? "",
      paymentMethod: contract.paymentMethod ?? "",
      setupInstallments: String(contract.setupInstallments ?? 1),
    }),
    [contract],
  );
  const [form, setForm] = React.useState(initial);
  const { pending, run } = useFinanceAction();

  const save = async () => {
    const ok = await run(
      () =>
        updateContractConditionsAction({
          contractId: contract.id,
          billingDay: Number(form.billingDay),
          firstDueDate: form.firstDueDate || undefined,
          recurrence: form.recurrence,
          termMonths: Number(form.termMonths),
          paymentCondition: form.paymentCondition,
          paymentMethod: (form.paymentMethod || undefined) as Contract["paymentMethod"],
          // Contrato antigo sem parcelamento continua sem o campo enquanto ficar "à vista".
          setupInstallments: contract.setupInstallments || form.setupInstallments !== "1" ? Number(form.setupInstallments) : undefined,
        }),
      (d) => (d.versioned ? `Condições salvas: contrato v${contract.version + 1} criado (reenvie para assinatura)` : "Condições salvas"),
    );
    if (ok) setEditing(false);
  };

  const rows: [string, string][] = [
    ["Dia de vencimento", `Dia ${contract.billingDay}`],
    ["Primeiro vencimento", contract.firstDueDate ? formatDate(contract.firstDueDate) : "Definido ao gerar as cobranças"],
    ["Recorrência", RECURRENCE_LABELS[contract.recurrence]],
    ["Prazo", `${contract.termMonths} meses`],
    ["Forma de pagamento", contract.paymentMethod ? SALE_PAYMENT_METHOD_LABELS[contract.paymentMethod] : "Não informada (boleto)"],
    ["Parcelas da adesão", (contract.setupInstallments ?? 1) > 1 ? `${contract.setupInstallments}x` : "À vista"],
    ["Condição de pagamento", contract.paymentCondition || "—"],
    ["Vigência", contract.startDate ? `${formatDate(contract.startDate)} a ${formatDate(contract.endDate)}` : "Começa na liberação"],
  ];

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Condições</CardTitle>
          <CardDescription>Base para gerar as cobranças.</CardDescription>
        </div>
        {canEdit && !editing ? (
          <Button
            variant="outline"
            size="sm"
            className="h-10 md:h-8"
            onClick={() => {
              setForm(initial());
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
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Dia de vencimento" htmlFor={`${id}-d`} required hint="Entre 1 e 28">
                <Input id={`${id}-d`} inputMode="numeric" value={form.billingDay} onChange={(e) => setForm({ ...form, billingDay: e.target.value })} className="h-11 md:h-9" />
              </FormField>
              <FormField label="Primeiro vencimento" htmlFor={`${id}-f`} hint="Vazio = próximo dia de vencimento">
                <DateInput id={`${id}-f`} value={form.firstDueDate} onChange={(e) => setForm({ ...form, firstDueDate: e.target.value })} className="h-11 md:h-9" />
              </FormField>
              <FormField label="Recorrência" htmlFor={`${id}-r`} required>
                <Select id={`${id}-r`} value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value as Contract["recurrence"] })} options={Object.entries(RECURRENCE_LABELS).map(([value, label]) => ({ value, label }))} />
              </FormField>
              <FormField label="Prazo (meses)" htmlFor={`${id}-t`} required>
                <Input id={`${id}-t`} inputMode="numeric" value={form.termMonths} onChange={(e) => setForm({ ...form, termMonths: e.target.value })} className="h-11 md:h-9" />
              </FormField>
              <FormField label="Forma de pagamento" htmlFor={`${id}-pm`}>
                <Select
                  id={`${id}-pm`}
                  value={form.paymentMethod}
                  onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
                  placeholder={contract.paymentMethod ? undefined : "Não informada (boleto)"}
                  options={SALE_PAYMENT_METHODS.map((m) => ({ value: m, label: SALE_PAYMENT_METHOD_LABELS[m] }))}
                />
              </FormField>
              <FormField label="Parcelas da adesão" htmlFor={`${id}-pi`}>
                <Select id={`${id}-pi`} value={form.setupInstallments} onChange={(e) => setForm({ ...form, setupInstallments: e.target.value })} options={Array.from({ length: MAX_SETUP_INSTALLMENTS }, (_, i) => ({ value: String(i + 1), label: i === 0 ? "À vista (1x)" : `${i + 1}x` }))} />
              </FormField>
            </div>
            <FormField label="Condição de pagamento" htmlFor={`${id}-c`}>
              <Input id={`${id}-c`} value={form.paymentCondition} onChange={(e) => setForm({ ...form, paymentCondition: e.target.value })} placeholder="Ex.: adesão à vista via PIX; mensalidade por boleto" className="h-11 md:h-9" />
            </FormField>
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
