"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trophy } from "lucide-react";
import { SALE_PAYMENT_METHODS, type Opportunity, type SalePaymentMethod } from "@/domain/types";
import { DEFAULT_CLOSING, MAX_SETUP_INSTALLMENTS, SALE_PAYMENT_METHOD_LABELS, SALE_RECURRENCE_LABELS, closingPaymentConditionText, splitInstallments } from "@/domain/sale-closing";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { LoadingBlock } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { formatCurrency } from "@/lib/format";
import { getWonContextAction, markOpportunityWonAction } from "@/server/sales/actions";
import type { ProductOption, WonContext } from "@/server/sales/queries";
import { ProductsEditor, toEditableLines, toPayloadLines, type EditableLine } from "./products-editor";
import { netItem, productTotals } from "./model";

export interface WonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opportunity: Pick<Opportunity, "id" | "title" | "products" | "billingData">;
  /** Padrões de faturamento vindos do cadastro do cliente. */
  clientDefaults: { legalName?: string; document?: string; email?: string };
  products: ProductOption[];
  onWon?: () => void;
}

const NEW_CONTACT = "__novo__";
const RECURRENCES = ["mensal", "anual", "unico"] as const;

/** Hoje (AAAA-MM-DD) no fuso do navegador, para o mínimo do 1º vencimento. */
function todayValue(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * "Marcar como ganho": exige produtos com valores, dados de faturamento e as condições do fechamento (forma de
 * pagamento, vencimento, prazo, parcelas da adesão, contato responsável, implantação). Ao confirmar, o servidor
 * grava o número da venda (VEN) e emite opportunity.won → contrato criado com as condições herdadas, financeiro
 * acionado, jornada avança.
 */
export function WonDialog({ open, onOpenChange, opportunity, clientDefaults, products, onWon }: WonDialogProps) {
  const router = useRouter();
  const id = React.useId();
  const [lines, setLines] = React.useState<EditableLine[]>(() => toEditableLines(opportunity.products));
  const [legalName, setLegalName] = React.useState(opportunity.billingData?.legalName ?? clientDefaults.legalName ?? "");
  const [document, setDocument] = React.useState(opportunity.billingData?.document ?? clientDefaults.document ?? "");
  const [email, setEmail] = React.useState(opportunity.billingData?.email ?? clientDefaults.email ?? "");
  const [payment, setPayment] = React.useState(opportunity.billingData?.paymentCondition ?? "");
  const [pending, startTransition] = React.useTransition();

  // Condições do fechamento.
  const [context, setContext] = React.useState<WonContext | null>(null);
  const [contextError, setContextError] = React.useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = React.useState<SalePaymentMethod>(DEFAULT_CLOSING.paymentMethod);
  const [billingDay, setBillingDay] = React.useState(String(DEFAULT_CLOSING.billingDay));
  const [firstDueDate, setFirstDueDate] = React.useState("");
  const [termMonths, setTermMonths] = React.useState(String(DEFAULT_CLOSING.termMonths));
  const [recurrence, setRecurrence] = React.useState<(typeof RECURRENCES)[number]>(DEFAULT_CLOSING.recurrence);
  const [setupInstallments, setSetupInstallments] = React.useState(String(DEFAULT_CLOSING.setupInstallments));
  const [contactId, setContactId] = React.useState("");
  const [newContact, setNewContact] = React.useState({ name: "", email: "", phone: "" });
  const [implementationRequired, setImplementationRequired] = React.useState<boolean>(DEFAULT_CLOSING.implementationRequired);
  const [implementationNotes, setImplementationNotes] = React.useState("");
  const [commercialNotes, setCommercialNotes] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    getWonContextAction({ opportunityId: opportunity.id }).then((result) => {
      if (!alive) return;
      if (!result.ok) {
        setContextError(result.error);
        return;
      }
      setContext(result.data);
      // Contato principal pré-selecionado; sem contatos, cadastra na hora.
      setContactId(result.data.contacts[0]?.id ?? NEW_CONTACT);
      if (result.data.acceptedProposal?.conditions) setCommercialNotes((cur) => cur || result.data.acceptedProposal!.conditions!);
    });
    return () => {
      alive = false;
    };
  }, [open, opportunity.id]);

  const totals = productTotals(lines);
  const hasValue = lines.length > 0 && totals.setupTotal + totals.monthlyTotal + totals.hardwareTotal > 0;
  const docDigits = document.replace(/\D/g, "");
  const dayNum = Number(billingDay);
  const termNum = Number(termMonths);
  const installmentsNum = Number(setupInstallments);
  const creatingContact = contactId === NEW_CONTACT;
  const closingValid =
    context !== null &&
    Number.isInteger(dayNum) &&
    dayNum >= 1 &&
    dayNum <= 28 &&
    Number.isInteger(termNum) &&
    termNum >= 1 &&
    termNum <= 120 &&
    (!firstDueDate || firstDueDate >= todayValue()) &&
    (creatingContact ? newContact.name.trim().length >= 2 : Boolean(contactId));
  const complete = hasValue && closingValid && legalName.trim().length >= 3 && (docDigits.length === 11 || docDigits.length === 14) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  // O contrato usa os itens da proposta aceita (com desconto); sem ela, os produtos acima.
  const accepted = context?.acceptedProposal ?? null;
  const summaryItems = accepted
    ? accepted.items.map((i) => {
        const net = netItem(i);
        return { key: i.productId, name: i.productName, quantity: i.quantity, setup: net.setupTotal, monthly: net.monthlyTotal, hardware: net.hardwareTotal, discountPct: i.discountPct };
      })
    : lines.map((l) => ({ key: l.key, name: l.productName, quantity: l.quantity, setup: Number(l.setupValue) || 0, monthly: Number(l.monthlyValue) || 0, hardware: Number(l.hardwareValue) || 0, discountPct: 0 }));
  const summary = summaryItems.reduce((acc, i) => ({ setup: acc.setup + i.setup, monthly: acc.monthly + i.monthly, hardware: acc.hardware + i.hardware }), { setup: 0, monthly: 0, hardware: 0 });
  const parcels = summary.setup > 0 ? splitInstallments(summary.setup, installmentsNum) : [];
  const conditionPreview = closingValid
    ? closingPaymentConditionText({ paymentMethod, billingDay: dayNum, firstDueDate: firstDueDate || undefined, termMonths: termNum, recurrence, setupInstallments: installmentsNum }, { setupTotal: summary.setup, monthlyTotal: summary.monthly })
    : "";

  const submit = () => {
    startTransition(async () => {
      const result = await markOpportunityWonAction({
        opportunityId: opportunity.id,
        products: toPayloadLines(lines),
        billingData: { legalName, document: docDigits, email, paymentCondition: payment },
        closing: {
          paymentMethod,
          billingDay: dayNum,
          firstDueDate: firstDueDate || undefined,
          termMonths: termNum,
          recurrence,
          setupInstallments: installmentsNum,
          contactId: creatingContact ? undefined : contactId,
          newContact: creatingContact ? { name: newContact.name, email: newContact.email || undefined, phone: newContact.phone || undefined } : undefined,
          implementationRequired,
          implementationNotes: implementationNotes || undefined,
          commercialNotes: commercialNotes || undefined,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Negócio ganho! Contrato criado e financeiro acionado.");
      onOpenChange(false);
      onWon?.();
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="size-5 text-success" /> Marcar como ganho
          </DialogTitle>
          <DialogDescription>{opportunity.title}. Confira produtos, condições do fechamento e dados de faturamento: eles vão para o contrato e para o financeiro.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <section>
            <h4 className="mb-2 text-sm font-semibold">Produtos e valores</h4>
            <ProductsEditor lines={lines} onChange={setLines} products={products} />
            {!hasValue ? <p className="mt-2 text-xs text-danger">Inclua ao menos um produto com valor.</p> : null}
          </section>

          <section className="grid gap-3 sm:grid-cols-2" aria-labelledby={`${id}-closing`}>
            <h4 id={`${id}-closing`} className="text-sm font-semibold sm:col-span-2">
              Condições do fechamento
            </h4>
            {contextError ? (
              <p className="text-sm text-danger sm:col-span-2">{contextError}</p>
            ) : context === null ? (
              <LoadingBlock label="Carregando contatos e proposta…" className="sm:col-span-2" />
            ) : (
              <>
                <FormField label="Forma de pagamento" htmlFor={`${id}-pm`} required>
                  <Select id={`${id}-pm`} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as SalePaymentMethod)} options={SALE_PAYMENT_METHODS.map((m) => ({ value: m, label: SALE_PAYMENT_METHOD_LABELS[m] }))} />
                </FormField>
                <FormField label="Dia de vencimento" htmlFor={`${id}-day`} required error={billingDay && (dayNum < 1 || dayNum > 28 || !Number.isInteger(dayNum)) ? "Entre 1 e 28" : undefined}>
                  <Input id={`${id}-day`} type="number" inputMode="numeric" min={1} max={28} value={billingDay} onChange={(e) => setBillingDay(e.target.value)} />
                </FormField>
                <FormField label="1º vencimento (opcional)" htmlFor={`${id}-first`} hint="Vazio: o Financeiro usa o próximo dia de vencimento" error={firstDueDate && firstDueDate < todayValue() ? "Não pode estar no passado" : undefined}>
                  <DateInput id={`${id}-first`} min={todayValue()} value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} />
                </FormField>
                <FormField label="Prazo (meses)" htmlFor={`${id}-term`} required error={termMonths && (termNum < 1 || termNum > 120 || !Number.isInteger(termNum)) ? "Entre 1 e 120" : undefined}>
                  <Input id={`${id}-term`} type="number" inputMode="numeric" min={1} max={120} value={termMonths} onChange={(e) => setTermMonths(e.target.value)} />
                </FormField>
                <FormField label="Recorrência" htmlFor={`${id}-rec`} required>
                  <Select id={`${id}-rec`} value={recurrence} onChange={(e) => setRecurrence(e.target.value as (typeof RECURRENCES)[number])} options={RECURRENCES.map((r) => ({ value: r, label: SALE_RECURRENCE_LABELS[r] }))} />
                </FormField>
                <FormField label="Parcelas da adesão" htmlFor={`${id}-inst`} required>
                  <Select
                    id={`${id}-inst`}
                    value={setupInstallments}
                    onChange={(e) => setSetupInstallments(e.target.value)}
                    options={Array.from({ length: MAX_SETUP_INSTALLMENTS }, (_, i) => ({ value: String(i + 1), label: i === 0 ? "À vista (1x)" : `${i + 1}x` }))}
                  />
                </FormField>
                <FormField label="Contato responsável do cliente" htmlFor={`${id}-contact`} required className="sm:col-span-2" hint="Vira o signatário principal do contrato e o contato da implantação">
                  <Select
                    id={`${id}-contact`}
                    value={contactId}
                    onChange={(e) => setContactId(e.target.value)}
                    options={[
                      ...context.contacts.map((c) => ({ value: c.id, label: `${c.name}${c.role ? ` · ${c.role}` : ""}${c.isPrimary ? " (principal)" : ""}` })),
                      { value: NEW_CONTACT, label: "+ Cadastrar novo contato" },
                    ]}
                  />
                </FormField>
                {creatingContact ? (
                  <div className="grid gap-3 rounded-lg border border-border p-3 sm:col-span-2 sm:grid-cols-3">
                    <FormField label="Nome do contato" htmlFor={`${id}-nc-name`} required>
                      <Input id={`${id}-nc-name`} value={newContact.name} onChange={(e) => setNewContact((c) => ({ ...c, name: e.target.value }))} />
                    </FormField>
                    <FormField label="E-mail do contato" htmlFor={`${id}-nc-email`}>
                      <Input id={`${id}-nc-email`} type="email" value={newContact.email} onChange={(e) => setNewContact((c) => ({ ...c, email: e.target.value }))} />
                    </FormField>
                    <FormField label="Telefone do contato" htmlFor={`${id}-nc-phone`}>
                      <Input id={`${id}-nc-phone`} inputMode="tel" value={newContact.phone} onChange={(e) => setNewContact((c) => ({ ...c, phone: e.target.value }))} />
                    </FormField>
                  </div>
                ) : null}
                <Switch
                  label="Implantação necessária"
                  description={implementationRequired ? "O projeto de implantação é aberto na liberação financeira." : "Venda sem implantação: o projeto é aberto marcado como “implantação não contratada”."}
                  checked={implementationRequired}
                  onCheckedChange={setImplementationRequired}
                  className="w-full rounded-lg border border-border px-3 py-2 sm:col-span-2"
                />
                <FormField label="Observações para implantação" htmlFor={`${id}-impl`} className="sm:col-span-2">
                  <Textarea id={`${id}-impl`} value={implementationNotes} onChange={(e) => setImplementationNotes(e.target.value)} placeholder="Ex.: migrar cadastro de 2.000 produtos; treinamento no sábado" className="min-h-[64px]" />
                </FormField>
                <FormField label="Observações comerciais" htmlFor={`${id}-com`} className="sm:col-span-2">
                  <Textarea id={`${id}-com`} value={commercialNotes} onChange={(e) => setCommercialNotes(e.target.value)} placeholder="Ex.: desconto condicionado ao pagamento em dia" className="min-h-[64px]" />
                </FormField>
              </>
            )}
          </section>

          {context !== null ? (
            <section className="rounded-lg border border-border bg-surface-muted p-3 text-sm" aria-labelledby={`${id}-summary`}>
              <h4 id={`${id}-summary`} className="mb-1 font-semibold">
                O que será contratado
              </h4>
              <p className="mb-2 text-xs text-muted">{accepted ? `Itens da proposta aceita ${accepted.number}, líquidos de desconto (é o que vai para o contrato).` : "Sem proposta aceita: o contrato usa os produtos e valores acima."}</p>
              <ul className="flex flex-col gap-1">
                {summaryItems.map((i) => (
                  <li key={i.key} className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="min-w-0 break-words">
                      {i.quantity > 1 ? `${i.quantity}× ` : ""}
                      {i.name}
                      {i.discountPct > 0 ? <span className="text-xs text-muted"> · {i.discountPct}% desc.</span> : null}
                    </span>
                    <span className="tabular-nums text-muted">{[i.monthly > 0 ? `${formatCurrency(i.monthly)}/mês` : null, i.setup > 0 ? `adesão ${formatCurrency(i.setup)}` : null, i.hardware > 0 ? `hardware ${formatCurrency(i.hardware)}` : null].filter(Boolean).join(" · ") || "—"}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-2 tabular-nums sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted">Mensalidade</dt>
                  <dd className="font-semibold">{formatCurrency(summary.monthly)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Adesão</dt>
                  <dd className="font-semibold">{formatCurrency(summary.setup)}</dd>
                  {parcels.length > 1 ? <dd className="text-xs text-muted">{`${parcels.length}x de ${formatCurrency(parcels[0])}`}</dd> : null}
                </div>
                <div>
                  <dt className="text-xs text-muted">Hardware</dt>
                  <dd className="font-semibold">{formatCurrency(summary.hardware)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Prazo</dt>
                  <dd className="font-semibold">{Number.isInteger(termNum) && termNum > 0 ? `${termNum} meses` : "—"}</dd>
                </div>
              </dl>
              {conditionPreview ? <p className="mt-2 text-xs text-muted">Condição: {conditionPreview}</p> : null}
            </section>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-2">
            <h4 className="text-sm font-semibold sm:col-span-2">Dados de faturamento</h4>
            <FormField label="Razão social" htmlFor={`${id}-ln`} required className="sm:col-span-2">
              <Input id={`${id}-ln`} value={legalName} onChange={(e) => setLegalName(e.target.value)} />
            </FormField>
            <FormField label="CNPJ/CPF" htmlFor={`${id}-doc`} required error={document && docDigits.length !== 11 && docDigits.length !== 14 ? "CNPJ (14 dígitos) ou CPF (11)" : undefined}>
              <Input id={`${id}-doc`} inputMode="numeric" value={document} onChange={(e) => setDocument(e.target.value)} />
            </FormField>
            <FormField label="E-mail de faturamento" htmlFor={`${id}-em`} required>
              <Input id={`${id}-em`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
            <FormField label="Condição de pagamento" htmlFor={`${id}-pc`} className="sm:col-span-2" hint="Opcional: em branco, o texto é gerado a partir das condições do fechamento">
              <Input id={`${id}-pc`} value={payment} onChange={(e) => setPayment(e.target.value)} placeholder={conditionPreview || "Ex.: adesão à vista via PIX; mensalidade por boleto todo dia 10"} />
            </FormField>
          </section>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={!complete} className="bg-success-strong hover:bg-success-hover">
            <Trophy /> Confirmar ganho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
