"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Building2 } from "lucide-react";
import type { Address } from "@/domain/types";
import { completeBillingDataAction } from "@/server/finance/actions";
import { formatDocument } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useFinanceAction } from "./use-finance-action";

export interface BillingDataCardProps {
  contractId: string;
  clientId: string;
  clientName: string;
  data: { legalName?: string; document?: string; email?: string; address: Address; paymentCondition?: string };
  canEdit: boolean;
  fromOpportunity: boolean;
}

type FieldKey = "legalName" | "document" | "email" | "street" | "number" | "district" | "city" | "state" | "zip";
const FIELDS: { key: FieldKey; label: string; placeholder?: string; wide?: boolean }[] = [
  { key: "legalName", label: "Razão social", wide: true },
  { key: "document", label: "CPF/CNPJ", placeholder: "Somente números" },
  { key: "email", label: "E-mail de faturamento", placeholder: "financeiro@cliente.com.br" },
  { key: "street", label: "Logradouro", wide: true },
  { key: "number", label: "Número" },
  { key: "district", label: "Bairro" },
  { key: "city", label: "Cidade" },
  { key: "state", label: "UF", placeholder: "CE" },
  { key: "zip", label: "CEP" },
];

function valueOf(data: BillingDataCardProps["data"], key: FieldKey): string | undefined {
  if (key === "legalName" || key === "document" || key === "email") return data[key];
  return data.address[key];
}

/**
 * Dados do cliente e faturamento herdados da venda (oportunidade) e do cadastro. Não pede de novo o que
 * já existe: o formulário mostra apenas os campos que faltam.
 */
export function BillingDataCard({ contractId, clientId, clientName, data, canEdit, fromOpportunity }: BillingDataCardProps) {
  const id = React.useId();
  const missing = FIELDS.filter((f) => !valueOf(data, f.key));
  const [form, setForm] = React.useState<Partial<Record<FieldKey, string>>>({});
  const { pending, run } = useFinanceAction();
  const filledCount = Object.values(form).filter((v) => v && v.trim()).length;

  const save = async () => {
    const ok = await run(() => completeBillingDataAction({ contractId, ...form }), (d) => `Dados completados: ${d.filled.join(", ")}`);
    if (ok) setForm({});
  };

  const addressLine = [data.address.street && `${data.address.street}${data.address.number ? `, ${data.address.number}` : ""}`, data.address.district, data.address.city && `${data.address.city}${data.address.state ? `/${data.address.state}` : ""}`, data.address.zip].filter(Boolean).join(" · ");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="size-4 text-muted" /> Cliente e faturamento
        </CardTitle>
        <CardDescription>{fromOpportunity ? "Herdado da venda e do cadastro do cliente." : "Herdado do cadastro do cliente."}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted">Cliente</dt>
            <dd>
              <Link href={`/clientes/${clientId}?aba=financeiro`} className="font-medium text-brand hover:underline">
                {clientName}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Razão social</dt>
            <dd>{data.legalName || <span className="text-danger-fg">Não informado</span>}</dd>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-muted">CPF/CNPJ</dt>
              <dd className="tabular-nums">{data.document ? formatDocument(data.document) : <span className="text-danger-fg">Não informado</span>}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted">E-mail de faturamento</dt>
              <dd className="truncate">{data.email || <span className="text-danger-fg">Não informado</span>}</dd>
            </div>
          </div>
          <div>
            <dt className="text-xs text-muted">Endereço</dt>
            <dd>{addressLine || <span className="text-danger-fg">Não informado</span>}</dd>
          </div>
          {data.paymentCondition ? (
            <div>
              <dt className="text-xs text-muted">Condição combinada na venda</dt>
              <dd>{data.paymentCondition}</dd>
            </div>
          ) : null}
        </dl>

        {missing.length > 0 ? (
          <div className="rounded-lg border border-warning/40 bg-warning-soft/40 p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium text-warning-fg">
              <AlertTriangle className="size-4" /> Falta: {missing.map((f) => f.label.toLowerCase()).join(", ")}
            </p>
            {canEdit ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {missing.map((f) => (
                  <FormField key={f.key} label={f.label} htmlFor={`${id}-${f.key}`} className={f.wide ? "sm:col-span-2" : undefined}>
                    <Input id={`${id}-${f.key}`} value={form[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className="h-11 md:h-9" />
                  </FormField>
                ))}
                <div className="flex justify-end sm:col-span-2">
                  <Button onClick={save} loading={pending} disabled={filledCount === 0} className="h-11 md:h-9">
                    Completar dados
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
