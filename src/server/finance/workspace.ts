import "server-only";
/**
 * Leituras da tela de Contratos (tabela + painel lateral, padrão 02 das referências): KPIs com variação
 * sobre o fim do mês anterior, linhas da gestão de contratos, fluxo financeiro dos contratos listados e o
 * painel do contrato selecionado (assinatura, comunicação, histórico e linha do tempo a partir dos eventos).
 */
import { getManyByIds, list } from "@/server/db";
import { dateKey } from "@/lib/format";
import { COLLECTIONS, type Billing, type Client, type Communication, type Contact, type Contract, type ContractSignerEntry, type DomainEvent, type Opportunity, type User } from "@/domain/types";
import { communicationStatusLabel } from "@/server/integrations/communications";
import { getIntegrationFlags } from "@/server/integrations/status";
import type { IntegrationFlags } from "@/server/integrations/types";
import { telHref, whatsappHref } from "@/components/clients/contact-links";
import { allSigned, listBillingsSwept, todayKey } from "./billing";
import { listContracts, type ContractFilters } from "./queries";
import { CONTRACT_QUEUE_GROUPS } from "./schemas";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type BillingState = "pago" | "em_aberto" | "vencido" | "sem_cobranca";

export interface WorkspaceRow {
  id: string;
  number: string;
  version: number;
  status: Contract["status"];
  clientId: string;
  clientName: string;
  productName: string;
  extraProducts: number;
  /** Mensalidade; sem recorrência, o valor único (adesão + hardware). */
  amount: number;
  amountKind: "mensal" | "unico";
  /** Próximo vencimento em aberto/vencido; sem cobrança, o 1º vencimento previsto. */
  nextDueDate?: string;
  billingDay: number;
  signersSigned: number;
  signersTotal: number;
  documentGenerated: boolean;
  billingState: BillingState;
  pendingReason?: string;
  ownerName?: string;
  whatsappUrl: string | null;
  telUrl: string | null;
}

export interface KpiValue {
  value: number;
  /** Valor no fim do mês anterior (null quando não há base para comparar). */
  previous: number | null;
}

export interface WorkspaceKpis {
  mrr: KpiValue;
  receivable: KpiValue;
  overdue: KpiValue & { count: number };
  activeContracts: KpiValue;
  awaitingSignature: KpiValue;
}

export interface FinanceFlow {
  received: number;
  open: number;
  overdue: number;
  total: number;
  billings: number;
}

export interface PanelInteraction {
  id: string;
  channel: Communication["channel"];
  direction: Communication["direction"];
  body?: string;
  at: string;
  statusLabel: string;
  manual: boolean;
  userName?: string;
  durationSeconds?: number;
}

export interface Milestone {
  key: "criado" | "enviado" | "visualizado" | "assinado" | "cobranca" | "pagamento";
  label: string;
  done: boolean;
  at?: string;
  by?: string;
  /** Complemento exibido quando o marco foi cumprido. */
  detail?: string;
  /** Explicação exibida enquanto o marco está pendente. */
  pendingHint?: string;
}

export interface ContractPanel {
  id: string;
  number: string;
  version: number;
  status: Contract["status"];
  clientId: string;
  clientName: string;
  clientLegalName: string;
  amount: number;
  amountKind: "mensal" | "unico";
  setupTotal: number;
  hardwareTotal: number;
  nextDueDate?: string;
  billingDay: number;
  signers: ContractSignerEntry[];
  signatureProvider?: string;
  documentId?: string;
  documentHash?: string;
  documentGenerated: boolean;
  /** Itens/condições/signatários ainda podem mudar (gera ou regera o documento). */
  editable: boolean;
  itemsCount: number;
  phone?: string;
  whatsappUrl: string | null;
  telUrl: string | null;
  lastWhatsapp?: PanelInteraction;
  lastCall?: PanelInteraction;
  interactions: PanelInteraction[];
  milestones: Milestone[];
  pendingReason?: string;
}

export interface ContractsWorkspace {
  rows: WorkspaceRow[];
  total: number;
  facets: { clients: { value: string; label: string }[]; owners: { value: string; label: string }[] };
  kpis: WorkspaceKpis;
  flow: FinanceFlow;
  selected: ContractPanel | null;
  integrations: IntegrationFlags;
  /** Vendas ganhas sem contrato e clientes, para o diálogo "Novo contrato". */
  newContract: { opportunities: { id: string; label: string }[]; clients: { value: string; label: string }[] };
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

/** Último instante do mês anterior (ISO). */
function previousMonthEnd(): string {
  const [y, m] = todayKey().slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 0, 23, 59, 59)).toISOString();
}

const netMonthly = (i: Contract["items"][number]) => i.monthlyValue * i.quantity * (1 - (i.discountPct ?? 0) / 100);

function mainProduct(contract: Contract): { name: string; extra: number } {
  if (contract.items.length === 0) return { name: "—", extra: 0 };
  const top = [...contract.items].sort((a, b) => netMonthly(b) - netMonthly(a) || b.setupValue - a.setupValue)[0];
  return { name: top.productName, extra: contract.items.length - 1 };
}

function billingState(billings: Billing[]): BillingState {
  const active = billings.filter((b) => b.status !== "cancelada");
  if (active.length === 0) return "sem_cobranca";
  if (active.some((b) => b.status === "vencida")) return "vencido";
  if (active.some((b) => b.status === "aberta")) return "em_aberto";
  return "pago";
}

function nextDue(contract: Contract, billings: Billing[]): string | undefined {
  const pending = billings.filter((b) => b.status === "aberta" || b.status === "vencida").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return pending[0]?.dueDate ?? (billings.length === 0 ? contract.firstDueDate : undefined);
}

function contactPhone(client: Client | undefined, contacts: Contact[]): { whatsapp?: string; phone?: string } {
  const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
  return { whatsapp: primary?.whatsapp ?? primary?.phone ?? client?.whatsapp ?? client?.phone, phone: primary?.phone ?? primary?.whatsapp ?? client?.phone ?? client?.whatsapp };
}

// ---------------------------------------------------------------------------
// Consulta principal
// ---------------------------------------------------------------------------

export async function getContractsWorkspace(filters: ContractFilters, selectedId?: string): Promise<ContractsWorkspace> {
  const [queue, contracts, billings, sentEvents, contacts, wonOpps] = await Promise.all([
    listContracts(filters),
    list<Contract>(COLLECTIONS.contracts),
    listBillingsSwept(),
    list<DomainEvent>(COLLECTIONS.events, { where: [["type", "==", "contract.sent_for_signature"]] }),
    list<Contact>(COLLECTIONS.contacts, { where: [["isPrimary", "==", true]] }),
    list<Opportunity>(COLLECTIONS.opportunities, { where: [["stage", "==", "ganho"]] }),
  ]);
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const billingsByContract = new Map<string, Billing[]>();
  for (const b of billings) billingsByContract.set(b.contractId, [...(billingsByContract.get(b.contractId) ?? []), b]);
  const clientIds = Array.from(new Set(contracts.map((c) => c.clientId)));
  const clients = await getManyByIds<Client>(COLLECTIONS.clients, clientIds);
  const contactsByClient = new Map<string, Contact[]>();
  for (const c of contacts) contactsByClient.set(c.clientId, [...(contactsByClient.get(c.clientId) ?? []), c]);

  const rows: WorkspaceRow[] = queue.rows.map((r) => {
    const contract = byId.get(r.id)!;
    const cb = billingsByContract.get(r.id) ?? [];
    const product = mainProduct(contract);
    const phones = contactPhone(clients.get(r.clientId), contactsByClient.get(r.clientId) ?? []);
    const recurring = contract.monthlyTotal > 0 && contract.recurrence !== "unico";
    return {
      id: r.id,
      number: r.number,
      version: r.version,
      status: r.status,
      clientId: r.clientId,
      clientName: r.clientName,
      productName: product.name,
      extraProducts: product.extra,
      amount: recurring ? contract.monthlyTotal : contract.setupTotal + contract.hardwareTotal,
      amountKind: recurring ? "mensal" : "unico",
      nextDueDate: nextDue(contract, cb),
      billingDay: contract.billingDay,
      signersSigned: r.signersSigned,
      signersTotal: r.signersTotal,
      documentGenerated: Boolean(contract.signatureEnvelopeId),
      billingState: billingState(cb),
      pendingReason: r.pendingReason,
      ownerName: r.ownerName,
      whatsappUrl: whatsappHref(phones.whatsapp),
      telUrl: telHref(phones.phone),
    };
  });

  // Fluxo financeiro das cobranças dos contratos listados.
  const listed = new Set(rows.map((r) => r.id));
  const flowBillings = billings.filter((b) => listed.has(b.contractId) && b.status !== "cancelada");
  const received = flowBillings.filter((b) => b.status === "paga").reduce((s, b) => s + (b.paidAmount ?? b.amount), 0);
  const open = flowBillings.filter((b) => b.status === "aberta").reduce((s, b) => s + b.amount, 0);
  const overdueFlow = flowBillings.filter((b) => b.status === "vencida").reduce((s, b) => s + b.amount, 0);

  const selectedContract = selectedId ? byId.get(selectedId) : rows[0] ? byId.get(rows[0].id) : undefined;
  const withContract = new Set(contracts.filter((c) => c.status !== "cancelado" && c.opportunityId).map((c) => c.opportunityId));
  const orphans = wonOpps.filter((o) => !withContract.has(o.id));
  const allClients = await list<Client>(COLLECTIONS.clients);
  const clientName = new Map(allClients.map((c) => [c.id, c.tradeName]));

  return {
    rows,
    total: queue.total,
    facets: queue.facets,
    kpis: computeKpis(contracts, billings, sentEvents),
    flow: { received, open, overdue: overdueFlow, total: received + open + overdueFlow, billings: flowBillings.length },
    selected: selectedContract ? await buildPanel(selectedContract, clients.get(selectedContract.clientId), billingsByContract.get(selectedContract.id) ?? []) : null,
    integrations: getIntegrationFlags(),
    newContract: {
      opportunities: orphans
        .sort((a, b) => (b.wonAt ?? "").localeCompare(a.wonAt ?? ""))
        .map((o) => ({ id: o.id, label: `${clientName.get(o.clientId) ?? o.clientId} — ${o.title}` })),
      clients: allClients
        .filter((c) => c.status !== "lead" && c.status !== "cancelado")
        .map((c) => ({ value: c.id, label: c.tradeName }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    },
  };
}

// ---------------------------------------------------------------------------
// KPIs com variação vs. fim do mês anterior
// ---------------------------------------------------------------------------

function computeKpis(contracts: Contract[], billings: Billing[], sentEvents: DomainEvent[]): WorkspaceKpis {
  const prevEnd = previousMonthEnd();
  const prevDay = dateKey(prevEnd);
  const released = contracts.filter((c) => c.status === "liberado");
  // Cancelado depois de liberado: a última atualização aproxima a data da saída.
  const activeAt = (c: Contract) => Boolean(c.releasedAt && c.releasedAt <= prevEnd) && !(c.status === "cancelado" && c.updatedAt <= prevEnd);
  const activePrev = contracts.filter(activeAt);

  const active = billings.filter((b) => b.status !== "cancelada");
  const unpaidAt = (b: Billing) => b.createdAt <= prevEnd && !(b.status === "paga" && b.paidAt && b.paidAt <= prevEnd);
  const receivableNow = active.filter((b) => b.status === "aberta" || b.status === "vencida");
  const receivablePrev = active.filter(unpaidAt);
  const overdueNow = active.filter((b) => b.status === "vencida");
  const overduePrev = receivablePrev.filter((b) => dateKey(b.dueDate) < prevDay);

  const firstSent = new Map<string, string>();
  for (const e of sentEvents) if (e.entityId && (!firstSent.has(e.entityId) || e.occurredAt < firstSent.get(e.entityId)!)) firstSent.set(e.entityId, e.occurredAt);
  const awaitingNow = contracts.filter((c) => (CONTRACT_QUEUE_GROUPS.assinatura as readonly string[]).includes(c.status) || (c.status === "pendencia" && Boolean(c.signatureEnvelopeId) && !allSigned(c)));
  const awaitingPrev = contracts.filter((c) => {
    const sent = firstSent.get(c.id);
    return Boolean(sent && sent <= prevEnd) && !(c.signedAt && c.signedAt <= prevEnd) && !(c.releasedAt && c.releasedAt <= prevEnd) && !(c.status === "cancelado" && c.updatedAt <= prevEnd);
  });

  const sum = (items: Billing[]) => items.reduce((s, b) => s + b.amount, 0);
  const hasHistory = contracts.some((c) => c.createdAt <= prevEnd) || billings.some((b) => b.createdAt <= prevEnd);
  const prev = (v: number) => (hasHistory ? v : null);
  return {
    mrr: { value: released.reduce((s, c) => s + c.monthlyTotal, 0), previous: prev(activePrev.reduce((s, c) => s + c.monthlyTotal, 0)) },
    receivable: { value: sum(receivableNow), previous: prev(sum(receivablePrev)) },
    overdue: { value: sum(overdueNow), previous: prev(sum(overduePrev)), count: overdueNow.length },
    activeContracts: { value: released.length, previous: prev(activePrev.length) },
    awaitingSignature: { value: awaitingNow.length, previous: prev(awaitingPrev.length) },
  };
}

// ---------------------------------------------------------------------------
// Painel do contrato selecionado
// ---------------------------------------------------------------------------

async function buildPanel(contract: Contract, client: Client | undefined, billings: Billing[]): Promise<ContractPanel> {
  const [contacts, comms, contractEvents, billingEvents] = await Promise.all([
    list<Contact>(COLLECTIONS.contacts, { where: [["clientId", "==", contract.clientId]] }),
    list<Communication>(COLLECTIONS.communications, { where: [["clientId", "==", contract.clientId]] }),
    list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "==", contract.id]] }),
    billings.length > 0 ? list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "in", billings.map((b) => b.id)]] }) : Promise.resolve([] as DomainEvent[]),
  ]);
  const users = await getManyByIds<User>(COLLECTIONS.users, comms.map((c) => c.userId ?? ""));
  const phones = contactPhone(client, contacts);

  const interactions: PanelInteraction[] = comms
    .filter((c) => c.channel !== "interno")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((c) => ({
      id: c.id,
      channel: c.channel,
      direction: c.direction,
      body: c.body,
      at: c.createdAt,
      statusLabel: communicationStatusLabel(c.status),
      manual: (c.status as string) === "manual" || c.status === "simulada",
      userName: c.userId ? users.get(c.userId)?.name : undefined,
      durationSeconds: c.durationSeconds,
    }));

  const events = [...contractEvents, ...billingEvents].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const first = (type: DomainEvent["type"]) => events.find((e) => e.type === type);
  const last = (type: DomainEvent["type"]) => [...events].reverse().find((e) => e.type === type);
  const created = first("contract.created");
  const sent = last("contract.sent_for_signature");
  const signed = last("contract.signed");
  const billed = first("billing.created");
  const paid = first("payment.approved");
  const signedCount = contract.signers.filter((s) => s.status === "assinado").length;
  const manualDoc = contract.signatureProvider === "manual" || (typeof sent?.payload.method === "string" && sent.payload.method === "manual");

  const milestones: Milestone[] = [
    { key: "criado", label: "Contrato criado", done: true, at: created?.occurredAt ?? contract.createdAt, by: created?.actorName, detail: created ? undefined : "Registro anterior ao histórico de eventos" },
    {
      key: "enviado",
      label: manualDoc ? "Documento gerado para assinatura" : "Enviado para assinatura",
      done: Boolean(contract.signatureEnvelopeId) || contract.status === "liberado",
      at: sent?.occurredAt,
      by: sent?.actorName,
      detail: contract.signatureEnvelopeId ? (manualDoc ? "Envio manual ao cliente" : undefined) : undefined,
      pendingHint: "Gere o documento do contrato",
    },
    { key: "visualizado", label: "Documento visualizado pelo cliente", done: false, pendingHint: "Disponível com provedor de assinatura conectado" },
    {
      key: "assinado",
      label: "Contrato assinado",
      done: Boolean(contract.signatureEnvelopeId) && allSigned(contract),
      at: signed?.occurredAt ?? contract.signedAt,
      by: signed?.actorName,
      detail: contract.signers.length > 0 ? `${signedCount} de ${contract.signers.length} assinatura(s)` : undefined,
      pendingHint: contract.signers.length > 0 ? `${signedCount} de ${contract.signers.length} assinatura(s)` : "Sem signatários",
    },
    { key: "cobranca", label: "Cobrança gerada", done: billings.some((b) => b.status !== "cancelada"), at: billed?.occurredAt, by: billed?.actorName, detail: billed?.description },
    { key: "pagamento", label: "Pagamento registrado", done: billings.some((b) => b.status === "paga"), at: paid?.occurredAt, by: paid?.actorName, detail: paid?.title },
  ];

  const recurring = contract.monthlyTotal > 0 && contract.recurrence !== "unico";
  const signedByAll = Boolean(contract.signatureEnvelopeId) && allSigned(contract);
  return {
    id: contract.id,
    number: contract.number,
    version: contract.version,
    status: contract.status,
    clientId: contract.clientId,
    clientName: client?.tradeName ?? contract.clientId,
    clientLegalName: client?.legalName ?? "",
    amount: recurring ? contract.monthlyTotal : contract.setupTotal + contract.hardwareTotal,
    amountKind: recurring ? "mensal" : "unico",
    setupTotal: contract.setupTotal,
    hardwareTotal: contract.hardwareTotal,
    nextDueDate: nextDue(contract, billings),
    billingDay: contract.billingDay,
    signers: contract.signers,
    signatureProvider: contract.signatureProvider,
    documentId: contract.signatureEnvelopeId,
    documentHash: contract.documentHash,
    documentGenerated: Boolean(contract.signatureEnvelopeId),
    editable: contract.status !== "liberado" && contract.status !== "cancelado" && !signedByAll,
    itemsCount: contract.items.length,
    phone: phones.whatsapp ?? phones.phone,
    whatsappUrl: whatsappHref(phones.whatsapp),
    telUrl: telHref(phones.phone),
    lastWhatsapp: interactions.find((i) => i.channel === "whatsapp"),
    lastCall: interactions.find((i) => i.channel === "voip"),
    interactions: interactions.slice(0, 6),
    milestones,
    pendingReason: contract.pendingReason,
  };
}
