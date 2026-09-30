"use client";

import * as React from "react";
import Link from "next/link";
import { Ban, CalendarCheck, Calculator, CheckCircle2, CircleDollarSign, History, Pencil, Plus, Route } from "lucide-react";
import type { PayableDetail } from "@/server/commissions/queries";
import { approvePayableAction, cancelPayableAction, createManualPayableAction, payPayableAction, schedulePayableAction, updatePayableAction } from "@/server/commissions/actions";
import { PAYOUT_METHOD_LABELS, PAYOUT_METHODS } from "@/server/commissions/schemas";
import { PAYABLE_CATEGORY_LABELS, PAYABLE_ORIGIN_LABELS } from "@/domain/commissions";
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

type Dialogs = null | "schedule" | "pay" | "cancel" | "edit";

export interface PayableCan {
  approve: boolean;
  pay: boolean;
  operate: boolean;
}

const today = () => dateKey(new Date());

/** Painel do título: valores, ações (aprovar → programar → pagar; cancelar), origem rastreável, memória da comissão e histórico. */
export function PayablePanel({ p, can }: { p: PayableDetail; can: PayableCan }) {
  const { pending, run } = useFinanceAction();
  const [dialog, setDialog] = React.useState<Dialogs>(null);
  const open = p.status !== "pago" && p.status !== "cancelado";
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
          </CardTitle>
          <p className="break-words text-sm text-muted">{p.description}</p>
        </CardHeader>
        <CardContent className="pt-0">
          <p className={`mb-3 text-2xl font-semibold tabular-nums ${p.amount < 0 ? "text-danger-fg" : ""}`}>{formatCurrency(p.amount)}</p>
          <DataList
            labelWidth="8rem"
            items={[
              { label: "Credor", value: p.creditorName },
              { label: "Categoria", value: PAYABLE_CATEGORY_LABELS[p.category] },
              { label: "Origem", value: PAYABLE_ORIGIN_LABELS[p.origin] },
              { label: "Competência", value: formatCompetence(p.competence) },
              { label: "Vencimento", value: formatDate(p.dueDate) },
              ...(p.approvedBy ? [{ label: "Aprovado por", value: `${p.approvedBy}${p.approvedAt ? ` em ${formatDate(p.approvedAt)}` : ""}` }] : []),
              ...(p.paidAt ? [{ label: "Pago em", value: `${formatDate(p.paidAt)}${p.paymentMethod ? ` · ${PAYOUT_METHOD_LABELS[p.paymentMethod as keyof typeof PAYOUT_METHOD_LABELS] ?? p.paymentMethod}` : ""}` }] : []),
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
              ...(p.cancelReason ? [{ label: "Motivo do cancelamento", value: p.cancelReason }] : []),
              ...(p.notes ? [{ label: "Observações", value: p.notes }] : []),
            ]}
          />
          {open && (can.approve || can.operate || can.pay) ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {p.status === "previsto" && can.approve ? (
                <Button className="h-11 md:h-9" loading={pending} onClick={() => run(() => approvePayableAction({ payableId: p.id }), "Título aprovado")}>
                  <CheckCircle2 /> Aprovar
                </Button>
              ) : null}
              {p.status === "aprovado" && can.operate ? (
                <Button variant="secondary" className="h-11 md:h-9" onClick={() => setDialog("schedule")}>
                  <CalendarCheck /> Programar pagamento
                </Button>
              ) : null}
              {(p.status === "aprovado" || p.status === "a_pagar") && can.pay ? (
                <Button variant="success" className="h-11 md:h-9" onClick={() => setDialog("pay")}>
                  <CircleDollarSign /> Pagar
                </Button>
              ) : null}
              {can.operate ? (
                <Button variant="outline" className="h-11 md:h-9" onClick={() => setDialog("edit")}>
                  <Pencil /> Alterar
                </Button>
              ) : null}
              {can.operate ? (
                <Button variant="outline" className="h-11 text-danger-fg md:h-9" onClick={() => setDialog("cancel")}>
                  <Ban /> Cancelar título
                </Button>
              ) : null}
            </div>
          ) : null}
          {open && p.status === "previsto" && !can.approve && can.operate ? <p className="mt-3 text-xs text-muted">Aguardando aprovação do gestor do Financeiro.</p> : null}
        </CardContent>
      </Card>

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

      {p.commission ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Calculator className="size-4 text-muted" /> Memória da comissão
              <Link href={`/financeiro/comissoes?comissao=${p.commission.id}`} className="text-sm font-normal text-brand-fg hover:underline">
                {p.commission.code}
              </Link>
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
      {dialog === "pay" ? <PayDialog p={p} pending={pending} onClose={() => setDialog(null)} onSubmit={(v) => run(() => payPayableAction({ payableId: p.id, ...v }), (d) => (d.commissions > 0 ? "Título pago · comissão marcada como paga" : "Título pago")).then(close)} /> : null}
      {dialog === "edit" ? <EditDialog p={p} pending={pending} onClose={() => setDialog(null)} onSubmit={(v) => run(() => updatePayableAction({ payableId: p.id, ...v }), "Título alterado").then(close)} /> : null}
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

function PayDialog({ p, pending, onClose, onSubmit }: { p: PayableDetail; pending: boolean; onClose: () => void; onSubmit: (v: { paidAt: string; paymentMethod: string; receiptUrl?: string; notes?: string }) => Promise<boolean> }) {
  const id = React.useId();
  const [paidAt, setPaidAt] = React.useState(today());
  const [method, setMethod] = React.useState<string>("pix");
  const [receiptUrl, setReceiptUrl] = React.useState("");
  const [notes, setNotes] = React.useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Pagar {p.code}</DialogTitle>
          <DialogDescription>
            {formatCurrency(p.amount)} para {p.creditorName}. {p.origin === "comissao_automatica" ? "A comissão vinculada é marcada como paga junto." : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <FormField label="Data do pagamento" htmlFor={`${id}-d`} required>
            <Input id={`${id}-d`} type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </FormField>
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
          <Button variant="success" onClick={() => onSubmit({ paidAt, paymentMethod: method, receiptUrl, notes })} loading={pending} disabled={!paidAt}>
            <CircleDollarSign /> Confirmar pagamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ p, pending, onClose, onSubmit }: { p: PayableDetail; pending: boolean; onClose: () => void; onSubmit: (v: { description?: string; dueDate?: string; amount?: number; notes?: string; reason: string }) => Promise<boolean> }) {
  const id = React.useId();
  const [description, setDescription] = React.useState(p.description);
  const [dueDate, setDueDate] = React.useState(dateKey(p.dueDate));
  const [amount, setAmount] = React.useState(String(p.amount));
  const [notes, setNotes] = React.useState(p.notes ?? "");
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
          <Button onClick={() => onSubmit({ description, dueDate, amount: amountEditable ? Number(amount) : undefined, notes, reason })} loading={pending} disabled={reason.trim().length < 5}>
            Salvar alteração
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Lançar título": título manual do Financeiro (bônus ou outros), para colaborador ou fornecedor. */
export function ManualPayableButton({ users }: { users: { value: string; label: string }[] }) {
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const { pending, run } = useFinanceAction();
  const month = today().slice(0, 7);
  const [f, setF] = React.useState({ creditorType: "colaborador" as "colaborador" | "fornecedor", creditorId: "", creditorName: "", category: "bonus" as "bonus" | "outros", description: "", amount: "", competence: month, dueDate: today(), notes: "" });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const submit = async () => {
    const ok = await run(() => createManualPayableAction({ ...f, amount: Number(f.amount) }), (d) => `Título ${d.code ?? ""} lançado`);
    if (ok) {
      setOpen(false);
      setF((prev) => ({ ...prev, description: "", amount: "", notes: "" }));
    }
  };
  return (
    <>
      <Button className="h-11 md:h-9" onClick={() => setOpen(true)}>
        <Plus /> Lançar título
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Lançar título a pagar</DialogTitle>
            <DialogDescription>Título manual (bônus ou outros). Entra como &quot;Previsto&quot; e segue o mesmo fluxo de aprovação e pagamento.</DialogDescription>
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
              <FormField label="Fornecedor" htmlFor={`${id}-forn`} required>
                <Input id={`${id}-forn`} value={f.creditorName} onChange={(e) => set("creditorName", e.target.value)} />
              </FormField>
            )}
            <FormField label="Categoria" htmlFor={`${id}-cat`} required>
              <Select id={`${id}-cat`} value={f.category} onChange={(e) => set("category", e.target.value as "bonus" | "outros")}>
                <option value="bonus">{PAYABLE_CATEGORY_LABELS.bonus}</option>
                <option value="outros">{PAYABLE_CATEGORY_LABELS.outros}</option>
              </Select>
            </FormField>
            <FormField label="Valor (R$)" htmlFor={`${id}-valor`} required>
              <Input id={`${id}-valor`} type="number" inputMode="decimal" min={0} step="0.01" value={f.amount} onChange={(e) => set("amount", e.target.value)} />
            </FormField>
            <FormField label="Descrição" htmlFor={`${id}-desc`} required className="sm:col-span-2">
              <Input id={`${id}-desc`} value={f.description} onChange={(e) => set("description", e.target.value)} />
            </FormField>
            <FormField label="Competência" htmlFor={`${id}-comp`} required>
              <Input id={`${id}-comp`} type="month" value={f.competence} onChange={(e) => set("competence", e.target.value)} />
            </FormField>
            <FormField label="Vencimento" htmlFor={`${id}-due`} required>
              <Input id={`${id}-due`} type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
            </FormField>
            <FormField label="Observações (opcional)" htmlFor={`${id}-obs`} className="sm:col-span-2">
              <Textarea id={`${id}-obs`} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={pending} disabled={!f.description.trim() || !(Number(f.amount) > 0)}>
              Lançar título
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
