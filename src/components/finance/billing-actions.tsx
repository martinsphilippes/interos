"use client";

import * as React from "react";
import { Ban, CircleDollarSign, FileText, Mail, MessageCircle, MoreHorizontal, Phone, Receipt, Send, Undo2 } from "lucide-react";
import type { Billing } from "@/domain/types";
import { cancelBillingAction, getBillingContactAction, registerBillingCallAction, registerBoletoAction, registerPaymentAction, reversePaymentAction, sendBillingMessageAction } from "@/server/finance/actions";
import type { BillingChannelResult, BillingContactInfo } from "@/server/finance/service";
import { BOLETO_FILTER_LABELS, boletoState, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type BoletoFilter } from "@/server/finance/schemas";
import { dateKey, formatCurrency, formatDate, formatPhone } from "@/lib/format";
import { BILLING_TYPE_LABELS } from "@/components/clients/labels";
import { mailtoHref } from "@/components/clients/contact-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { whatsappWithText } from "./contract-links";
import { useFinanceAction } from "./use-finance-action";

export type BillingLite = Pick<Billing, "id" | "type" | "installment" | "amount" | "dueDate" | "status"> & Partial<Pick<Billing, "boleto" | "pix" | "paymentUrl" | "externalId" | "provider" | "chargeStatus" | "paidAt" | "paidAmount">> & { clientName?: string };

export function billingLabel(b: Pick<Billing, "type" | "installment">): string {
  return `${BILLING_TYPE_LABELS[b.type]}${b.installment ? ` ${b.installment}` : ""}`;
}

const BOLETO_VARIANT: Record<BoletoFilter, "muted" | "info" | "success"> = { sem_boleto: "muted", emitido: "info", pago: "success" };

/** Badge "Sem boleto · Boleto emitido · Boleto pago" (D20). */
export function BoletoBadge({ billing, size = "sm" }: { billing: Pick<Billing, "status"> & Partial<Pick<Billing, "boleto" | "pix" | "paymentUrl" | "externalId">>; size?: "sm" | "md" }) {
  const state = boletoState(billing);
  return (
    <Badge variant={BOLETO_VARIANT[state]} size={size} title={billing.boleto?.linhaDigitavel ? `Linha digitável ${billing.boleto.linhaDigitavel}` : undefined}>
      {BOLETO_FILTER_LABELS[state]}
    </Badge>
  );
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

/** Registrar boleto emitido no banco/ERP (linha digitável, nosso número, PDF, PIX) — controle sem provedor. */
export function BoletoDialog({ billing, open, onOpenChange }: { billing: BillingLite; open: boolean; onOpenChange: (open: boolean) => void }) {
  const id = React.useId();
  const [form, setForm] = React.useState(() => ({
    linhaDigitavel: billing.boleto?.linhaDigitavel ?? "",
    nossoNumero: billing.boleto?.nossoNumero ?? "",
    codigoBarras: billing.boleto?.codigoBarras ?? "",
    banco: billing.boleto?.banco ?? "",
    emitidoEm: dateKey(new Date()),
    pdfUrl: billing.boleto?.pdfUrl ?? "",
    pixCopiaECola: billing.pix?.copiaECola ?? "",
    paymentUrl: billing.paymentUrl ?? "",
  }));
  const { pending, run } = useFinanceAction();
  const valid = Boolean(form.linhaDigitavel.trim() || form.nossoNumero.trim() || form.pdfUrl.trim() || form.pixCopiaECola.trim() || form.paymentUrl.trim());
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async () => {
    const ok = await run(() => registerBoletoAction({ billingId: billing.id, ...form }), (d) => (d.hasPdf ? "Boleto registrado (PDF anexado aos documentos)" : "Boleto registrado na cobrança"));
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Registrar boleto</DialogTitle>
          <DialogDescription>
            {billingLabel(billing)} de {formatCurrency(billing.amount)} · vencimento {formatDate(billing.dueDate)}
            {billing.clientName ? ` · ${billing.clientName}` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-muted">
            Provedor de cobrança não conectado: o boleto é emitido no banco ou ERP e registrado aqui para envio, 2ª via e controle. Informe pelo menos a linha digitável, o nosso número, o PDF, o PIX ou o link de pagamento.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Linha digitável" htmlFor={`${id}-ld`} className="sm:col-span-2">
              <Input id={`${id}-ld`} inputMode="numeric" value={form.linhaDigitavel} onChange={set("linhaDigitavel")} placeholder="00000.00000 00000.000000 00000.000000 0 00000000000000" className="h-11 md:h-9" />
            </FormField>
            <FormField label="Nosso número" htmlFor={`${id}-nn`}>
              <Input id={`${id}-nn`} value={form.nossoNumero} onChange={set("nossoNumero")} className="h-11 md:h-9" />
            </FormField>
            <FormField label="Banco" htmlFor={`${id}-bk`}>
              <Input id={`${id}-bk`} value={form.banco} onChange={set("banco")} placeholder="Ex.: Sicoob, Itaú" className="h-11 md:h-9" />
            </FormField>
            <FormField label="Código de barras" htmlFor={`${id}-cb`}>
              <Input id={`${id}-cb`} inputMode="numeric" value={form.codigoBarras} onChange={set("codigoBarras")} className="h-11 md:h-9" />
            </FormField>
            <FormField label="Emitido em" htmlFor={`${id}-em`}>
              <DateInput id={`${id}-em`} value={form.emitidoEm} onChange={set("emitidoEm")} className="h-11 md:h-9" />
            </FormField>
            <FormField label="PDF do boleto (link)" htmlFor={`${id}-pdf`} hint="Vira documento “Boleto” do cliente" className="sm:col-span-2">
              <Input id={`${id}-pdf`} type="url" placeholder="https://" value={form.pdfUrl} onChange={set("pdfUrl")} className="h-11 md:h-9" />
            </FormField>
            <FormField label="PIX copia e cola" htmlFor={`${id}-pix`} className="sm:col-span-2">
              <Textarea id={`${id}-pix`} value={form.pixCopiaECola} onChange={set("pixCopiaECola")} rows={2} />
            </FormField>
            <FormField label="Link de pagamento" htmlFor={`${id}-pu`} hint="Opcional (página de pagamento do banco/ERP)" className="sm:col-span-2">
              <Input id={`${id}-pu`} type="url" placeholder="https://" value={form.paymentUrl} onChange={set("paymentUrl")} className="h-11 md:h-9" />
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending} className="h-11 md:h-9">
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={!valid} className="h-11 md:h-9">
            <Receipt /> Registrar boleto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Mode = "pagar" | "cancelar" | "whatsapp" | "email" | "ligar" | "boleto" | "enviar_boleto" | "segunda_via" | "estornar" | null;
type MessageMode = "whatsapp" | "email" | "enviar_boleto" | "segunda_via";
type ChannelChoice = "whatsapp" | "email" | "ambos";

const MESSAGE_TITLES: Record<MessageMode, string> = { whatsapp: "Cobrança por WhatsApp", email: "Cobrança por e-mail (complementar)", enviar_boleto: "Enviar boleto", segunda_via: "2ª via do boleto" };

function describeResults(results: BillingChannelResult[]): string {
  return results
    .map((r) => {
      const via = r.channel === "whatsapp" ? "WhatsApp" : "E-mail";
      if (r.delivery === "enviada") return `${via} enviado`;
      if (r.delivery === "manual") return `${via} registrado (envio manual)`;
      if (r.delivery === "falha") return `${via}: falha no envio (registrada)`;
      return `${via} não enviado (${r.error ?? "opt-out"})`;
    })
    .join(" · ");
}

/**
 * Menu de ações de uma cobrança: pagamento, cobrança por WhatsApp (principal) e e-mail (complementar), ligação,
 * boleto (registrar, enviar, 2ª via), cancelamento e, para cobrança paga, estorno do pagamento.
 * Canais consultam o estado real das integrações: sem WhatsApp/e-mail conectado o botão abre o wa.me/mailto com o
 * texto pronto e registra "enviado manualmente"; sem VoIP, o tel: abre o discador e o resultado é registrado à mão.
 * Sem provedor de cobrança, o boleto é emitido no banco/ERP e registrado aqui — nunca simulado.
 */
export function BillingActions({ billing, compact }: { billing: BillingLite; compact?: boolean }) {
  const id = React.useId();
  const [mode, setMode] = React.useState<Mode>(null);
  const [text, setText] = React.useState("");
  const [channel, setChannel] = React.useState<ChannelChoice>("whatsapp");
  const [contact, setContact] = React.useState<BillingContactInfo | null>(null);
  const [loadingContact, setLoadingContact] = React.useState(false);
  const { pending, run } = useFinanceAction();
  const open = billing.status === "aberta" || billing.status === "vencida";
  const paid = billing.status === "paga";
  const hasBoleto = boletoState(billing) !== "sem_boleto";
  if (!open && !paid) return null;

  const isMessage = (m: Mode): m is MessageMode => m === "whatsapp" || m === "email" || m === "enviar_boleto" || m === "segunda_via";
  const includeBoleto = mode === "enviar_boleto" || mode === "segunda_via";

  const openMode = async (m: Mode) => {
    setText("");
    setMode(m);
    if (isMessage(m) || m === "ligar") {
      setChannel(m === "email" ? "email" : "whatsapp");
      setLoadingContact(true);
      const result = await getBillingContactAction({ billingId: billing.id });
      setLoadingContact(false);
      if (!result.ok) {
        toast.error(result.error);
        setMode(null);
        return;
      }
      setContact(result.data);
      if (m === "whatsapp" || m === "email") setText(result.data.message);
      if (m === "enviar_boleto" || m === "segunda_via") setText(m === "segunda_via" ? result.data.messageWithBoleto.replace("Segue o boleto", "Segue a 2ª via do boleto") : result.data.messageWithBoleto);
    }
  };

  const close = () => setMode(null);

  const cancel = async () => {
    if (await run(() => cancelBillingAction({ billingId: billing.id, reason: text }), "Cobrança cancelada")) close();
  };
  const registerCall = async () => {
    if (await run(() => registerBillingCallAction({ billingId: billing.id, notes: text }), "Ligação registrada")) close();
  };
  const reverse = async () => {
    if (await run(() => reversePaymentAction({ billingId: billing.id, reason: text }), (d) => `Pagamento estornado: cobrança volta a ${d.status === "vencida" ? "vencida" : "em aberto"}`)) close();
  };
  const send = async (ch: ChannelChoice) => {
    const ok = await run(
      () => sendBillingMessageAction({ billingId: billing.id, channel: ch, text, includeBoleto, secondCopy: mode === "segunda_via" }),
      (d) => describeResults(d.results),
    );
    if (ok) close();
  };

  const subject = contact?.emailSubject ?? "Cobrança — Intercert";
  const waLink = contact?.whatsappUrl ? whatsappWithText(contact.whatsappUrl, text) : null;
  const mailLink = contact?.email ? mailtoHref([contact.email], includeBoleto ? subject.replace("Cobrança", "Boleto") : subject, text) : null;

  /** Botão de envio de um canal: ação direta quando conectado; link wa.me/mailto que também registra quando manual. */
  const channelButton = (ch: "whatsapp" | "email") => {
    if (!contact) return null;
    const connected = ch === "whatsapp" ? contact.whatsappConnected : contact.emailConnected;
    const optOut = ch === "whatsapp" ? contact.optOut.whatsapp : contact.optOut.email;
    const to = ch === "whatsapp" ? contact.phone : contact.email;
    const Icon = ch === "whatsapp" ? MessageCircle : Mail;
    const label = ch === "whatsapp" ? "WhatsApp" : "e-mail";
    if (optOut)
      return (
        <Button key={ch} disabled className="h-11 md:h-9">
          <Icon /> Cliente sem {label} (opt-out)
        </Button>
      );
    if (!to)
      return (
        <Button key={ch} disabled className="h-11 md:h-9">
          <Icon /> Sem {ch === "whatsapp" ? "telefone" : "e-mail"}
        </Button>
      );
    if (connected)
      return (
        <Button key={ch} onClick={() => send(ch)} loading={pending} disabled={loadingContact || !text.trim()} className="h-11 md:h-9">
          <Icon /> Enviar por {label}
        </Button>
      );
    const href = ch === "whatsapp" ? waLink : mailLink;
    return (
      <Button key={ch} asChild className="h-11 md:h-9">
        <a href={href ?? "#"} target={ch === "whatsapp" ? "_blank" : undefined} rel="noreferrer" onClick={() => void send(ch)} aria-disabled={pending || !text.trim()}>
          <Icon /> Abrir {ch === "whatsapp" ? "WhatsApp" : "e-mail"} e registrar
        </a>
      </Button>
    );
  };

  const dialogTitle = mode === "ligar" ? "Ligação de cobrança" : mode === "cancelar" ? "Cancelar cobrança" : mode === "estornar" ? "Estornar pagamento" : isMessage(mode) ? MESSAGE_TITLES[mode] : "";
  const textLabel = mode === "ligar" ? "Resultado da ligação" : mode === "cancelar" || mode === "estornar" ? "Motivo" : "Mensagem";
  const placeholder = mode === "ligar" ? "Ex.: cliente prometeu pagar até sexta" : mode === "cancelar" ? "Ex.: cobrança duplicada" : mode === "estornar" ? "Ex.: pagamento identificado no cliente errado" : "Mensagem com valor, vencimento e oferta de 2ª via/PIX";
  const textDialogOpen = mode !== null && mode !== "pagar" && mode !== "boleto";

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        {!compact && open ? (
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
            {open ? (
              <>
                <DropdownMenuItem onSelect={() => openMode("pagar")}>
                  <CircleDollarSign /> Registrar pagamento
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openMode("whatsapp")}>
                  <MessageCircle /> Cobrar por WhatsApp
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openMode("email")}>
                  <Mail /> Cobrar por e-mail (complementar)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openMode("ligar")}>
                  <Phone /> Ligar
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => openMode("boleto")}>
                  <Receipt /> {hasBoleto ? "Atualizar boleto" : "Registrar boleto"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openMode("enviar_boleto")} disabled={!hasBoleto}>
                  <Send /> Enviar boleto{hasBoleto ? "" : " (registre antes)"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openMode("segunda_via")} disabled={!hasBoleto}>
                  <FileText /> 2ª via do boleto
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => openMode("cancelar")}>
                  <Ban /> Cancelar cobrança
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem destructive onSelect={() => openMode("estornar")}>
                <Undo2 /> Estornar pagamento
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {mode === "pagar" ? <PaymentDialog billing={billing} open onOpenChange={(o) => !o && close()} /> : null}
      {mode === "boleto" ? <BoletoDialog billing={billing} open onOpenChange={(o) => !o && close()} /> : null}

      <Dialog open={textDialogOpen} onOpenChange={(o) => !pending && !o && close()}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>
              {billingLabel(billing)} de {formatCurrency(billing.amount)} · vencimento {formatDate(billing.dueDate)}
              {billing.clientName ? ` · ${billing.clientName}` : ""}
              {paid && billing.paidAt ? ` · pago em ${formatDate(billing.paidAt)}${billing.paidAmount !== undefined ? ` (${formatCurrency(billing.paidAmount)})` : ""}` : ""}
              {contact && (isMessage(mode) || mode === "ligar") ? ` · ${contact.contactName}${contact.phone ? ` ${formatPhone(contact.phone)}` : ""}${contact.email && isMessage(mode) ? ` · ${contact.email}` : ""}` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            {isMessage(mode) || mode === "ligar" ? (
              loadingContact ? (
                <p className="text-sm text-muted">Carregando contato…</p>
              ) : contact ? (
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-muted">
                  {mode === "ligar" ? (
                    <p>{contact.voipConnected ? "Telefonia conectada." : "Telefonia não conectada · registro manual: ligue pelo discador e registre o resultado (sem gravação)."}</p>
                  ) : (
                    <>
                      <p>WhatsApp (principal): {contact.optOut.whatsapp ? "cliente optou por não receber." : contact.whatsappConnected ? "conectado — a mensagem é enviada pela API da Meta." : "não conectado · envio manual: o botão abre o WhatsApp com o texto pronto e a cobrança fica registrada como enviada manualmente."}</p>
                      <p>E-mail (complementar): {contact.optOut.email ? "cliente optou por não receber." : contact.emailConnected ? "conectado — enviado pelo INTEROS." : "não conectado · envio manual: o botão abre o seu e-mail com assunto e texto prontos e registra o envio."}</p>
                      {contact.emailWithWhatsapp && channel === "whatsapp" ? <p>Configuração de canais: ao cobrar por WhatsApp, o e-mail complementar vai junto.</p> : null}
                      {includeBoleto ? <p>Boleto registrado: {contact.boletoSummary ?? "—"}</p> : null}
                    </>
                  )}
                </div>
              ) : null
            ) : null}
            {mode === "estornar" ? (
              <p className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning-fg">
                A cobrança volta a “em aberto” ou “vencida” (pela data de vencimento) e o pagamento fica guardado no histórico. Comissões elegíveis desta cobrança com título ainda não pago voltam a “aguardando recebimento” (título cancelado); comissão já paga não é alterada — o gestor financeiro é avisado. Contrato já liberado não regride.
              </p>
            ) : null}
            {isMessage(mode) && contact ? (
              <FormField label="Canal" htmlFor={`${id}-c`}>
                <Select id={`${id}-c`} value={channel} onChange={(e) => setChannel(e.target.value as ChannelChoice)} options={[{ value: "whatsapp", label: "WhatsApp (principal)" }, { value: "email", label: "E-mail (complementar)" }, { value: "ambos", label: "WhatsApp + e-mail" }]} />
              </FormField>
            ) : null}
            <FormField label={textLabel} htmlFor={`${id}-t`} required={mode === "cancelar" || mode === "estornar"}>
              <Textarea id={`${id}-t`} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} rows={isMessage(mode) ? (includeBoleto ? 7 : 5) : 3} />
            </FormField>
            {mode === "ligar" && contact?.telUrl ? (
              <Button asChild variant="outline" className="h-11 md:h-9">
                <a href={contact.telUrl}>
                  <Phone /> Ligar para {formatPhone(contact.phone)}
                </a>
              </Button>
            ) : null}
            {mode === "ligar" && contact && !contact.phone ? <p className="text-xs text-danger-fg">Cliente sem telefone cadastrado.</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={pending} className="h-11 md:h-9">
              Voltar
            </Button>
            {mode === "cancelar" ? (
              <Button variant="destructive" onClick={cancel} loading={pending} disabled={text.trim().length < 3} className="h-11 md:h-9">
                Cancelar cobrança
              </Button>
            ) : mode === "estornar" ? (
              <Button variant="destructive" onClick={reverse} loading={pending} disabled={text.trim().length < 5} className="h-11 md:h-9">
                <Undo2 /> Estornar pagamento
              </Button>
            ) : mode === "ligar" ? (
              <Button onClick={registerCall} loading={pending} disabled={loadingContact} className="h-11 md:h-9">
                Registrar ligação
              </Button>
            ) : isMessage(mode) && contact ? (
              channel === "ambos" ? (
                contact.whatsappConnected && contact.emailConnected && !contact.optOut.whatsapp && !contact.optOut.email ? (
                  <Button onClick={() => send("ambos")} loading={pending} disabled={loadingContact || !text.trim()} className="h-11 md:h-9">
                    <Send /> Enviar por WhatsApp e e-mail
                  </Button>
                ) : (
                  <>
                    {channelButton("whatsapp")}
                    {channelButton("email")}
                  </>
                )
              ) : (
                channelButton(channel)
              )
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
