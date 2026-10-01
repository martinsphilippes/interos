"use client";

/**
 * Peças de interface das baixas parciais (etapa CP/CR 3), comuns ao título a pagar e ao título a receber avulso:
 * badge do status CALCULADO (Pago/Vencido/Parcial/Em aberto), resumo já pago × em aberto, histórico de baixas com
 * "Desfazer" em cada uma e o diálogo "Quitar pelo já pago". Regras em src/domain/settlements.ts.
 */
import * as React from "react";
import { Receipt, Undo2, Wallet } from "lucide-react";
import { SETTLEMENT_STATUS_LABELS, type SettlementStatus } from "@/domain/settlements";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";

const VARIANT: Record<SettlementStatus, "success" | "danger" | "warning" | "info" | "muted"> = { pago: "success", vencido: "danger", parcial: "warning", em_aberto: "info", cancelado: "muted" };

/** Status calculado das baixas (só exibição; o status gravado continua). */
export function SettlementBadge({ status, size = "sm", className }: { status: SettlementStatus; size?: "sm" | "md"; className?: string }) {
  return (
    <Badge variant={VARIANT[status]} size={size} className={className} data-testid="settlement-badge" data-settlement={status} title="Situação calculada pelas baixas e pelo vencimento">
      {SETTLEMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

/** "Já pago R$ X · Em aberto R$ Y" (e o valor original quando a quitação ajustou o valor). */
export function SettlementSummary({ paid, open, status, amount, originalAmount, verb, className }: { paid: number; open: number; status: SettlementStatus; amount: number; originalAmount?: number; verb: "pago" | "recebido"; className?: string }) {
  if (status === "cancelado") return null;
  return (
    <p className={cn("flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted", className)} data-testid="settlement-summary">
      <span>
        Já {verb}: <span className="font-medium tabular-nums text-foreground">{formatCurrency(paid)}</span>
      </span>
      <span>
        Em aberto: <span className={cn("font-medium tabular-nums", open > 0 ? "text-foreground" : "text-success-fg")} data-testid="settlement-open">{formatCurrency(open)}</span>
      </span>
      {originalAmount !== undefined && Math.round(originalAmount * 100) !== Math.round(amount * 100) ? <span>Valor original: <span className="tabular-nums">{formatCurrency(originalAmount)}</span></span> : null}
    </p>
  );
}

export interface PaymentRowView {
  id: string;
  date: string;
  amount: number;
  accountName: string;
  method: string;
  byName?: string;
}

/** Histórico de baixas com "Desfazer" em cada uma (quem pode; bloqueio explicado no lugar do botão). */
export function PaymentsHistory({ title, payments, canUndo, undoBlocked, onUndo }: { title: string; payments: PaymentRowView[]; canUndo: boolean; undoBlocked?: string; onUndo: (paymentId: string) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="size-4 text-muted" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0" data-testid="payments-history">
        <ul className="flex flex-col divide-y divide-border">
          {payments.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-payment={x.id}>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium tabular-nums">{formatCurrency(x.amount)}</span>
                <span className="block truncate text-xs text-muted">
                  {formatDate(`${x.date}T12:00:00.000Z`)} · {x.accountName} · {x.method}
                  {x.byName ? ` · ${x.byName}` : ""}
                </span>
              </span>
              {canUndo ? (
                <Button variant="ghost" size="sm" className="h-10 text-danger-fg md:h-8" onClick={() => onUndo(x.id)} aria-label={`Desfazer a baixa de ${formatCurrency(x.amount)} de ${formatDate(`${x.date}T12:00:00.000Z`)}`}>
                  <Undo2 /> Desfazer
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {!canUndo && undoBlocked ? (
          <p className="mt-2 text-xs text-muted" data-testid="payments-undo-blocked">
            {undoBlocked}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Confirmação de "Quitar pelo já pago" (motivo opcional): valor := já pago, sem nova baixa nem lançamento. */
export function SettleByPaidDialog({ code, amount, paid, verb, pending, onClose, onConfirm }: { code: string; amount: number; paid: number; verb: "pago" | "recebido"; pending: boolean; onClose: () => void; onConfirm: (reason?: string) => Promise<boolean> }) {
  const id = React.useId();
  const [reason, setReason] = React.useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Quitar {code} pelo já {verb}?</DialogTitle>
          <DialogDescription>
            O valor do título passa de {formatCurrency(amount)} para {formatCurrency(paid)} (o já {verb}) e ele fica quitado. Nenhuma baixa nova nem lançamento de caixa é gravado; a diferença de {formatCurrency(Math.max(0, Math.round((amount - paid) * 100) / 100))} fica registrada no histórico.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormField label="Motivo (opcional)" htmlFor={`${id}-r`} hint="Fica no histórico e na auditoria">
            <Textarea id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: fornecedor concedeu desconto do saldo" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Voltar
          </Button>
          <Button onClick={() => onConfirm(reason.trim() || undefined)} loading={pending}>
            <Receipt /> Quitar pelo já {verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
