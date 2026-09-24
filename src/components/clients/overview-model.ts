/**
 * Regras de apresentação da Visão geral do Cliente 360º (puras, sem servidor): gestor da conta,
 * pendências, próximos vencimentos e datas de renovação. Recebem o `Client360` já carregado.
 */
import type { Client360, UserSummary } from "@/server/clients/queries";
import type { Client, ClientProduct } from "@/domain/types";
import { dateKey } from "@/lib/format";
import { CONTRACT_STATUS_LABELS } from "./labels";

// ---------------------------------------------------------------------------
// Gestor da conta
// ---------------------------------------------------------------------------

export interface AccountManager {
  id?: string;
  user?: UserSummary;
  /** Área que responde pela conta no estágio atual ("Comercial", "Implantação", "Customer Success"). */
  area: string;
}

/**
 * Regra: enquanto o cliente não fechou (lead/prospect) a conta é do vendedor; durante a implantação,
 * do responsável de implantação; depois de ativo (e também inativo/cancelado), do CS. Sem o dono
 * do estágio, cai para o próximo disponível (CS → vendas; implantação → vendas).
 */
export function accountManager(client: Client, users: Record<string, UserSummary>): AccountManager {
  const pick = (id: string | undefined, area: string): AccountManager | null => (id ? { id, user: users[id], area } : null);
  switch (client.status) {
    case "lead":
    case "prospect":
      return pick(client.ownerSalesId, "Comercial") ?? { area: "Comercial" };
    case "em_implantacao":
      return pick(client.ownerImplementationId, "Implantação") ?? pick(client.ownerSalesId, "Comercial") ?? { area: "Implantação" };
    default:
      return pick(client.ownerCsId, "Customer Success") ?? pick(client.ownerSalesId, "Comercial") ?? { area: "Customer Success" };
  }
}

// ---------------------------------------------------------------------------
// Renovação dos produtos
// ---------------------------------------------------------------------------

/** Data de renovação de um produto: renovação aberta do contrato, ou fim de vigência do contrato. */
export function productRenewalDate(product: ClientProduct, data: Pick<Client360, "contracts" | "renewals">): string | undefined {
  if (!product.contractId) return undefined;
  const renewal = data.renewals.find((r) => r.contractId === product.contractId && (r.status === "aguardando" || r.status === "em_negociacao"));
  if (renewal) return renewal.dueDate;
  return data.contracts.find((c) => c.id === product.contractId)?.endDate;
}

// ---------------------------------------------------------------------------
// Pendências
// ---------------------------------------------------------------------------

export type PendencyTone = "danger" | "warning" | "info";

export interface Pendency {
  id: string;
  kind: "contrato" | "cobranca" | "etapa" | "implantacao";
  title: string;
  detail: string;
  tone: PendencyTone;
  href: string;
  /** Data de referência (vencimento, desde quando) para ordenar. */
  since?: string;
}

const OPEN_STEP = new Set(["pendente", "em_andamento", "aguardando_cliente", "aguardando_aprovacao"]);

/** Contratos aguardando assinatura/pagamento, cobranças vencidas, etapas paradas e implantação aguardando o cliente. */
export function buildPendencies(data: Client360): Pendency[] {
  const out: Pendency[] = [];
  const clientHref = `/clientes/${data.client.id}`;

  for (const c of data.contracts) {
    if (c.status === "liberado" || c.status === "cancelado") continue;
    const tone: PendencyTone = c.status === "pendencia" ? "danger" : "warning";
    const pendingSigners = c.signers.filter((s) => s.status === "pendente").length;
    const detail =
      c.status === "aguardando_assinatura" && pendingSigners > 0
        ? `${pendingSigners} assinatura${pendingSigners === 1 ? "" : "s"} pendente${pendingSigners === 1 ? "" : "s"}`
        : c.status === "pendencia" && c.pendingReason
          ? c.pendingReason
          : c.status === "pago"
            ? "Pago · aguardando liberação para a implantação"
            : CONTRACT_STATUS_LABELS[c.status];
    out.push({ id: `contrato:${c.id}`, kind: "contrato", title: `Contrato ${c.number}`, detail, tone, href: `/financeiro/contratos/${c.id}`, since: c.updatedAt });
  }

  const overdue = data.billing.filter((b) => b.status === "vencida");
  if (overdue.length > 0) {
    const total = overdue.reduce((s, b) => s + b.amount, 0);
    const oldest = [...overdue].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    out.push({
      id: "cobrancas-vencidas",
      kind: "cobranca",
      title: `${overdue.length} cobrança${overdue.length === 1 ? "" : "s"} vencida${overdue.length === 1 ? "" : "s"}`,
      detail: `${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(total)} em atraso`,
      tone: "danger",
      href: `${clientHref}?aba=financeiro`,
      since: oldest.dueDate,
    });
  }

  for (const s of data.workflow.steps) {
    if (!OPEN_STEP.has(s.status)) continue;
    const sla = data.slaByEntity[s.id];
    let detail: string | null = null;
    let tone: PendencyTone = "warning";
    if (s.status === "aguardando_cliente") detail = s.waitingClient?.reason ? `Aguardando cliente: ${s.waitingClient.reason}` : "Aguardando cliente";
    else if (s.status === "aguardando_aprovacao") detail = "Aguardando aprovação";
    if (sla?.state === "violado") {
      detail = detail ? `${detail} · SLA violado` : "SLA violado";
      tone = "danger";
    } else if (sla?.state === "em_risco" && !detail) detail = "SLA em risco";
    if (!detail) continue;
    out.push({ id: `etapa:${s.id}`, kind: "etapa", title: `Etapa ${s.stageName}`, detail, tone, href: `/workflow?etapa=${s.id}`, since: s.startedAt });
  }

  for (const p of data.projects) {
    if (p.status !== "aguardando_cliente" && p.status !== "bloqueada") continue;
    const detail = p.status === "bloqueada" ? `Bloqueada${p.blocked?.reason ? `: ${p.blocked.reason}` : ""}` : `Aguardando cliente${p.waitingClient?.reason ? `: ${p.waitingClient.reason}` : ""}`;
    out.push({ id: `implantacao:${p.id}`, kind: "implantacao", title: p.name, detail, tone: p.status === "bloqueada" ? "danger" : "warning", href: `/implantacao/${p.id}`, since: p.waitingClient?.since ?? p.blocked?.since });
  }

  const rank: Record<PendencyTone, number> = { danger: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone] || (a.since ?? "").localeCompare(b.since ?? ""));
}

// ---------------------------------------------------------------------------
// Próximos vencimentos
// ---------------------------------------------------------------------------

export interface UpcomingItem {
  id: string;
  kind: "cobranca" | "contrato" | "renovacao";
  title: string;
  detail?: string;
  /** ISO ou AAAA-MM-DD. */
  date: string;
  amount?: number;
  href: string;
}

const BILLING_LABEL = { setup: "Adesão", mensalidade: "Mensalidade", hardware: "Hardware", servico: "Serviço" } as const;

/** Cobranças em aberto a vencer, fim de vigência de contratos e renovações abertas, do mais próximo ao mais distante. */
export function buildUpcoming(data: Client360, now: Date = new Date()): UpcomingItem[] {
  const today = dateKey(now);
  const clientHref = `/clientes/${data.client.id}`;
  const out: UpcomingItem[] = [];
  for (const b of data.billing) {
    if (b.status !== "aberta" || dateKey(b.dueDate) < today) continue;
    out.push({ id: `cobranca:${b.id}`, kind: "cobranca", title: `${BILLING_LABEL[b.type]}${b.installment ? ` · parcela ${b.installment}` : ""}`, detail: `Competência ${b.competence}`, date: b.dueDate, amount: b.amount, href: `${clientHref}?aba=financeiro` });
  }
  const renewalContracts = new Set<string>();
  for (const r of data.renewals) {
    if (r.status !== "aguardando" && r.status !== "em_negociacao") continue;
    renewalContracts.add(r.contractId);
    const contract = data.contracts.find((c) => c.id === r.contractId);
    out.push({ id: `renovacao:${r.id}`, kind: "renovacao", title: `Renovação${contract ? ` do contrato ${contract.number}` : ""}`, detail: r.status === "em_negociacao" ? "Em negociação" : "Aguardando", date: r.dueDate, amount: contract?.monthlyTotal, href: "/cs/renovacoes" });
  }
  for (const c of data.contracts) {
    if (!c.endDate || c.status === "cancelado" || renewalContracts.has(c.id) || dateKey(c.endDate) < today) continue;
    out.push({ id: `contrato:${c.id}`, kind: "contrato", title: `Fim de vigência · ${c.number}`, detail: `${c.termMonths} meses`, date: c.endDate, amount: c.monthlyTotal, href: `/financeiro/contratos/${c.id}` });
  }
  return out.sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)));
}
