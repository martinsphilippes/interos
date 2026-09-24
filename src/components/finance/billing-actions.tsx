"use client";

import * as React from "react";
import { Ban, CircleDollarSign, MessageCircle, MoreHorizontal, Phone } from "lucide-react";
import type { Billing } from "@/domain/types";
import { cancelBillingAction, registerBillingCallAction, registerPaymentAction, sendBillingWhatsappAction } from "@/server/finance/actions";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/server/finance/schemas";
import { dateKey, formatCurrency, formatDate } from "@/lib/format";
import { BILLING_TYPE_LABELS } from "@/components/clients/labels";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFinanceAction } from "./use-finance-action";

export type BillingLite = Pick<Billing, "id" | "type" | "installment" | "amount" | "dueDate" | "status"> & { clientName?: string };

export function billingLabel(b: Pick<Billing, "type" | "installment">): string {
  return `${BILLING_TYPE_LABELS[b.type]}${b.installment ? ` ${b.installment}` : ""}`;
}

/** Registrar pagamento: data, valor, forma e comprovante (link). */
export function PaymentDialog({ billing, open, onOpenChange }: { billing: BillingLite; open: boolean; onOpenChange: (open: boolean) => void }) {
  const id = React.useId();
  const [form, setForm] = React.useState(() => ({ paidAt: dateKey(new Date()), amount: String(billing.amount).replace(".", ","), method: "pix", receiptUrl: "" }));
  const { pending, run } = useFinanceAction();
  const amount = Number(form.amount.includes(",") ? form.amount.replace(/\./g, "").replace(",", ".") : form.amount);

  const submit = async () => {
    const ok = await run(
      () => registerPaymentAction({ billingId: billing.id, paidAt: form.paidAt, amount, method: form.method, receiptUrl: form.receiptUrl.trim() }),
      `Pagamento de ${formatCurrency(amount)} registrado`,
    );
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Registrar pagamento</DialogTitle>
          <DialogDescription>
            {billingLabel(billing)} de {formatCurrency(billing.amount)} · vencimento {formatDate(billing.dueDate)}
            {billing.clientName ? ` · ${billing.clientName}` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4 sm:grid-cols-2">
          <FormField label="Data do pagamento" htmlFor={`${id}-d`} required>
            <DateInput id={`${id}-d`} value={form.paidAt} onChange={(e) => setForm({ ...form, paidAt: e.target.value })} className="h-11 md:h-9" />
          </FormField>
          <FormField label="Valor pago (R$)" htmlFor={`${id}-v`} required error={Number.isFinite(amount) && amount > 0 ? undefined : "Informe um valor válido"}>
            <Input id={`${id}-v`} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="h-11 md:h-9" />
          </FormField>
          <FormField label="Forma de pagamento" htmlFor={`${id}-m`} required>
            <Select id={`${id}-m`} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
          </FormField>
          <FormField label="Comprovante (link)" htmlFor={`${id}-u`} hint="Opcional: URL do comprovante">
            <Input id={`${id}-u`} type="url" placeholder="https://" value={form.receiptUrl} onChange={(e) => setForm({ ...form, receiptUrl: e.target.value })} className="h-11 md:h-9" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending} className="h-11 md:h-9">
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={!form.paidAt || !(amount > 0)} className="h-11 md:h-9">
            Registrar pagamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Mode = "pagar" | "cancelar" | "whatsapp" | "ligar" | null;

/** Menu de ações de uma cobrança (pagamento, WhatsApp, ligação, cancelamento) com os diálogos. */
export function BillingActions({ billing, compact }: { billing: BillingLite; compact?: boolean }) {
  const id = React.useId();
  const [mode, setMode] = React.useState<Mode>(null);
  const [text, setText] = React.useState("");
  const { pending, run } = useFinanceAction();
  const open = billing.status === "aberta" || billing.status === "vencida";
  if (!open) return null;

  const openMode = (m: Mode) => {
    setText("");
    setMode(m);
  };

  const submitText = async () => {
    const ok =
      mode === "cancelar"
        ? await run(() => cancelBillingAction({ billingId: billing.id, reason: text }), "Cobrança cancelada")
        : mode === "whatsapp"
          ? await run(() => sendBillingWhatsappAction({ billingId: billing.id, notes: text }), "Cobrança enviada por WhatsApp (simulado)")
          : await run(() => registerBillingCallAction({ billingId: billing.id, notes: text }), "Ligação registrada");
    if (ok) setMode(null);
  };

  const titles: Record<Exclude<Mode, "pagar" | null>, { title: string; label: string; placeholder: string; confirm: string }> = {
    whatsapp: { title: "Enviar cobrança por WhatsApp", label: "Mensagem", placeholder: "Vazio = mensagem padrão com valor, vencimento e oferta de 2ª via/PIX", confirm: "Enviar" },
    ligar: { title: "Registrar ligação de cobrança", label: "Resultado da ligação", placeholder: "Ex.: cliente prometeu pagar até sexta", confirm: "Registrar" },
    cancelar: { title: "Cancelar cobrança", label: "Motivo", placeholder: "Ex.: cobrança duplicada", confirm: "Cancelar cobrança" },
  };
  const current = mode && mode !== "pagar" ? titles[mode] : null;

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        {!compact ? (
          <Button size="sm" variant="outline" className="h-10 md:h-8" onClick={() => openMode("pagar")}>
            <CircleDollarSign /> Pagar
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-10 md:size-8" aria-label={`Ações da cobrança ${billingLabel(billing)}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => openMode("pagar")}>
              <CircleDollarSign /> Registrar pagamento
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openMode("whatsapp")}>
              <MessageCircle /> Enviar cobrança por WhatsApp
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openMode("ligar")}>
              <Phone /> Ligar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => openMode("cancelar")}>
              <Ban /> Cancelar cobrança
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {mode === "pagar" ? <PaymentDialog billing={billing} open onOpenChange={(o) => !o && setMode(null)} /> : null}

      <Dialog open={current !== null} onOpenChange={(o) => !pending && !o && setMode(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{current?.title}</DialogTitle>
            <DialogDescription>
              {billingLabel(billing)} de {formatCurrency(billing.amount)} · vencimento {formatDate(billing.dueDate)}
              {billing.clientName ? ` · ${billing.clientName}` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <FormField label={current?.label} htmlFor={`${id}-t`} required={mode === "cancelar"}>
              <Textarea id={`${id}-t`} value={text} onChange={(e) => setText(e.target.value)} placeholder={current?.placeholder} />
            </FormField>
            {mode === "whatsapp" || mode === "ligar" ? <p className="mt-2 text-xs text-muted">Integração simulada: a comunicação é registrada e aparece na linha do tempo do cliente.</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)} disabled={pending} className="h-11 md:h-9">
              Voltar
            </Button>
            <Button variant={mode === "cancelar" ? "destructive" : "primary"} onClick={submitText} loading={pending} disabled={mode === "cancelar" && text.trim().length < 3} className="h-11 md:h-9">
              {current?.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
