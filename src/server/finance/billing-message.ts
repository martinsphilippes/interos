import "server-only";
/**
 * Texto e destinatário das mensagens de cobrança (ação manual "Cobrar por WhatsApp/e-mail", "Enviar boleto",
 * 2ª via e régua de cobrança). Fonte única para que a tela, o serviço e a varredura montem a mesma mensagem.
 *
 * Destinatário (D23): contato responsável do contrato (`contract.contactId`) → e-mail de cobrança da venda
 * (`opportunity.billingData.email`, só para e-mail) → contato principal → cadastro do cliente.
 * Variáveis dos textos da régua: {cliente} {contato} {valor} {vencimento} {parcela} {linhaDigitavel} {linkBoleto}
 * {linkPortal} — `{linkPortal}` (etapa 6B, D31) vira "Portal do cliente: <link>" com um link NOVO do portal (30 dias)
 * gerado no envio (`sendBillingMessage`); sem envio possível ou sem link, fica vazio.
 */
import { getById, list } from "@/server/db";
import { formatCurrency, formatDate } from "@/lib/format";
import { COLLECTIONS, type Billing, type Client, type Contact, type Contract, type Opportunity } from "@/domain/types";
import { portalLinkLine } from "@/domain/portal";

export const BILLING_TYPE_LABEL: Record<Billing["type"], string> = { setup: "Adesão", mensalidade: "Mensalidade", hardware: "Hardware", servico: "Serviço" };

export function billingLabel(b: Pick<Billing, "type" | "installment">): string {
  return `${BILLING_TYPE_LABEL[b.type]}${b.installment ? ` ${b.installment}` : ""}`;
}

export interface BillingMessageContext {
  billing: Billing;
  contract: Contract;
  client: Client;
  /** Contato responsável do contrato (quando cadastrado). */
  contact?: Contact;
  /** Contato principal do cliente. */
  primary?: Contact;
  opportunity: Opportunity | null;
  /** Quem recebe a mensagem (nome exibido). */
  contactName: string;
  /** Telefone para WhatsApp/ligação e e-mail de cobrança, já resolvidos pela ordem de preferência. */
  phone?: string;
  email?: string;
}

export async function loadBillingMessageContext(billingId: string): Promise<BillingMessageContext> {
  const billing = await getById<Billing>(COLLECTIONS.billing, billingId);
  if (!billing) throw new Error("Cobrança não encontrada");
  const [contract, client, contacts] = await Promise.all([
    getById<Contract>(COLLECTIONS.contracts, billing.contractId),
    getById<Client>(COLLECTIONS.clients, billing.clientId),
    list<Contact>(COLLECTIONS.contacts, { where: [["clientId", "==", billing.clientId]] }),
  ]);
  if (!contract) throw new Error("Contrato da cobrança não encontrado");
  if (!client) throw new Error("Cliente da cobrança não encontrado");
  const opportunity = contract.opportunityId ? await getById<Opportunity>(COLLECTIONS.opportunities, contract.opportunityId) : null;
  return buildBillingMessageContext({ billing, contract, client, contacts, opportunity });
}

/** Versão pura (a varredura da régua já tem tudo carregado). */
export function buildBillingMessageContext(input: { billing: Billing; contract: Contract; client: Client; contacts: Contact[]; opportunity: Opportunity | null }): BillingMessageContext {
  const { billing, contract, client, contacts, opportunity } = input;
  const contact = contract.contactId ? contacts.find((c) => c.id === contract.contactId) : undefined;
  const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
  const who = contact ?? primary;
  return {
    billing,
    contract,
    client,
    contact,
    primary,
    opportunity,
    contactName: who?.name ?? client.tradeName,
    phone: contact?.whatsapp ?? contact?.phone ?? primary?.whatsapp ?? primary?.phone ?? client.whatsapp ?? client.phone,
    email: contact?.email ?? opportunity?.billingData?.email ?? primary?.email ?? client.email,
  };
}

/** Linhas com os dados do boleto/PIX registrados (vazio quando não há boleto). */
export function boletoLines(b: Pick<Billing, "boleto" | "pix" | "paymentUrl">): string[] {
  const lines: string[] = [];
  if (b.boleto?.linhaDigitavel) lines.push(`Linha digitável: ${b.boleto.linhaDigitavel}`);
  if (b.boleto?.pdfUrl) lines.push(`Boleto (PDF): ${b.boleto.pdfUrl}`);
  else if (b.paymentUrl) lines.push(`Link de pagamento: ${b.paymentUrl}`);
  if (b.pix?.copiaECola) lines.push(`PIX copia e cola: ${b.pix.copiaECola}`);
  return lines;
}

export function hasBoletoData(b: Pick<Billing, "boleto" | "pix" | "paymentUrl">): boolean {
  return boletoLines(b).length > 0;
}

/** Texto padrão da cobrança manual (o mesmo de antes; com `includeBoleto` acrescenta os dados registrados). */
export function defaultBillingMessage(ctx: Pick<BillingMessageContext, "billing" | "contactName" | "client">, options: { includeBoleto?: boolean; secondCopy?: boolean } = {}): string {
  const { billing } = ctx;
  const first = ctx.contactName !== ctx.client.tradeName ? `, ${ctx.contactName.split(" ")[0]}` : "";
  const lines = boletoLines(billing);
  if (options.includeBoleto && lines.length > 0) {
    return [
      `Olá${first}! ${options.secondCopy ? "Segue a 2ª via do boleto" : "Segue o boleto"} da Intercert: ${billingLabel(billing).toLowerCase()} de ${formatCurrency(billing.amount)} com vencimento em ${formatDate(billing.dueDate)}.`,
      ...lines,
      "Qualquer dúvida, é só responder esta mensagem.",
    ].join("\n");
  }
  return `Olá${first}! Lembrete da Intercert: ${billingLabel(billing).toLowerCase()} de ${formatCurrency(billing.amount)} com vencimento em ${formatDate(billing.dueDate)}. Precisa da 2ª via do boleto ou da chave PIX?`;
}

/** Assunto do e-mail de cobrança. */
export function billingEmailSubject(ctx: Pick<BillingMessageContext, "billing" | "contract">, options: { includeBoleto?: boolean } = {}): string {
  return `${options.includeBoleto ? "Boleto" : "Cobrança"} ${billingLabel(ctx.billing)} · vencimento ${formatDate(ctx.billing.dueDate)} · contrato ${ctx.contract.number} — Intercert`;
}

export { fillPortalLink, portalLinkLine } from "@/domain/portal";

/**
 * Substitui as variáveis do texto de um marco da régua. Placeholder desconhecido fica vazio. `{linkPortal}`: sem
 * `options.linkPortal` o marcador é PRESERVADO para `sendBillingMessage` gerar o link no envio (um link novo por
 * mensagem); com `linkPortal: ""` (tarefa/notificação interna) some; com uma URL vira "Portal do cliente: <url>".
 */
export function renderBillingTemplate(template: string, ctx: Pick<BillingMessageContext, "billing" | "client" | "contactName">, options: { linkPortal?: string } = {}): string {
  const b = ctx.billing;
  const vars: Record<string, string> = {
    cliente: ctx.client.tradeName,
    contato: ctx.contactName.split(" ")[0] ?? ctx.contactName,
    valor: formatCurrency(b.amount),
    vencimento: formatDate(b.dueDate),
    parcela: billingLabel(b).toLowerCase(),
    linhaDigitavel: b.boleto?.linhaDigitavel ? `Linha digitável: ${b.boleto.linhaDigitavel}\n` : "",
    linkBoleto: b.boleto?.pdfUrl ? `Boleto: ${b.boleto.pdfUrl}\n` : b.paymentUrl ? `Link de pagamento: ${b.paymentUrl}\n` : "",
    // Portal do cliente (D31): preservado para o envio gerar o link, ou resolvido aqui quando informado.
    linkPortal: options.linkPortal === undefined ? "{linkPortal}" : portalLinkLine(options.linkPortal),
  };
  return template
    .replace(/\{(\w+)\}/g, (_m, key: string) => vars[key] ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}
