"use client";

import * as React from "react";
import { Receipt, Star } from "lucide-react";
import type { Billing } from "@/domain/types";
import { generateBillingsAction } from "@/server/finance/actions";
import { paymentMethodLabel } from "@/server/finance/schemas";
import { formatCompetence, formatCurrency, formatDate } from "@/lib/format";
import { BILLING_STATUS_LABELS, BILLING_STATUS_VARIANT } from "@/components/clients/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { BillingActions, billingLabel } from "./billing-actions";
import { useFinanceAction } from "./use-finance-action";

export interface ContractBillingCardProps {
  contractId: string;
  clientName: string;
  billings: Billing[];
  /** Cobrança que o gate exige paga (destacada). */
  requiredBillingId?: string;
  canOperate: boolean;
  /** Todos assinaram e ainda não há cobranças: mostra "Gerar cobranças". */
  canGenerate: boolean;
  waitingSignature: boolean;
}

/** Cobranças do contrato: geração (adesão, hardware e mensalidades do prazo) e registro de pagamento. */
export function ContractBillingCard({ contractId, clientName, billings, requiredBillingId, canOperate, canGenerate, waitingSignature }: ContractBillingCardProps) {
  const { pending, run } = useFinanceAction();
  const active = billings.filter((b) => b.status !== "cancelada");
  const paid = active.filter((b) => b.status === "paga").reduce((s, b) => s + (b.paidAmount ?? b.amount), 0);
  const total = active.reduce((s, b) => s + b.amount, 0);

  const generate = () => run(() => generateBillingsAction({ contractId }), (d) => `${d.count} cobrança(s) gerada(s)`);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Cobrança</CardTitle>
          <CardDescription>{active.length > 0 ? `${active.length} cobrança(s) · ${formatCurrency(paid)} recebido de ${formatCurrency(total)}` : "Cobranças são geradas após a assinatura."}</CardDescription>
        </div>
        {canOperate && canGenerate ? (
          <Button onClick={generate} loading={pending} className="h-10 md:h-9">
            <Receipt /> Gerar cobranças
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="px-0 pt-0">
        {billings.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Receipt />}
            title="Nenhuma cobrança"
            description={waitingSignature ? "Aguardando a assinatura de todos os signatários." : canGenerate ? "Gere a adesão, o hardware e as mensalidades do prazo do contrato." : "Sem cobranças para este contrato."}
          />
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border md:hidden">
              {billings.map((b) => (
                <li key={b.id} className={cn("flex items-start gap-3 px-4 py-3", b.status === "vencida" && "bg-danger-soft/40")}>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      {b.id === requiredBillingId ? <Star className="size-3.5 text-brand" aria-label="Exigida para liberar" /> : null}
                      {billingLabel(b)} · {formatCurrency(b.amount)}
                    </p>
                    <p className="text-xs text-muted">
                      Vence {formatDate(b.dueDate)}
                      {b.paidAt ? ` · pago ${formatDate(b.paidAt)} (${paymentMethodLabel(b.method)})` : ""}
                    </p>
                    <Badge variant={BILLING_STATUS_VARIANT[b.status]} size="sm" className="mt-1.5">
                      {BILLING_STATUS_LABELS[b.status]}
                    </Badge>
                  </div>
                  {canOperate ? <BillingActions billing={{ ...b, clientName }} compact /> : null}
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Cobrança</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Pagamento</TableHead>
                    {canOperate ? <TableHead className="text-right">Ações</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {billings.map((b) => (
                    <TableRow key={b.id} className={cn(b.status === "vencida" && "bg-danger-soft/40 hover:bg-danger-soft/60")}>
                      <TableCell className="whitespace-nowrap font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {b.id === requiredBillingId ? <Star className="size-3.5 text-brand" aria-label="Exigida para liberar" /> : null}
                          {billingLabel(b)}
                        </span>
                        <span className="block text-xs font-normal capitalize text-muted">{formatCompetence(b.competence)}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(b.amount)}</TableCell>
                      <TableCell className={cn("whitespace-nowrap", b.status === "vencida" ? "text-danger-fg" : "text-muted")}>{formatDate(b.dueDate)}</TableCell>
                      <TableCell>
                        <Badge variant={BILLING_STATUS_VARIANT[b.status]} size="sm">
                          {BILLING_STATUS_LABELS[b.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted">
                        {b.paidAt ? `${formatDate(b.paidAt)} · ${paymentMethodLabel(b.method)}${b.paidAmount !== undefined && b.paidAmount !== b.amount ? ` · ${formatCurrency(b.paidAmount)}` : ""}` : "—"}
                      </TableCell>
                      {canOperate ? (
                        <TableCell className="text-right">
                          <BillingActions billing={{ ...b, clientName }} />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {requiredBillingId ? (
              <p className="mt-3 flex items-center gap-1.5 px-5 text-xs text-muted">
                <Star className="size-3.5 text-brand" aria-hidden /> Cobrança cujo pagamento o gate financeiro exige para liberar.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
