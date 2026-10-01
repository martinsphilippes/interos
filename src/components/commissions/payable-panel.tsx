"use client";

import * as React from "react";
import Link from "next/link";
import { Ban, CalendarCheck, Calculator, CheckCircle2, CircleDollarSign, ExternalLink, FileText, History, Landmark, Paperclip, Pencil, Plus, Receipt, Repeat, Route, Scissors, Split, Undo2 } from "lucide-react";
import type { PayableDetail } from "@/server/commissions/queries";
import type { PayableCapabilities } from "@/server/commissions/access";
import { addPayableAttachmentAction, approvePayableAction, cancelPayableAction, createManualPayableAction, partialPayPayableAction, payPayableAction, payPayableWithResidualAction, schedulePayableAction, settlePayableByPaidAction, undoPayablePaymentAction, updatePayableAction } from "@/server/commissions/actions";
import { PAYOUT_METHOD_LABELS, PAYOUT_METHODS } from "@/server/commissions/schemas";
import { PAYABLE_ORIGIN_LABELS, payableCategoryLabel } from "@/domain/commissions";
import { dateKey, formatCompetence, formatCurrency, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataList } from "@/components/ui/data-list";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFinanceAction } from "@/components/finance/use-finance-action";
import { CalcMemory, CommissionStatusBadge, HistoryList, PayableStatusBadge, ReasonDialog, TraceChain } from "./commission-ui";
import { PaymentsHistory, SettleByPaidDialog, SettlementBadge, SettlementSummary } from "@/components/finance/settlement-ui";

type Dialogs = null | "schedule" | "pay" | "pay-partial" | "pay-residual" | "settle-paid" | "cancel" | "edit" | "attach" | "undo";

type Opt = { value: string; label: string };

/** Capacidades calculadas no servidor (payableCapabilities); a interface só esconde — as actions revalidam. */
export type PayableCan = Pick<PayableCapabilities, "approve" | "approveCommission" | "schedule" | "pay" | "edit" | "attach" | "cancel" | "operate"> & Partial<Pick<PayableCapabilities, "undoPayment" | "payPartial" | "payResidual" | "settleByPaid">>;

const today = () => dateKey(new Date());

/** Painel do título: valores, ações (aprovar → programar → pagar; cancelar), origem rastreável, anexos, série, memória da comissão e histórico. */
export function PayablePanel({ p, can, costCenters = [], accounts = [] }: { p: PayableDetail; can: PayableCan; costCenters?: string[]; accounts?: Opt[] }) {
  const { pending, run } = useFinanceAction();
  const [dialog, setDialog] = React.useState<Dialogs>(null);
  // Baixa específica a desfazer (histórico de baixas, etapa CP/CR 3).
  const [undoPaymentId, setUndoPaymentId] = React.useState<string | null>(null);
  const open = p.status !== "pago" && p.status !== "cancelado";
  const payable = (p.status === "aprovado" || p.status === "a_pagar") && p.open > 0;
  // Baixa parcial/resíduo/quitar pelo já pago: nunca em título de comissão/bônus (pagamento integral).
  const flexible = payable && !p.integralOnly && p.amount > 0;
  const undoTarget = undoPaymentId ? p.payments.find((x) => x.id === undoPaymentId) : undefined;
  // Título de comissão/estorno: aprovar exige também "Aprovar comissão".
  const canApprove = can.approve && (!(p.origin === "comissao_automatica" || p.origin === "estorno") || can.approveCommission);
  const supplierHref = p.trace.find((t) => t.key === "fornecedor")?.href;
  const commissionHref = p.trace.find((t) => t.key === "comissao")?.href;
  const close = (ok: boolean) => {
    if (ok) setDialog(null);
    return ok;
  };

  return (
    <>
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span data-testid="payable-code">{p.code}</span>
            <PayableStatusBadge status={p.status} overdue={p.overdue} size="md" />
            {p.status !== "cancelado" ? <SettlementBadge status={p.settlement} size="md" /> : null}
          </CardTitle>
          <p className="break-words text-sm text-muted">{p.description}</p>
        </CardHeader>
        <CardContent className="pt-0">
          <p className={`mb-1 text-2xl font-semibold tabular-nums ${p.amount < 0 ? "text-danger-fg" : ""}`}>{formatCurrency(p.amount)}</p>
          <SettlementSummary className="mb-3" paid={p.paid} open={p.open} status={p.settlement} originalAmount={p.originalAmount} amount={p.amount} verb="pago" />
          <DataList
            labelWidth="8rem"
            items={[
              { label: "Credor", value: p.creditorName, href: supplierHref },
              { label: "Categoria", value: payableCategoryLabel(p.category) },
              ...(p.costCenter ? [{ label: "Centro de custo", value: p.costCenter }] : []),
              { label: "Origem", value: `${PAYABLE_ORIGIN_LABELS[p.origin]}${p.installments ? ` · parcela ${p.installment}/${p.installments}` : ""}` },
              ...(p.recurrence ? [{ label: "Recorrência", value: `${p.recurrence.frequency === "anual" ? "Anual" : "Mensal"} · dia ${p.recurrence.dayOfMonth}${p.recurrence.until ? ` · até ${formatDate(`${p.recurrence.until}T12:00:00.000Z`)}` : " · sem data limite"}` }] : []),
              { label: "Competência", value: formatCompetence(p.competence) },
              { label: "Vencimento", value: formatDate(p.dueDate) },
              ...(p.approvedBy ? [{ label: "Aprovado por", value: `${p.approvedBy}${p.approvedAt ? ` em ${formatDate(p.approvedAt)}` : ""}` }] : []),
              ...(p.paidAt ? [{ label: "Pago em", value: `${formatDate(p.paidAt)}${p.paymentMethod ? ` · ${PAYOUT_METHOD_LABELS[p.paymentMethod as keyof typeof PAYOUT_METHOD_LABELS] ?? p.paymentMethod}` : ""}` }] : []),
              ...(p.status === "pago"
                ? [
                    {
                      label: "Conta da baixa",
                      value: p.payments.length ? (
                        <span data-testid="payable-payment-account">{Array.from(new Set(p.payments.map((x) => x.accountName))).join(", ")}</span>
                      ) : (
                        <span className="text-muted" data-testid="payable-payment-account">
                          Sem conta (pagamento anterior às contas financeiras)
                        </span>
                      ),
                    },
                  ]
                : []),
              ...(p.receiptUrl
                ? [
                    {
                      label: "Comprovante",
                      value: (
                        <a href={p.receiptUrl} target="_blank" rel="noreferrer" className="text-brand-fg hover:underline">
                          Abrir comprovante
                        </a>
                      ),
                    },
                  ]
                : []),
              ...(p.residual ? [{ label: "Resíduo", value: p.residual.code, href: `/financeiro/contas-a-pagar?titulo=${p.residual.id}` }] : []),
              ...(p.residualOf ? [{ label: "Resíduo de", value: p.residualOf.code, href: `/financeiro/contas-a-pagar?titulo=${p.residualOf.id}` }] : []),
              ...(p.cancelReason ? [{ label: "Motivo do cancelamento", value: p.cancelReason }] : []),
              ...(p.notes ? [{ label: "Observações", value: p.notes }] : []),
            ]}
          />
          {open && (canApprove || can.schedule || can.pay || can.edit || can.attach || can.cancel) ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {p.status === "previsto" && canApprove ? (
                <Button className="h-11 md:h-9" loading={pending} onClick={() => run(() => approvePayableAction({ payableId: p.id }), "Título aprovado")}>
                  <CheckCircle2 /> Aprovar
                </Button>
              ) : null}
              {p.status === "aprovado" && can.schedule ? (
                <Button variant="secondary" className="h-11 md:h-9" onClick={() => setDialog("schedule")}>
                  <CalendarCheck /> Programar pagamento
                </Button>
              ) : null}
              {payable && can.pay ? (
                <Button variant="success" className="h-11 md:h-9" onClick={() => setDialog("pay")}>
                  <CircleDollarSign /> Pagar
                </Button>
              ) : null}
              {flexible && can.payPartial ? (
                <Button variant="secondary" className="h-11 md:h-9" onClick={() => setDialog("pay-partial")}>
                  <Split /> Pagar parcialmente
                </Button>
              ) : null}
              {flexible && can.payResidual ? (
                <Button variant="secondary" className="h-11 md:h-9" onClick={() => setDialog("pay-residual")}>
                  <Scissors /> Pagar com resíduo
                </Button>
              ) : null}
              {flexible && p.paid > 0 && can.settleByPaid ? (
                <Button variant="outline" className="h-11 md:h-9" onClick={() => setDialog("settle-paid")}>
                  <Receipt /> Quitar pelo já pago
                </Button>
              ) : null}
              {can.edit ? (
                <Button variant="outline" className="h-11 md:h-9" onClick={() => setDialog("edit")}>
                  <Pencil /> Alterar
                </Button>
              ) : null}
              {can.attach ? (
                <Button variant="outline" className="h-11 md:h-9" onClick={() => setDialog("attach")}>
                  <Paperclip /> Anexar
                </Button>
              ) : null}
              {can.cancel && p.payments.length === 0 ? (
                <Button variant="outline" className="h-11 text-danger-fg md:h-9" onClick={() => setDialog("cancel")}>
                  <Ban /> Cancelar título
                </Button>
              ) : null}
            </div>
          ) : null}
          {open && p.status === "previsto" && !canApprove && can.operate ? <p className="mt-3 text-xs text-muted">Aguardando aprovação do gestor do Financeiro.</p> : null}
          {payable && p.integralOnly && (can.payPartial || can.payResidual) ? (
            <p className="mt-3 text-xs text-muted" data-testid="payable-integral-only">
              Título de comissão/bônus: pago só pelo valor integral (sem baixa parcial ou resíduo).
            </p>
          ) : null}
          {p.status === "pago" && can.undoPayment ? (
            p.undoBlocked ? (
              <p className="mt-3 text-xs text-muted" data-testid="payable-undo-blocked">
                {p.undoBlocked}
              </p>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="outline" className="h-11 md:h-9" onClick={() => setDialog("undo")}>
                  <Undo2 /> Desfazer pagamento
                </Button>
              </div>
            )
          ) : null}
        </CardContent>
      </Card>

      {p.payments.length > 0 ? (
        <PaymentsHistory
          title="Baixas"
          payments={p.payments.map((x) => ({ ...x, method: PAYOUT_METHOD_LABELS[x.method as keyof typeof PAYOUT_METHOD_LABELS] ?? x.method }))}
          canUndo={Boolean(can.undoPayment) && !p.undoBlocked}
          undoBlocked={can.undoPayment && p.status !== "pago" ? p.undoBlocked : undefined}
          onUndo={(id) => {
            setUndoPaymentId(id);
            setDialog("undo");
          }}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Route className="size-4 text-muted" /> Origem rastreável
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0" data-testid="payable-trace">
          <TraceChain links={p.trace} />
        </CardContent>
      </Card>

      {p.attachments.length > 0 || (!open ? false : can.attach) ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Paperclip className="size-4 text-muted" /> Anexos
            </CardTitle>
            {can.attach && p.status !== "cancelado" ? (
              <Button variant="ghost" size="sm" className="h-9 md:h-8" onClick={() => setDialog("attach")}>
                <Plus /> Anexar
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="pt-0" data-testid="payable-attachments">
            {p.attachments.length === 0 ? (
              <p className="text-sm text-muted">Nenhum anexo (nota fiscal, boleto do fornecedor, contrato). Anexe por link.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {p.attachments.map((d) => (
                  <li key={d.id}>
                    <a href={d.url} target="_blank" rel="noreferrer" className="flex min-h-[44px] items-center gap-3 py-2 hover:text-brand">
                      <FileText className="size-4 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{d.name}</span>
                        <span className="block text-xs text-muted">{formatDate(d.createdAt)}</span>
                      </span>
                      <ExternalLink className="size-3.5 shrink-0 text-muted" aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {p.siblings.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Repeat className="size-4 text-muted" /> {p.installments ? "Parcelas" : "Série recorrente"}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0" data-testid="payable-siblings">
            <ul className="flex flex-col divide-y divide-border text-sm">
              {p.siblings.map((sib) => (
                <li key={sib.id} className="flex items-center justify-between gap-2 py-1.5">
                  <Link href={`/financeiro/contas-a-pagar?titulo=${sib.id}`} className="font-medium hover:text-brand-fg">
                    {sib.code}
                  </Link>
                  <span className="text-muted">{formatCompetence(sib.competence)}</span>
                  <span className="tabular-nums">{formatCurrency(sib.amount)}</span>
                  <PayableStatusBadge status={sib.status} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {p.commission ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Calculator className="size-4 text-muted" /> Memória da comissão
              {commissionHref ? (
                <Link href={commissionHref} className="text-sm font-normal text-brand-fg hover:underline">
                  {p.commission.code}
                </Link>
              ) : (
                <span className="text-sm font-normal">{p.commission.code}</span>
              )}
              <CommissionStatusBadge status={p.commission.status} />
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <CalcMemory steps={p.commission.steps} ruleText={p.commission.ruleText} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4 text-muted" /> Histórico
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <HistoryList items={p.history} />
        </CardContent>
      </Card>

      {dialog === "schedule" ? <ScheduleDialog p={p} pending={pending} onClose={() => setDialog(null)} onSubmit={(v) => run(() => schedulePayableAction({ payableId: p.id, ...v }), "Pagamento programado").then(close)} /> : null}
      {dialog === "pay" ? <PayDialog p={p} mode="total" accounts={accounts} pending={pending} onClose={() => setDialog(null)} onSubmit={(v) => run(() => payPayableAction({ payableId: p.id, ...v }), (d) => (d.commissions > 0 ? "Título pago · comissão marcada como paga" : "Título pago")).then(close)} /> : null}
      {dialog === "pay-partial" ? <PayDialog p={p} mode="parcial" accounts={accounts} pending={pending} onClose={() => setDialog(null)} onSubmit={(v) => run(() => partialPayPayableAction({ payableId: p.id, ...v }), (d) => (d.settled ? "Baixa registrada · título quitado" : "Baixa parcial registrada")).then(close)} /> : null}
      {dialog === "pay-residual" ? <PayDialog p={p} mode="residuo" accounts={accounts} pending={pending} onClose={() => setDialog(null)} onSubmit={(v) => run(() => payPayableWithResidualAction({ payableId: p.id, ...v }), (d) => `Título pago com resíduo · ${d.residualCode ?? "resíduo"} criado`).then(close)} /> : null}
      {dialog === "settle-paid" ? <SettleByPaidDialog code={p.code ?? p.id} amount={p.amount} paid={p.paid} verb="pago" pending={pending} onClose={() => setDialog(null)} onConfirm={(reason) => run(() => settlePayableByPaidAction({ payableId: p.id, reason }), (d) => `Título quitado pelo já pago (${formatCurrency(d.amount)})`).then(close)} /> : null}
      {dialog === "edit" ? <EditDialog p={p} costCenters={costCenters} pending={pending} onClose={() => setDialog(null)} onSubmit={(v) => run(() => updatePayableAction({ payableId: p.id, ...v }), "Título alterado").then(close)} /> : null}
      {dialog === "attach" ? <AttachDialog p={p} pending={pending} onClose={() => setDialog(null)} onSubmit={(v) => run(() => addPayableAttachmentAction({ payableId: p.id, ...v }), "Anexo adicionado").then(close)} /> : null}
      <ReasonDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => setDialog(o ? "cancel" : null)}
        title={`Cancelar o título ${p.code}?`}
        description={p.origin === "comissao_automatica" ? "A comissão volta para \"Elegível\" (sem título) com este motivo; um novo título pode ser gerado depois na tela de Comissões." : "O título fica cancelado e não pode ser pago."}
        confirmLabel="Cancelar título"
        destructive
        pending={pending}
        onConfirm={(reason) => run(() => cancelPayableAction({ payableId: p.id, reason }), "Título cancelado").then(close)}
      />
      <ReasonDialog
        open={dialog === "undo"}
        onOpenChange={(o) => {
          setDialog(o ? "undo" : null);
          if (!o) setUndoPaymentId(null);
        }}
        title={undoTarget ? `Desfazer a baixa de ${formatCurrency(undoTarget.amount)} de ${p.code}?` : `Desfazer o pagamento de ${p.code}?`}
        description={
          undoTarget
            ? `A baixa de ${formatDate(`${undoTarget.date}T12:00:00.000Z`)} sai do título e o lançamento de ${formatCurrency(undoTarget.amount)} é apagado da conta ${undoTarget.accountName} (o saldo volta).${p.status === "pago" ? ' O título volta para "A pagar".' : ""}`
            : p.payments.length
              ? `O título volta para "A pagar" e o lançamento de ${formatCurrency(p.payments[p.payments.length - 1].amount)} é apagado da conta ${p.payments[p.payments.length - 1].accountName} (o saldo volta).`
              : 'O título volta para "A pagar". Este pagamento é anterior às contas financeiras: não há lançamento de caixa a apagar.'
        }
        confirmLabel={undoTarget ? "Desfazer baixa" : "Desfazer pagamento"}
        destructive
        pending={pending}
        onConfirm={(reason) =>
          run(() => undoPayablePaymentAction({ payableId: p.id, reason, ...(undoTarget ? { paymentId: undoTarget.id } : {}) }), (d) => (d.cashEntryRemoved ? "Pagamento desfeito · lançamento de caixa apagado" : "Pagamento desfeito")).then((ok) => {
            if (ok) setUndoPaymentId(null);
            return close(ok);
          })
        }
      />
    </>
  );
}

function ScheduleDialog({ p, pending, onClose, onSubmit }: { p: PayableDetail; pending: boolean; onClose: () => void; onSubmit: (v: { dueDate?: string; note?: string }) => Promise<boolean> }) {
  const id = React.useId();
  const [dueDate, setDueDate] = React.useState(dateKey(p.dueDate));
  const [note, setNote] = React.useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Programar o pagamento de {p.code}</DialogTitle>
          <DialogDescription>O título passa para &quot;A pagar&quot; na data escolhida. Mudar a data fica registrado na auditoria.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <FormField label="Data de pagamento" htmlFor={`${id}-d`} required>
            <Input id={`${id}-d`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </FormField>
          <FormField label="Observação (opcional)" htmlFor={`${id}-n`}>
            <Textarea id={`${id}-n`} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Voltar
          </Button>
          <Button onClick={() => onSubmit({ dueDate, note })} loading={pending} disabled={!dueDate}>
            <CalendarCheck /> Programar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PayMode = "total" | "parcial" | "residuo";

const PAY_MODE_TEXT: Record<PayMode, { title: string; confirm: string; amountLabel: string; hint: string }> = {
  total: { title: "Pagar", confirm: "Confirmar pagamento", amountLabel: "Valor pago (R$)", hint: "Padrão = valor em aberto. Valor diferente ajusta o valor do título (desconto ou juros)." },
  parcial: { title: "Pagar parcialmente", confirm: "Registrar baixa parcial", amountLabel: "Valor desta baixa (R$)", hint: "Até o valor em aberto; o título continua com saldo (fecha sozinho se cobrir o restante)." },
  residuo: { title: "Pagar com resíduo", confirm: "Pagar e criar resíduo", amountLabel: "Valor pago agora (R$)", hint: "Menor que o em aberto: o título fica pago por este total e o restante vira um novo título “— Resíduo”." },
};

function PayDialog({ p, mode, accounts, pending, onClose, onSubmit }: { p: PayableDetail; mode: PayMode; accounts: Opt[]; pending: boolean; onClose: () => void; onSubmit: (v: { paidAt: string; paymentMethod: string; receiptUrl?: string; notes?: string; accountId: string; amount?: number; reason?: string }) => Promise<boolean> }) {
  const id = React.useId();
  const text = PAY_MODE_TEXT[mode];
  // Conta da baixa (etapa CP/CR 2): a prevista no título ou, havendo uma só conta ativa, ela; senão o usuário escolhe.
  const [accountId, setAccountId] = React.useState(() => (p.accountId && accounts.some((a) => a.value === p.accountId) ? p.accountId : accounts.length === 1 ? accounts[0].value : ""));
  const [paidAt, setPaidAt] = React.useState(today());
  const [method, setMethod] = React.useState<string>("pix");
  const [receiptUrl, setReceiptUrl] = React.useState("");
  const [notes, setNotes] = React.useState("");
  // Valor (etapa CP/CR 3): Quitar já vem com o em aberto; parcial/resíduo o usuário informa.
  const [amount, setAmount] = React.useState(mode === "total" ? String(p.open) : "");
  const [reason, setReason] = React.useState("");
  const value = Number(amount);
  const cents = (v: number) => Math.round(v * 100);
  const changed = mode === "total" && amount.trim() !== "" && cents(value) !== cents(p.open);
  const residual = mode === "residuo" && value > 0 && cents(value) < cents(p.open) ? (cents(p.open) - cents(value)) / 100 : null;
  const amountLocked = mode === "total" && (p.integralOnly || p.amount < 0);
  const amountOk = amountLocked || (value > 0 && (mode !== "parcial" || cents(value) <= cents(p.open)) && (mode !== "residuo" || residual !== null));
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>
            {text.title} {p.code}
          </DialogTitle>
          <DialogDescription>
            {formatCurrency(p.amount)} para {p.creditorName}
            {p.paid > 0 ? ` · já pago ${formatCurrency(p.paid)} · em aberto ${formatCurrency(p.open)}` : ""}. {p.origin === "comissao_automatica" ? "A comissão vinculada é marcada como paga junto." : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <FormField label="Data do pagamento" htmlFor={`${id}-d`} required>
            <Input id={`${id}-d`} type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </FormField>
          <FormField label={text.amountLabel} htmlFor={`${id}-v`} required={!amountLocked} hint={amountLocked ? "Título de comissão/bônus: valor integral" : text.hint}>
            <Input id={`${id}-v`} type="number" inputMode="decimal" min={0} step="0.01" value={amountLocked ? String(p.open) : amount} onChange={(e) => setAmount(e.target.value)} disabled={amountLocked} />
          </FormField>
          {residual !== null ? (
            <p className="rounded-md border border-info/35 bg-info-soft px-3 py-2 text-sm text-info-fg" data-testid="residual-preview">
              O título fica pago por {formatCurrency((cents(p.paid) + cents(value)) / 100)} e nasce “{p.description.replace(/\s*[—–-]\s*Res[íi]duo\s*$/i, "")} — Resíduo” de {formatCurrency(residual)}, mesmo vencimento.
            </p>
          ) : null}
          {changed || mode === "residuo" ? (
            <FormField label={mode === "residuo" ? "Motivo (opcional)" : "Motivo do ajuste (opcional)"} htmlFor={`${id}-why`} hint={mode === "residuo" ? undefined : value < p.open ? "Desconto: o valor do título passa a ser o total pago" : "Juros/multa: o valor do título passa a ser o total pago"}>
              <Input id={`${id}-why`} value={reason} onChange={(e) => setReason(e.target.value)} />
            </FormField>
          ) : null}
          {accounts.length > 0 ? (
            <FormField label="Conta financeira" htmlFor={`${id}-a`} required hint="De onde o dinheiro saiu: gera o lançamento de despesa no extrato da conta" error={accountId ? undefined : "Escolha a conta"}>
              <Select id={`${id}-a`} value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="Selecione a conta" options={accounts} />
            </FormField>
          ) : (
            <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-fg" data-testid="pay-no-account">
              <Landmark className="mt-0.5 size-4 shrink-0" />
              <span>
                Nenhuma conta financeira cadastrada. Cadastre em{" "}
                <Link href="/financeiro/cadastros?aba=contas" className="font-medium text-brand-fg hover:underline">
                  Financeiro › Cadastros financeiros
                </Link>{" "}
                para registrar o pagamento.
              </span>
            </p>
          )}
          <FormField label="Forma de pagamento" htmlFor={`${id}-m`} required>
            <Select id={`${id}-m`} value={method} onChange={(e) => setMethod(e.target.value)} options={PAYOUT_METHODS.map((m) => ({ value: m, label: PAYOUT_METHOD_LABELS[m] }))} />
          </FormField>
          <FormField label="Link do comprovante (opcional)" htmlFor={`${id}-r`} hint="URL do comprovante (drive, banco)">
            <Input id={`${id}-r`} type="url" value={receiptUrl} onChange={(e) => setReceiptUrl(e.target.value)} placeholder="https://" />
          </FormField>
          <FormField label="Observações (opcional)" htmlFor={`${id}-o`}>
            <Textarea id={`${id}-o`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Voltar
          </Button>
          <Button
            variant="success"
            onClick={() => onSubmit({ paidAt, paymentMethod: method, receiptUrl, notes, accountId, ...(amountLocked ? {} : mode === "total" ? (changed ? { amount: value } : {}) : { amount: value }), ...(reason.trim() ? { reason: reason.trim() } : {}) })}
            loading={pending}
            disabled={!paidAt || !amountOk}
          >
            <CircleDollarSign /> {text.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ p, costCenters, pending, onClose, onSubmit }: { p: PayableDetail; costCenters: string[]; pending: boolean; onClose: () => void; onSubmit: (v: { description?: string; dueDate?: string; amount?: number; notes?: string; costCenter?: string; recurrenceUntil?: string; reason: string }) => Promise<boolean> }) {
  const id = React.useId();
  const [description, setDescription] = React.useState(p.description);
  const [dueDate, setDueDate] = React.useState(dateKey(p.dueDate));
  const [amount, setAmount] = React.useState(String(p.amount));
  const [notes, setNotes] = React.useState(p.notes ?? "");
  const [costCenter, setCostCenter] = React.useState(p.costCenter ?? "");
  const [recurrenceUntil, setRecurrenceUntil] = React.useState(p.recurrence?.until ?? "");
  const [reason, setReason] = React.useState("");
  const amountEditable = p.origin === "manual" && p.status === "previsto";
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Alterar {p.code}</DialogTitle>
          <DialogDescription>Toda alteração guarda o valor anterior, o novo e o motivo. O valor de título de comissão segue a memória de cálculo e não é editável.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4 sm:grid-cols-2">
          <FormField label="Descrição" htmlFor={`${id}-desc`} className="sm:col-span-2">
            <Input id={`${id}-desc`} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
          <FormField label="Vencimento" htmlFor={`${id}-due`}>
            <Input id={`${id}-due`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </FormField>
          <FormField label="Valor (R$)" htmlFor={`${id}-amount`} hint={amountEditable ? undefined : "Só em título manual previsto"}>
            <Input id={`${id}-amount`} type="number" inputMode="decimal" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!amountEditable} />
          </FormField>
          {costCenters.length > 0 ? (
            <FormField label="Centro de custo" htmlFor={`${id}-cc`}>
              <Select id={`${id}-cc`} value={costCenter} onChange={(e) => setCostCenter(e.target.value)} placeholder="Sem centro de custo" options={costCenters.map((c) => ({ value: c, label: c }))} />
            </FormField>
          ) : null}
          {p.recurrence ? (
            <FormField label="Repetir até" htmlFor={`${id}-until`} hint="Encerra a série recorrente nesta data">
              <Input id={`${id}-until`} type="date" value={recurrenceUntil} onChange={(e) => setRecurrenceUntil(e.target.value)} />
            </FormField>
          ) : null}
          <FormField label="Observações" htmlFor={`${id}-notes`} className="sm:col-span-2">
            <Textarea id={`${id}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </FormField>
          <FormField label="Motivo da alteração" htmlFor={`${id}-reason`} required className="sm:col-span-2" hint="Mínimo de 5 caracteres">
            <Textarea id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Voltar
          </Button>
          <Button onClick={() => onSubmit({ description, dueDate, amount: amountEditable ? Number(amount) : undefined, notes, costCenter: costCenter || undefined, recurrenceUntil: recurrenceUntil || undefined, reason })} loading={pending} disabled={reason.trim().length < 5}>
            Salvar alteração
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AttachDialog({ p, pending, onClose, onSubmit }: { p: PayableDetail; pending: boolean; onClose: () => void; onSubmit: (v: { name: string; url: string }) => Promise<boolean> }) {
  const id = React.useId();
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Anexar documento a {p.code}</DialogTitle>
          <DialogDescription>Link do documento (nota fiscal, boleto do fornecedor, contrato). Entra nos documentos do sistema ligado a este título.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <FormField label="Nome" htmlFor={`${id}-n`} required>
            <Input id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: NF 1234 — Aluguel setembro" />
          </FormField>
          <FormField label="Link" htmlFor={`${id}-u`} required>
            <Input id={`${id}-u`} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Voltar
          </Button>
          <Button onClick={() => onSubmit({ name, url })} loading={pending} disabled={name.trim().length < 2 || !/^https?:\/\//.test(url.trim())}>
            <Paperclip /> Anexar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface ManualPayableButtonProps {
  users: { value: string; label: string }[];
  suppliers?: { value: string; label: string }[];
  categories?: { value: string; label: string }[];
  costCenters?: string[];
}

const SUPPLIER_FREE = "__livre__";

/**
 * "Lançar título": título manual do Financeiro (D28) — colaborador ou fornecedor (cadastrado ou nome livre), categoria e
 * centro de custo do setting, parcelamento (N títulos) ou recorrência (série), anexo por link. Entra como "Previsto"
 * e segue o mesmo fluxo de aprovação e pagamento.
 */
export function ManualPayableButton({ users, suppliers = [], categories = [{ value: "bonus", label: payableCategoryLabel("bonus") }, { value: "outros", label: payableCategoryLabel("outros") }], costCenters = [] }: ManualPayableButtonProps) {
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const { pending, run } = useFinanceAction();
  const month = today().slice(0, 7);
  const [f, setF] = React.useState({
    creditorType: "colaborador" as "colaborador" | "fornecedor",
    creditorId: "",
    supplierId: suppliers[0]?.value ?? SUPPLIER_FREE,
    creditorName: "",
    category: categories.find((c) => c.value === "bonus")?.value ?? categories[0]?.value ?? "outros",
    costCenter: "",
    description: "",
    amount: "",
    competence: month,
    dueDate: today(),
    notes: "",
    mode: "unico" as "unico" | "parcelado" | "recorrente",
    installments: "2",
    frequency: "mensal" as "mensal" | "anual",
    dayOfMonth: "10",
    until: "",
    attachmentUrl: "",
    attachmentName: "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const supplierFree = f.supplierId === SUPPLIER_FREE || suppliers.length === 0;
  const submit = async () => {
    const ok = await run(
      () =>
        createManualPayableAction({
          creditorType: f.creditorType,
          creditorId: f.creditorType === "colaborador" ? f.creditorId : undefined,
          supplierId: f.creditorType === "fornecedor" && !supplierFree ? f.supplierId : undefined,
          creditorName: f.creditorType === "fornecedor" && supplierFree ? f.creditorName : undefined,
          category: f.category,
          costCenter: f.costCenter || undefined,
          description: f.description,
          amount: Number(f.amount),
          competence: f.competence,
          dueDate: f.dueDate,
          notes: f.notes,
          installments: f.mode === "parcelado" ? Number(f.installments) : undefined,
          recurrence: f.mode === "recorrente" ? { frequency: f.frequency, dayOfMonth: Number(f.dayOfMonth), until: f.until || undefined } : undefined,
          attachmentUrl: f.attachmentUrl || undefined,
          attachmentName: f.attachmentName || undefined,
        }),
      (d) => (d.parcels > 1 ? `${d.parcels} títulos lançados (${d.code ?? ""} …)` : `Título ${d.code ?? ""} lançado`),
    );
    if (ok) {
      setOpen(false);
      setF((prev) => ({ ...prev, description: "", amount: "", notes: "", attachmentUrl: "", attachmentName: "", mode: "unico" }));
    }
  };
  const creditorOk = f.creditorType === "colaborador" ? Boolean(f.creditorId) : supplierFree ? f.creditorName.trim().length >= 2 : Boolean(f.supplierId);
  const valid = creditorOk && f.description.trim().length >= 3 && Number(f.amount) > 0 && Boolean(f.category) && (f.mode !== "parcelado" || Number(f.installments) >= 2) && (f.mode !== "recorrente" || (Number(f.dayOfMonth) >= 1 && Number(f.dayOfMonth) <= 28));
  return (
    <>
      <Button className="h-11 md:h-9" onClick={() => setOpen(true)}>
        <Plus /> Lançar título
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Lançar título a pagar</DialogTitle>
            <DialogDescription>Título manual (fornecedor, imposto, folha, bônus, outros). Entra como &quot;Previsto&quot; e segue o mesmo fluxo de aprovação e pagamento. Comissões nascem do motor, não daqui.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <FormField label="Credor" htmlFor={`${id}-tipo`} required>
              <Select id={`${id}-tipo`} value={f.creditorType} onChange={(e) => set("creditorType", e.target.value as "colaborador" | "fornecedor")}>
                <option value="colaborador">Colaborador</option>
                <option value="fornecedor">Fornecedor</option>
              </Select>
            </FormField>
            {f.creditorType === "colaborador" ? (
              <FormField label="Colaborador" htmlFor={`${id}-user`} required>
                <Select id={`${id}-user`} value={f.creditorId} onChange={(e) => set("creditorId", e.target.value)} placeholder="Escolha" options={users} />
              </FormField>
            ) : (
              <>
                <FormField label="Fornecedor" htmlFor={`${id}-sup`} required hint={suppliers.length === 0 ? "Nenhum fornecedor cadastrado: informe o nome (ou cadastre em Fornecedores)" : undefined}>
                  <Select id={`${id}-sup`} value={f.supplierId} onChange={(e) => set("supplierId", e.target.value)} options={[...suppliers, { value: SUPPLIER_FREE, label: "Outro (nome livre)" }]} />
                </FormField>
                {supplierFree ? (
                  <FormField label="Nome do fornecedor" htmlFor={`${id}-forn`} required className="sm:col-span-2">
                    <Input id={`${id}-forn`} value={f.creditorName} onChange={(e) => set("creditorName", e.target.value)} />
                  </FormField>
                ) : null}
              </>
            )}
            <FormField label="Categoria" htmlFor={`${id}-cat`} required hint="Lista em Configurações › Contas a pagar">
              <Select id={`${id}-cat`} value={f.category} onChange={(e) => set("category", e.target.value)} options={categories} />
            </FormField>
            <FormField label="Centro de custo" htmlFor={`${id}-cc`} hint={costCenters.length === 0 ? "Nenhum centro cadastrado em Configurações" : undefined}>
              <Select id={`${id}-cc`} value={f.costCenter} onChange={(e) => set("costCenter", e.target.value)} placeholder="Sem centro de custo" options={costCenters.map((c) => ({ value: c, label: c }))} disabled={costCenters.length === 0} />
            </FormField>
            <FormField label="Descrição" htmlFor={`${id}-desc`} required className="sm:col-span-2">
              <Input id={`${id}-desc`} value={f.description} onChange={(e) => set("description", e.target.value)} />
            </FormField>
            <FormField label={f.mode === "parcelado" ? "Valor total (R$)" : "Valor (R$)"} htmlFor={`${id}-valor`} required>
              <Input id={`${id}-valor`} type="number" inputMode="decimal" min={0} step="0.01" value={f.amount} onChange={(e) => set("amount", e.target.value)} />
            </FormField>
            <FormField label="Lançamento" htmlFor={`${id}-mode`} required>
              <Select id={`${id}-mode`} value={f.mode} onChange={(e) => set("mode", e.target.value as typeof f.mode)}>
                <option value="unico">Único</option>
                <option value="parcelado">Parcelado (N títulos)</option>
                <option value="recorrente">Recorrente (série)</option>
              </Select>
            </FormField>
            <FormField label="Competência" htmlFor={`${id}-comp`} required>
              <Input id={`${id}-comp`} type="month" value={f.competence} onChange={(e) => set("competence", e.target.value)} />
            </FormField>
            <FormField label={f.mode === "parcelado" ? "Vencimento da 1ª parcela" : "Vencimento"} htmlFor={`${id}-due`} required>
              <Input id={`${id}-due`} type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
            </FormField>
            {f.mode === "parcelado" ? (
              <FormField label="Parcelas" htmlFor={`${id}-inst`} required hint="Vencimentos mensais a partir da 1ª parcela; centavos exatos">
                <Input id={`${id}-inst`} type="number" inputMode="numeric" min={2} max={48} value={f.installments} onChange={(e) => set("installments", e.target.value)} />
              </FormField>
            ) : null}
            {f.mode === "recorrente" ? (
              <>
                <FormField label="Frequência" htmlFor={`${id}-freq`} required>
                  <Select id={`${id}-freq`} value={f.frequency} onChange={(e) => set("frequency", e.target.value as "mensal" | "anual")}>
                    <option value="mensal">Mensal</option>
                    <option value="anual">Anual</option>
                  </Select>
                </FormField>
                <FormField label="Dia do vencimento" htmlFor={`${id}-dom`} required hint="1 a 28">
                  <Input id={`${id}-dom`} type="number" inputMode="numeric" min={1} max={28} value={f.dayOfMonth} onChange={(e) => set("dayOfMonth", e.target.value)} />
                </FormField>
                <FormField label="Repetir até" htmlFor={`${id}-until`} hint="Vazio = sem data limite. A próxima ocorrência nasce 30 dias antes do vencimento.">
                  <Input id={`${id}-until`} type="date" value={f.until} onChange={(e) => set("until", e.target.value)} />
                </FormField>
              </>
            ) : null}
            <FormField label="Anexo (link)" htmlFor={`${id}-att`} hint="Nota fiscal, boleto do fornecedor…">
              <Input id={`${id}-att`} type="url" value={f.attachmentUrl} onChange={(e) => set("attachmentUrl", e.target.value)} placeholder="https://" />
            </FormField>
            <FormField label="Nome do anexo" htmlFor={`${id}-attn`}>
              <Input id={`${id}-attn`} value={f.attachmentName} onChange={(e) => set("attachmentName", e.target.value)} disabled={!f.attachmentUrl} />
            </FormField>
            <FormField label="Observações (opcional)" htmlFor={`${id}-obs`} className="sm:col-span-2">
              <Textarea id={`${id}-obs`} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={pending} disabled={!valid}>
              {f.mode === "parcelado" ? `Lançar ${Number(f.installments) || 0} títulos` : "Lançar título"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
