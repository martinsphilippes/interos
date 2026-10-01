"use client";

import * as React from "react";
import Link from "next/link";
import { Ban, CircleDollarSign, Copy, ExternalLink, FileText, History, Landmark, Paperclip, Pencil, Plus, Receipt, Repeat, Scissors, Split } from "lucide-react";
import type { ReceivableDetail } from "@/server/receivables/queries";
import type { ReceivableCapabilities } from "@/server/receivables/access";
import { addReceivableAttachmentAction, cancelReceivableAction, createReceivableAction, partialReceiveReceivableAction, receiveReceivableAction, receiveWithResidualAction, settleReceivableByPaidAction, undoReceivablePaymentAction, updateReceivableAction } from "@/server/receivables/actions";
import { RECEIPT_METHODS } from "@/server/receivables/schemas";
import { paymentMethodLabel } from "@/server/finance/schemas";
import { residualDescription } from "@/domain/settlements";
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
import { PaymentsHistory, SettleByPaidDialog, SettlementBadge, SettlementSummary } from "@/components/finance/settlement-ui";
import { HistoryList, ReasonDialog } from "@/components/commissions/commission-ui";
import { MoneyInput } from "@/components/ui/money-input";
import { ClassificationFields, EMPTY_CLASSIFICATION, NoClassificationNotice, type ClassificationValue } from "@/components/finance/classification-fields";
import { DEFAULT_REPEAT, OccurrencePreview, RepeatFields, repeatInput } from "@/components/finance/repeat-fields";
import { hasClassification, splitCategoryOption, titleCategoryId, type ClassificationOptions } from "@/domain/title-classification";
import { planOccurrences, stripInstallmentSuffix, type RepeatMode } from "@/domain/title-repeat";

type Opt = { value: string; label: string };

export interface ReceivableOptions {
  clients: Opt[];
  categories: Opt[];
  centers: Opt[];
  accounts: Opt[];
  /** Centro efetivo de cada categoria (pré-preenche o centro ao escolher a categoria). */
  categoryCenters: Record<string, string>;
  /** Etapa CP/CR 4: Centro → Categoria → Subcategoria de RECEITA (null/ausente = selects da etapa 3 com aviso). */
  classification?: ClassificationOptions | null;
}

type Dialogs = null | "receive" | "receive-partial" | "receive-residual" | "settle" | "edit" | "attach" | "cancel" | "undo" | "clone";
type ReceiveMode = "total" | "parcial" | "residuo";

const today = () => dateKey(new Date());
const cents = (v: number) => Math.round(v * 100);
const money = (v: number | null) => (v === null ? "Restrito" : formatCurrency(v));

/** Painel do título a receber avulso: valores, recebimentos (total, parcial, resíduo, quitar pelo já recebido), baixas com desfazer, anexos, parcelas e histórico. */
export function ReceivablePanel({ r, can, options }: { r: ReceivableDetail; can: ReceivableCapabilities; options: ReceivableOptions }) {
  const { pending, run } = useFinanceAction();
  const [dialog, setDialog] = React.useState<Dialogs>(null);
  const [undoId, setUndoId] = React.useState<string | null>(null);
  const isOpen = r.status === "aberto";
  const receivable = isOpen && r.open !== null && r.open > 0;
  const undoTarget = undoId ? r.payments.find((x) => x.id === undoId) : undefined;
  const close = (ok: boolean) => {
    if (ok) setDialog(null);
    return ok;
  };
  return (
    <>
      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span data-testid="receivable-code">{r.code}</span>
            <SettlementBadge status={r.settlement} size="md" />
          </CardTitle>
          <p className="break-words text-sm text-muted">{r.description}</p>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="mb-1 text-2xl font-semibold tabular-nums">{money(r.amount)}</p>
          {r.amount !== null && r.paid !== null && r.open !== null ? <SettlementSummary className="mb-3" paid={r.paid} open={r.open} status={r.settlement} amount={r.amount} originalAmount={r.originalAmount} verb="recebido" /> : null}
          <DataList
            labelWidth="8rem"
            items={[
              { label: "Cliente / pagador", value: r.payerName, href: r.clientId ? `/clientes/${r.clientId}` : undefined },
              { label: "Categoria", value: r.categoryName },
              { label: "Centro de custo", value: `${r.costCenter.name}${r.costCenter.inherited && r.categoryId ? " (da categoria)" : ""}` },
              ...(r.accountName ? [{ label: "Conta prevista", value: r.accountName }] : []),
              { label: "Competência", value: formatCompetence(r.competence) },
              { label: "Vencimento", value: formatDate(r.dueDate) },
              ...(r.installments ? [{ label: "Parcela", value: `${r.installment}/${r.installments}` }] : []),
              ...(r.documentNumber ? [{ label: "Nº do documento", value: <span data-testid="receivable-document-number">{r.documentNumber}</span> }] : []),
              ...(r.paidAt ? [{ label: "Recebido em", value: formatDate(r.paidAt) }] : []),
              ...(r.residual ? [{ label: "Resíduo", value: r.residual.code, href: `/financeiro/contas-a-receber?aba=avulsos&titulo=${r.residual.id}` }] : []),
              ...(r.residualOf ? [{ label: "Resíduo de", value: r.residualOf.code, href: `/financeiro/contas-a-receber?aba=avulsos&titulo=${r.residualOf.id}` }] : []),
              ...(r.cancelReason ? [{ label: "Motivo do cancelamento", value: r.cancelReason }] : []),
              ...(r.notes ? [{ label: "Observações", value: r.notes }] : []),
            ]}
          />
          {isOpen && (can.receive || can.edit || can.cancel) ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {receivable && can.receive ? (
                <>
                  <Button variant="success" className="h-11 md:h-9" onClick={() => setDialog("receive")}>
                    <CircleDollarSign /> Receber
                  </Button>
                  <Button variant="secondary" className="h-11 md:h-9" onClick={() => setDialog("receive-partial")}>
                    <Split /> Receber parcialmente
                  </Button>
                  <Button variant="secondary" className="h-11 md:h-9" onClick={() => setDialog("receive-residual")}>
                    <Scissors /> Receber com resíduo
                  </Button>
                  {r.paid ? (
                    <Button variant="outline" className="h-11 md:h-9" onClick={() => setDialog("settle")}>
                      <Receipt /> Quitar pelo já recebido
                    </Button>
                  ) : null}
                </>
              ) : null}
              {can.edit ? (
                <>
                  <Button variant="outline" className="h-11 md:h-9" onClick={() => setDialog("edit")}>
                    <Pencil /> Alterar
                  </Button>
                  <Button variant="outline" className="h-11 md:h-9" onClick={() => setDialog("attach")}>
                    <Paperclip /> Anexar
                  </Button>
                </>
              ) : null}
              {can.cancel && r.payments.length === 0 && !r.paid ? (
                <Button variant="outline" className="h-11 text-danger-fg md:h-9" onClick={() => setDialog("cancel")}>
                  <Ban /> Cancelar título
                </Button>
              ) : null}
            </div>
          ) : null}
          {can.create ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="ghost" className="h-11 md:h-9" onClick={() => setDialog("clone")} data-testid="receivable-clone">
                <Copy /> Clonar
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {r.payments.length > 0 ? (
        <PaymentsHistory
          title="Recebimentos"
          payments={r.payments}
          canUndo={can.undo && r.status !== "cancelado"}
          onUndo={(id) => {
            setUndoId(id);
            setDialog("undo");
          }}
        />
      ) : null}

      {r.attachments.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Paperclip className="size-4 text-muted" /> Anexos
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0" data-testid="receivable-attachments">
            <ul className="flex flex-col divide-y divide-border">
              {r.attachments.map((d) => (
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
          </CardContent>
        </Card>
      ) : null}

      {r.siblings.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Repeat className="size-4 text-muted" /> Parcelas e resíduos da série
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="flex flex-col divide-y divide-border text-sm">
              {r.siblings.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
                  <Link href={`/financeiro/contas-a-receber?aba=avulsos&titulo=${s.id}`} className="font-medium hover:text-brand-fg">
                    {s.code}
                  </Link>
                  <span className="text-muted">{formatDate(s.dueDate)}</span>
                  <span className="tabular-nums">{money(s.amount)}</span>
                  <SettlementBadge status={s.settlement} />
                </li>
              ))}
            </ul>
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
          <HistoryList items={r.history} />
        </CardContent>
      </Card>

      {dialog === "receive" || dialog === "receive-partial" || dialog === "receive-residual" ? (
        <ReceiveDialog
          r={r}
          mode={dialog === "receive" ? "total" : dialog === "receive-partial" ? "parcial" : "residuo"}
          accounts={options.accounts}
          pending={pending}
          onClose={() => setDialog(null)}
          onSubmit={(mode, v) =>
            (mode === "total"
              ? run(() => receiveReceivableAction({ receivableId: r.id, ...v }), "Recebimento registrado · título quitado")
              : mode === "parcial"
                ? run(() => partialReceiveReceivableAction({ receivableId: r.id, ...v }), (d) => (d.settled ? "Recebimento registrado · título quitado" : "Recebimento parcial registrado"))
                : run(() => receiveWithResidualAction({ receivableId: r.id, ...v }), (d) => `Recebido com resíduo · ${d.residualCode ?? "resíduo"} criado`)
            ).then(close)
          }
        />
      ) : null}
      {dialog === "settle" && r.amount !== null && r.paid !== null ? <SettleByPaidDialog code={r.code} amount={r.amount} paid={r.paid} verb="recebido" pending={pending} onClose={() => setDialog(null)} onConfirm={(reason) => run(() => settleReceivableByPaidAction({ receivableId: r.id, reason }), (d) => `Título quitado pelo já recebido (${formatCurrency(d.amount)})`).then(close)} /> : null}
      {dialog === "edit" ? <EditReceivableDialog r={r} options={options} values={can.values} pending={pending} onClose={() => setDialog(null)} onSubmit={(v) => run(() => updateReceivableAction({ receivableId: r.id, ...v }), "Título alterado").then(close)} /> : null}
      {dialog === "clone" ? <ReceivableFormDialog options={options} cloneOf={r.code} initial={cloneInitial(r)} onClose={() => setDialog(null)} /> : null}
      {dialog === "attach" ? <AttachDialog code={r.code} pending={pending} onClose={() => setDialog(null)} onSubmit={(v) => run(() => addReceivableAttachmentAction({ receivableId: r.id, ...v }), "Anexo adicionado").then(close)} /> : null}
      <ReasonDialog open={dialog === "cancel"} onOpenChange={(o) => setDialog(o ? "cancel" : null)} title={`Cancelar o título ${r.code}?`} description="O título fica cancelado (não é excluído) e não pode mais ser recebido. O motivo fica no histórico e na auditoria." confirmLabel="Cancelar título" destructive pending={pending} onConfirm={(reason) => run(() => cancelReceivableAction({ receivableId: r.id, reason }), "Título cancelado").then(close)} />
      <ReasonDialog
        open={dialog === "undo"}
        onOpenChange={(o) => {
          setDialog(o ? "undo" : null);
          if (!o) setUndoId(null);
        }}
        title={undoTarget ? `Desfazer o recebimento de ${formatCurrency(undoTarget.amount)}?` : "Desfazer o recebimento?"}
        description={undoTarget ? `O recebimento de ${formatDate(`${undoTarget.date}T12:00:00.000Z`)} sai do título e o lançamento de ${formatCurrency(undoTarget.amount)} é apagado da conta ${undoTarget.accountName} (o saldo volta).${r.status === "pago" ? " O título volta para em aberto." : ""}` : undefined}
        confirmLabel="Desfazer recebimento"
        destructive
        pending={pending}
        onConfirm={(reason) =>
          run(() => undoReceivablePaymentAction({ receivableId: r.id, reason, ...(undoTarget ? { paymentId: undoTarget.id } : {}) }), (d) => (d.cashEntryRemoved ? "Recebimento desfeito · lançamento de caixa apagado" : "Recebimento desfeito")).then((ok) => {
            if (ok) setUndoId(null);
            return close(ok);
          })
        }
      />
    </>
  );
}

const RECEIVE_TEXT: Record<ReceiveMode, { title: string; confirm: string; amountLabel: string; hint: string }> = {
  total: { title: "Receber", confirm: "Confirmar recebimento", amountLabel: "Valor recebido (R$)", hint: "Padrão = valor em aberto. Valor diferente ajusta o valor do título (desconto ou juros)." },
  parcial: { title: "Receber parcialmente", confirm: "Registrar recebimento parcial", amountLabel: "Valor recebido agora (R$)", hint: "Até o valor em aberto; o título continua com saldo (fecha sozinho se cobrir o restante)." },
  residuo: { title: "Receber com resíduo", confirm: "Receber e criar resíduo", amountLabel: "Valor recebido agora (R$)", hint: "Menor que o em aberto: o título fica recebido por este total e o restante vira um novo título “— Resíduo”." },
};

function ReceiveDialog({ r, mode, accounts, pending, onClose, onSubmit }: { r: ReceivableDetail; mode: ReceiveMode; accounts: Opt[]; pending: boolean; onClose: () => void; onSubmit: (mode: ReceiveMode, v: { paidAt: string; method: string; accountId: string; amount?: number; receiptUrl?: string; notes?: string; reason?: string }) => Promise<boolean> }) {
  const id = React.useId();
  const text = RECEIVE_TEXT[mode];
  const open = r.open ?? 0;
  const paid = r.paid ?? 0;
  const [accountId, setAccountId] = React.useState(() => (r.accountId && accounts.some((a) => a.value === r.accountId) ? r.accountId : accounts.length === 1 ? accounts[0].value : ""));
  const [paidAt, setPaidAt] = React.useState(today());
  const [method, setMethod] = React.useState<string>("pix");
  // Valor com máscara em centavos (etapa CP/CR 4): null = vazio.
  const [amount, setAmount] = React.useState<number | null>(mode === "total" ? open : null);
  const [receiptUrl, setReceiptUrl] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [reason, setReason] = React.useState("");
  const value = amount ?? 0;
  const changed = mode === "total" && amount !== null && cents(value) !== cents(open);
  const residual = mode === "residuo" && value > 0 && cents(value) < cents(open) ? (cents(open) - cents(value)) / 100 : null;
  const amountOk = value > 0 && (mode !== "parcial" || cents(value) <= cents(open)) && (mode !== "residuo" || residual !== null);
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>
            {text.title} {r.code}
          </DialogTitle>
          <DialogDescription>
            {money(r.amount)} de {r.payerName}
            {paid > 0 ? ` · já recebido ${formatCurrency(paid)} · em aberto ${formatCurrency(open)}` : ""}.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <FormField label="Data do recebimento" htmlFor={`${id}-d`} required>
            <Input id={`${id}-d`} type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </FormField>
          <FormField label={text.amountLabel} htmlFor={`${id}-v`} required hint={text.hint}>
            <MoneyInput id={`${id}-v`} value={amount} onValueChange={setAmount} />
          </FormField>
          {residual !== null ? (
            <p className="rounded-md border border-info/35 bg-info-soft px-3 py-2 text-sm text-info-fg" data-testid="residual-preview">
              O título fica recebido por {formatCurrency((cents(paid) + cents(value)) / 100)} e nasce “{residualDescription(r.description)}” de {formatCurrency(residual)}, mesmo vencimento.
            </p>
          ) : null}
          {changed || mode === "residuo" ? (
            <FormField label={mode === "residuo" ? "Motivo (opcional)" : "Motivo do ajuste (opcional)"} htmlFor={`${id}-why`} hint={mode === "residuo" ? undefined : value < open ? "Desconto: o valor do título passa a ser o total recebido" : "Juros/multa: o valor do título passa a ser o total recebido"}>
              <Input id={`${id}-why`} value={reason} onChange={(e) => setReason(e.target.value)} />
            </FormField>
          ) : null}
          {accounts.length > 0 ? (
            <FormField label="Conta financeira" htmlFor={`${id}-a`} required hint="Onde o dinheiro entrou: gera o lançamento de receita no extrato da conta" error={accountId ? undefined : "Escolha a conta"}>
              <Select id={`${id}-a`} value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="Selecione a conta" options={accounts} />
            </FormField>
          ) : (
            <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-fg" data-testid="receive-no-account">
              <Landmark className="mt-0.5 size-4 shrink-0" />
              <span>
                Nenhuma conta financeira cadastrada. Cadastre em{" "}
                <Link href="/financeiro/cadastros?aba=contas" className="font-medium text-brand-fg hover:underline">
                  Financeiro › Cadastros financeiros
                </Link>{" "}
                para registrar o recebimento.
              </span>
            </p>
          )}
          <FormField label="Forma de recebimento" htmlFor={`${id}-m`} required>
            <Select id={`${id}-m`} value={method} onChange={(e) => setMethod(e.target.value)} options={RECEIPT_METHODS.map((m) => ({ value: m, label: paymentMethodLabel(m) }))} />
          </FormField>
          <FormField label="Link do comprovante (opcional)" htmlFor={`${id}-r`}>
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
          <Button variant="success" onClick={() => onSubmit(mode, { paidAt, method, accountId, receiptUrl, notes, ...(mode === "total" ? (changed ? { amount: value } : {}) : { amount: value }), ...(reason.trim() ? { reason: reason.trim() } : {}) })} loading={pending} disabled={!paidAt || !amountOk}>
            <CircleDollarSign /> {text.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const FREE = "__livre__";

/** Campos do pagador e da classificação (compartilhados entre criar e alterar). */
function PayerAndClassification({
  id,
  f,
  set,
  options,
  cls,
  setCls,
}: {
  id: string;
  f: { clientId: string; payerName: string; categoryId: string; costCenterId: string; accountId: string };
  set: (k: "clientId" | "payerName" | "categoryId" | "costCenterId" | "accountId", v: string) => void;
  options: ReceivableOptions;
  /** Etapa CP/CR 4: Centro → Categoria → Subcategoria (quando há cadastros de receita). */
  cls?: ClassificationValue;
  setCls?: (v: ClassificationValue) => void;
}) {
  const registry = hasClassification(options.classification) ? options.classification! : null;
  return (
    <>
      <FormField label="Cliente" htmlFor={`${id}-cli`} required hint="Cliente cadastrado ou nome livre do pagador">
        <Select id={`${id}-cli`} value={f.clientId} onChange={(e) => set("clientId", e.target.value)} options={[{ value: FREE, label: "Outro (nome livre)" }, ...options.clients]} />
      </FormField>
      {f.clientId === FREE ? (
        <FormField label="Nome do pagador" htmlFor={`${id}-payer`} required>
          <Input id={`${id}-payer`} value={f.payerName} onChange={(e) => set("payerName", e.target.value)} />
        </FormField>
      ) : (
        <span className="hidden sm:block" aria-hidden />
      )}
      {registry && cls && setCls ? (
        <ClassificationFields id={id} options={registry} value={cls} onChange={setCls} />
      ) : (
        <>
          {cls ? <NoClassificationNotice kind="receita" className="sm:col-span-2" /> : null}
          <FormField label="Categoria (receita)" htmlFor={`${id}-cat`} hint={options.categories.length === 0 ? "Nenhuma categoria de receita em Cadastros financeiros" : "Só categorias de receita"}>
            <Select
              id={`${id}-cat`}
              value={f.categoryId}
              onChange={(e) => {
                set("categoryId", e.target.value);
                // Escolher a categoria preenche o centro (editável).
                set("costCenterId", options.categoryCenters[e.target.value] ?? "");
              }}
              placeholder="Sem categoria"
              options={options.categories}
            />
          </FormField>
          <FormField label="Centro de custo" htmlFor={`${id}-cc`} hint="Vazio = o da categoria">
            <Select id={`${id}-cc`} value={f.costCenterId} onChange={(e) => set("costCenterId", e.target.value)} placeholder="O da categoria" options={options.centers} />
          </FormField>
        </>
      )}
      <FormField label="Conta prevista" htmlFor={`${id}-acc`} hint="Pré-seleciona a conta no recebimento">
        <Select id={`${id}-acc`} value={f.accountId} onChange={(e) => set("accountId", e.target.value)} placeholder="Sem conta prevista" options={options.accounts} />
      </FormField>
    </>
  );
}

/** Classificação inicial a partir do `categoryId` gravado (separa categoria-mãe e subcategoria). */
function initialClassification(options: ReceivableOptions, categoryId?: string, costCenterId?: string): ClassificationValue {
  const registry = hasClassification(options.classification) ? options.classification! : null;
  if (!registry) return EMPTY_CLASSIFICATION;
  const split = splitCategoryOption(categoryId, registry);
  const known = registry.categories.some((c) => c.value === split.categoryId);
  return { ...(known ? split : { categoryId: "", subcategoryId: "" }), costCenterId: costCenterId && registry.centers.some((c) => c.value === costCenterId) ? costCenterId : "" };
}

function EditReceivableDialog({ r, options, values, pending, onClose, onSubmit }: { r: ReceivableDetail; options: ReceivableOptions; values: boolean; pending: boolean; onClose: () => void; onSubmit: (v: Record<string, unknown>) => Promise<boolean> }) {
  const id = React.useId();
  const [f, setF] = React.useState({
    description: r.description,
    amount: r.amount as number | null,
    dueDate: dateKey(r.dueDate),
    competence: r.competence,
    clientId: r.clientId ?? FREE,
    payerName: r.clientId ? "" : r.payerName,
    categoryId: r.categoryId ?? "",
    costCenterId: r.costCenterId ?? "",
    accountId: r.accountId ?? "",
    documentNumber: r.documentNumber ?? "",
    notes: r.notes ?? "",
    reason: "",
  });
  const set = (k: Exclude<keyof typeof f, "amount">, v: string) => setF((p) => ({ ...p, [k]: v }));
  const amountEditable = values && r.payments.length === 0 && !r.paid;
  // Etapa CP/CR 4: com cadastros de receita, Centro → Categoria → Subcategoria (separa o categoryId gravado).
  const registry = hasClassification(options.classification);
  const [cls, setCls] = React.useState<ClassificationValue>(() => {
    const start = initialClassification(options, r.categoryId, r.costCenterId);
    // Categoria gravada fora das opções (arquivada): mantém o id para não limpar sem querer.
    return r.categoryId && !start.categoryId ? { ...start, categoryId: r.categoryId } : start;
  });
  const submit = () =>
    onSubmit({
      description: f.description,
      ...(amountEditable && f.amount !== null ? { amount: f.amount } : {}),
      dueDate: f.dueDate,
      competence: f.competence,
      ...(f.clientId === FREE ? { payerName: f.payerName } : { clientId: f.clientId }),
      ...(registry ? { categoryId: titleCategoryId(cls) ?? "", costCenterId: cls.costCenterId } : { categoryId: f.categoryId, costCenterId: f.costCenterId }),
      accountId: f.accountId,
      documentNumber: f.documentNumber,
      notes: f.notes,
      reason: f.reason,
    });
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Alterar {r.code}</DialogTitle>
          <DialogDescription>Toda alteração guarda o valor anterior, o novo e o motivo. O valor só muda sem recebimentos registrados.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4 sm:grid-cols-2">
          <FormField label="Descrição" htmlFor={`${id}-desc`} className="sm:col-span-2">
            <Input id={`${id}-desc`} value={f.description} onChange={(e) => set("description", e.target.value)} />
          </FormField>
          <FormField label="Valor (R$)" htmlFor={`${id}-amount`} hint={amountEditable ? undefined : "Com recebimento registrado o valor muda pelas baixas"}>
            <MoneyInput id={`${id}-amount`} value={f.amount} onValueChange={(v) => setF((p) => ({ ...p, amount: v }))} disabled={!amountEditable} />
          </FormField>
          <FormField label="Vencimento" htmlFor={`${id}-due`}>
            <Input id={`${id}-due`} type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
          </FormField>
          <FormField label="Competência" htmlFor={`${id}-comp`}>
            <Input id={`${id}-comp`} type="month" value={f.competence} onChange={(e) => set("competence", e.target.value)} />
          </FormField>
          <FormField label="Nº do documento" htmlFor={`${id}-doc`}>
            <Input id={`${id}-doc`} value={f.documentNumber} onChange={(e) => set("documentNumber", e.target.value)} />
          </FormField>
          <PayerAndClassification id={id} f={f} set={set} options={options} cls={registry ? cls : undefined} setCls={setCls} />
          <FormField label="Observações" htmlFor={`${id}-notes`} className="sm:col-span-2">
            <Textarea id={`${id}-notes`} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
          </FormField>
          <FormField label="Motivo da alteração" htmlFor={`${id}-reason`} required className="sm:col-span-2" hint="Mínimo de 5 caracteres">
            <Textarea id={`${id}-reason`} value={f.reason} onChange={(e) => set("reason", e.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Voltar
          </Button>
          <Button onClick={submit} loading={pending} disabled={f.reason.trim().length < 5 || (f.clientId === FREE && f.payerName.trim().length < 2) || (amountEditable && !(f.amount && f.amount > 0))}>
            Salvar alteração
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AttachDialog({ code, pending, onClose, onSubmit }: { code: string; pending: boolean; onClose: () => void; onSubmit: (v: { name: string; url: string }) => Promise<boolean> }) {
  const id = React.useId();
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Anexar documento a {code}</DialogTitle>
          <DialogDescription>Link do documento (nota fiscal, recibo, contrato avulso). Entra nos documentos do sistema ligado a este título.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <FormField label="Nome" htmlFor={`${id}-n`} required>
            <Input id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: NF 1234 — Consultoria" />
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

/** Valores iniciais do formulário (clonar um título a receber). */
interface ReceivableFormInitial {
  description: string;
  amount: number | null;
  dueDate: string;
  competence?: string;
  clientId?: string;
  payerName?: string;
  categoryId?: string;
  costCenterId?: string;
  accountId?: string;
  notes?: string;
}

/** Clonar (etapa CP/CR 4): sem sufixo de parcela, sem recebimentos e sem o nº do documento (novo documento). */
function cloneInitial(r: ReceivableDetail): ReceivableFormInitial {
  return {
    description: stripInstallmentSuffix(r.description),
    amount: r.amount !== null && r.amount > 0 ? r.amount : null,
    dueDate: dateKey(r.dueDate),
    competence: r.competence,
    clientId: r.clientId,
    payerName: r.payerName,
    categoryId: r.categoryId,
    costCenterId: r.costCenterId,
    accountId: r.accountId,
    notes: r.notes,
  };
}

/**
 * "Novo título a receber" (etapas CP/CR 3 e 4): receita fora de contrato — Único / Fixo / Parcelado a cada N dias,
 * semanas ou meses (sobra de centavos na última parcela) com prévia ao vivo, valor com máscara em centavos, cliente
 * cadastrado ou nome livre, Centro → Categoria → Subcategoria de RECEITA, conta prevista, nº do documento, competência
 * (vazia = mês do vencimento), observações e anexo por link.
 */
export function NewReceivableButton({ options }: { options: ReceivableOptions }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button className="h-11 md:h-9" onClick={() => setOpen(true)}>
        <Plus /> Novo título a receber
      </Button>
      {open ? <ReceivableFormDialog options={options} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ReceivableFormDialog({ options, initial, cloneOf, onClose }: { options: ReceivableOptions; initial?: ReceivableFormInitial; cloneOf?: string; onClose: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const registry = hasClassification(options.classification);
  const [f, setF] = React.useState(() => ({
    description: initial?.description ?? "",
    dueDate: initial?.dueDate ?? today(),
    competence: initial?.competence ?? "",
    clientId: initial ? (initial.clientId && options.clients.some((c) => c.value === initial.clientId) ? initial.clientId : FREE) : (options.clients[0]?.value ?? FREE),
    payerName: initial && !(initial.clientId && options.clients.some((c) => c.value === initial.clientId)) ? (initial.payerName ?? "") : "",
    categoryId: initial?.categoryId && options.categories.some((c) => c.value === initial.categoryId) ? initial.categoryId : "",
    costCenterId: initial?.costCenterId && options.centers.some((c) => c.value === initial.costCenterId) ? initial.costCenterId : "",
    accountId: initial?.accountId && options.accounts.some((a) => a.value === initial.accountId) ? initial.accountId : "",
    documentNumber: "",
    notes: initial?.notes ?? "",
    attachmentUrl: "",
    attachmentName: "",
  }));
  const [amount, setAmount] = React.useState<number | null>(initial?.amount ?? null);
  const [mode, setMode] = React.useState<RepeatMode>("unico");
  const [repeatState, setRepeatState] = React.useState(DEFAULT_REPEAT);
  const [cls, setCls] = React.useState<ClassificationValue>(() => {
    const start = initialClassification(options, initial?.categoryId, initial?.costCenterId);
    // Clonar sem centro próprio: o centro vem da categoria (como ao escolher a categoria).
    if (!start.costCenterId && start.categoryId) start.costCenterId = options.classification?.categories.find((c) => c.value === start.categoryId)?.costCenterId ?? "";
    return start;
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const repeat = repeatInput(mode, repeatState);
  const plan = planOccurrences({ description: f.description || "x", amount: amount ?? 0, dueDate: f.dueDate, competence: f.competence || undefined, repeat });
  const n = plan.ok ? plan.value.length : 0;
  const valid = f.description.trim().length >= 3 && (amount ?? 0) > 0 && Boolean(f.dueDate) && (f.clientId !== FREE || f.payerName.trim().length >= 2) && plan.ok;
  const submit = async () => {
    const ok = await run(
      () =>
        createReceivableAction({
          description: f.description,
          amount: amount ?? 0,
          dueDate: f.dueDate,
          competence: f.competence || undefined,
          ...(f.clientId === FREE ? { payerName: f.payerName } : { clientId: f.clientId }),
          ...(registry ? { categoryId: titleCategoryId(cls), costCenterId: cls.costCenterId || undefined } : { categoryId: f.categoryId || undefined, costCenterId: f.costCenterId || undefined }),
          accountId: f.accountId || undefined,
          documentNumber: f.documentNumber || undefined,
          notes: f.notes || undefined,
          repeat,
          attachmentUrl: f.attachmentUrl || undefined,
          attachmentName: f.attachmentName || undefined,
        }),
      (d) => (d.parcels > 1 ? `${d.parcels} títulos a receber lançados (${d.code ?? ""} …)` : `Título a receber ${d.code ?? ""} lançado`),
    );
    if (ok) onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{cloneOf ? `Clonar ${cloneOf}` : "Novo título a receber"}</DialogTitle>
          <DialogDescription>
            {cloneOf ? "Novo título com os dados copiados (sem recebimentos, sem sufixo de parcela, repetição Único). Revise e lance." : "Receita fora de contrato (consultoria avulsa, reembolso, venda de equipamento…). Cobranças de contrato continuam nascendo do contrato."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4 sm:grid-cols-2">
          <FormField label="Descrição" htmlFor={`${id}-desc`} required className="sm:col-span-2">
            <Input id={`${id}-desc`} value={f.description} onChange={(e) => set("description", e.target.value)} />
          </FormField>
          <FormField label="Lançamento" htmlFor={`${id}-mode`} required>
            <Select id={`${id}-mode`} value={mode} onChange={(e) => setMode(e.target.value as RepeatMode)}>
              <option value="unico">Único</option>
              <option value="fixo">Fixo (mesmo valor repetido)</option>
              <option value="parcelado">Parcelado (total dividido)</option>
            </Select>
          </FormField>
          <FormField label={mode === "parcelado" ? "Valor total (R$)" : mode === "fixo" ? "Valor de cada título (R$)" : "Valor (R$)"} htmlFor={`${id}-valor`} required>
            <MoneyInput id={`${id}-valor`} value={amount} onValueChange={setAmount} />
          </FormField>
          <FormField label={mode === "parcelado" ? "Vencimento da 1ª parcela" : mode === "fixo" ? "Vencimento do 1º título" : "Vencimento"} htmlFor={`${id}-due`} required>
            <Input id={`${id}-due`} type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
          </FormField>
          <FormField label="Competência" htmlFor={`${id}-comp`} hint="Vazia = mês do vencimento">
            <Input id={`${id}-comp`} type="month" value={f.competence} onChange={(e) => set("competence", e.target.value)} />
          </FormField>
          <RepeatFields id={id} mode={mode} value={repeatState} onChange={setRepeatState} />
          <OccurrencePreview className="sm:col-span-2" description={f.description} amount={amount} dueDate={f.dueDate} competence={f.competence} repeat={repeat} verb="receba" />
          <PayerAndClassification id={id} f={f} set={set} options={options} cls={registry ? cls : EMPTY_CLASSIFICATION} setCls={registry ? setCls : undefined} />
          <FormField label="Nº do documento" htmlFor={`${id}-doc`} hint="Documento do cliente/NF (o código REC- é automático)">
            <Input id={`${id}-doc`} value={f.documentNumber} onChange={(e) => set("documentNumber", e.target.value)} maxLength={60} />
          </FormField>
          <FormField label="Anexo (link)" htmlFor={`${id}-att`} hint="Nota fiscal, recibo…">
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
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={!valid}>
            {n > 1 ? `Lançar ${n} títulos` : "Lançar título"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
