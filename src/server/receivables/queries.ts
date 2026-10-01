import "server-only";
/**
 * Leituras dos títulos a receber AVULSOS (etapa CP/CR 3) para a aba "Títulos avulsos" de /financeiro/contas-a-receber:
 * lista simples (vencimento, descrição, cliente/pagador, categoria, valor, em aberto, status calculado), resumo da aba,
 * painel do título (baixas, anexos, histórico) e as opções dos formulários (clientes, categorias de RECEITA, centros,
 * contas). Os totais do aging/Contas a Receber existentes NÃO incluem os avulsos (decisão pendente do dono).
 */
import { list } from "@/server/db";
import { dateKey } from "@/lib/format";
import { resolveEffectiveCostCenter } from "@/domain/finance-registry";
import { receivableSettlement, type SettlementStatus } from "@/domain/settlements";
import { COLLECTIONS, type Client, type CostCenter, type DomainEvent, type FinanceCategory, type FinancialAccount, type Receivable, type ReceivableStatus, type CurrentUser } from "@/domain/types";
import { listPaymentAccountOptions } from "@/server/finance-registry/cash-entries";
import { paymentMethodLabel } from "@/server/finance/schemas";
import { receivableCapabilities, receivablesVisible, type ReceivableCapabilities } from "./access";
import { listReceivableAttachments } from "./service";

type Opt = { value: string; label: string };
type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export const RECEIVABLE_SITUATIONS: { value: SettlementStatus; label: string }[] = [
  { value: "em_aberto", label: "Em aberto" },
  { value: "parcial", label: "Parcial" },
  { value: "vencido", label: "Vencido" },
  { value: "pago", label: "Recebido" },
  { value: "cancelado", label: "Cancelado" },
];

export interface ReceivableFilters {
  situacao?: SettlementStatus;
  cliente?: string;
}

export function parseReceivableFilters(sp: SearchParams): ReceivableFilters {
  const situacao = first(sp.situacao);
  return {
    situacao: RECEIVABLE_SITUATIONS.find((s) => s.value === situacao)?.value,
    cliente: first(sp.cliente),
  };
}

export interface ReceivableRow {
  id: string;
  code: string;
  description: string;
  dueDate: string;
  competence: string;
  payerName: string;
  clientId?: string;
  categoryName?: string;
  /** Quantias: null sem "Visualizar valores" (Restrito). */
  amount: number | null;
  paid: number | null;
  open: number | null;
  status: ReceivableStatus;
  settlement: SettlementStatus;
  installment?: number;
  installments?: number;
}

export interface ReceivableDetail extends ReceivableRow {
  documentNumber?: string;
  notes?: string;
  costCenter: { name: string; inherited: boolean };
  accountId?: string;
  accountName?: string;
  categoryId?: string;
  costCenterId?: string;
  cancelReason?: string;
  paidAt?: string;
  originalAmount?: number;
  residual?: { id: string; code: string };
  residualOf?: { id: string; code: string };
  payments: { id: string; date: string; amount: number; accountName: string; method: string; byName?: string }[];
  attachments: { id: string; name: string; url: string; createdAt: string }[];
  history: { id: string; at: string; title: string; subtitle?: string; by?: string; tone: "neutral" | "success" | "warning" | "danger" | "info" | "brand" }[];
  siblings: { id: string; code: string; dueDate: string; amount: number | null; settlement: SettlementStatus }[];
}

export interface ReceivablesWorkspace {
  rows: ReceivableRow[];
  total: number;
  summary: { open: number | null; overdue: number | null; receivedMonth: number | null; openCount: number; overdueCount: number };
  selected: ReceivableDetail | null;
  can: ReceivableCapabilities;
  options: { clients: Opt[]; categories: Opt[]; centers: Opt[]; accounts: Opt[]; categoryCenters: Record<string, string> };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Aba "Títulos avulsos": só para quem vê a seção no escopo empresa (senão, nada é lido). */
export async function getReceivablesWorkspace(user: CurrentUser, filters: ReceivableFilters, selectedId?: string): Promise<ReceivablesWorkspace | null> {
  if (!(await receivablesVisible(user))) return null;
  const can = receivableCapabilities(user);
  const hide = !can.values;
  const today = dateKey(new Date());
  const month = today.slice(0, 7);
  const [all, categories, centers, accounts] = await Promise.all([
    list<Receivable>(COLLECTIONS.receivables),
    list<FinanceCategory>(COLLECTIONS.financeCategories),
    list<CostCenter>(COLLECTIONS.costCenters),
    list<FinancialAccount>(COLLECTIONS.financialAccounts),
  ]);
  const categoryById = new Map(categories.map((c) => [c.id, { ...c, parentId: c.parentId ?? null }]));
  const categoryName = (id?: string) => {
    if (!id) return undefined;
    const c = categoryById.get(id);
    if (!c) return undefined;
    const parent = c.parentId ? categoryById.get(c.parentId) : undefined;
    return parent ? `${parent.name} › ${c.name}` : c.name;
  };
  const money = (v: number) => (hide ? null : v);
  const toRow = (r: Receivable): ReceivableRow => {
    const s = receivableSettlement(r, today);
    return {
      id: r.id,
      code: r.code ?? r.id,
      description: r.description,
      dueDate: r.dueDate,
      competence: r.competence,
      payerName: r.payerName,
      clientId: r.clientId,
      categoryName: categoryName(r.categoryId),
      amount: money(r.amount),
      paid: money(s.paid),
      open: money(s.open),
      status: r.status,
      settlement: s.status,
      installment: r.installment,
      installments: r.installments,
    };
  };
  const rowsAll = all.map(toRow);
  // Ordem: em aberto/parcial/vencido primeiro (vencimento mais antigo), depois recebidos e cancelados.
  const rank = (r: ReceivableRow) => (r.status === "aberto" ? 0 : r.status === "pago" ? 1 : 2);
  const rows = rowsAll
    .filter((r) => !filters.situacao || r.settlement === filters.situacao)
    .filter((r) => !filters.cliente || r.clientId === filters.cliente || r.payerName === filters.cliente)
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.dueDate.localeCompare(b.dueDate) : b.dueDate.localeCompare(a.dueDate)) || a.code.localeCompare(b.code));
  let open = 0;
  let overdue = 0;
  let received = 0;
  let openCount = 0;
  let overdueCount = 0;
  for (const r of all) {
    const s = receivableSettlement(r, today);
    if (r.status === "aberto") {
      open += s.open;
      openCount++;
      if (s.status === "vencido") {
        overdue += s.open;
        overdueCount++;
      }
    }
    for (const p of r.payments ?? []) if (p.date.slice(0, 7) === month) received += p.amount;
  }
  const chosen = selectedId ? all.find((r) => r.id === selectedId) : undefined;
  const [selected, clients, accountOptions] = await Promise.all([
    chosen ? receivableDetail(chosen, toRow(chosen), all, { categories: Array.from(categoryById.values()), centers, accounts, hide }) : Promise.resolve(null),
    can.create || can.edit ? list<Client>(COLLECTIONS.clients).then((cs) => cs.map((c) => ({ value: c.id, label: c.tradeName || c.legalName })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))) : Promise.resolve([] as Opt[]),
    can.receive || can.create || can.edit ? listPaymentAccountOptions() : Promise.resolve([] as Opt[]),
  ]);
  // Só categorias de RECEITA ativas (categoria e subcategoria, "Mãe › Filha").
  const revenue = Array.from(categoryById.values())
    .filter((c) => c.type === "receita" && !c.archived)
    .map((c) => ({ value: c.id, label: categoryName(c.id)! }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const categoryCenters: Record<string, string> = {};
  for (const c of revenue) {
    const eff = resolveEffectiveCostCenter({ categoryId: c.value }, Array.from(categoryById.values()), centers);
    if (eff.id) categoryCenters[c.value] = eff.id;
  }
  return {
    rows,
    total: rowsAll.length,
    summary: { open: money(round2(open)), overdue: money(round2(overdue)), receivedMonth: money(round2(received)), openCount, overdueCount },
    selected,
    can,
    options: {
      clients,
      categories: revenue,
      centers: centers.filter((c) => !c.archived).map((c) => ({ value: c.id, label: c.name })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
      accounts: accountOptions,
      categoryCenters,
    },
  };
}

async function receivableDetail(r: Receivable, row: ReceivableRow, all: Receivable[], ctx: { categories: FinanceCategory[]; centers: CostCenter[]; accounts: FinancialAccount[]; hide: boolean }): Promise<ReceivableDetail> {
  const [attachments, events] = await Promise.all([listReceivableAttachments(r), list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "==", r.id]] })]);
  const accountName = (id?: string) => (id ? (ctx.accounts.find((a) => a.id === id)?.name ?? "Conta removida") : undefined);
  const center = resolveEffectiveCostCenter(r, ctx.categories, ctx.centers);
  const codeOf = (id: string) => all.find((x) => x.id === id)?.code ?? id;
  // Sem "Visualizar valores": o histórico próprio (que descreve quantias) não vai à tela; só os tipos de evento.
  const history: ReceivableDetail["history"] = (ctx.hide ? [] : (r.history ?? [])).map((h, i) => ({
    id: `h${i}`,
    at: h.at,
    title: h.action,
    subtitle: [h.reason, h.changes ? Object.entries(h.changes).map(([k, v]) => `${k === "amount" ? "valor" : k}: ${String(v.from ?? "—")} → ${String(v.to ?? "—")}`).join(" · ") : null].filter(Boolean).join(" · ") || undefined,
    by: h.byName,
    tone: h.to === "pago" ? "success" : h.to === "cancelado" ? "danger" : "info",
  }));
  for (const e of events) history.push({ id: e.id, at: e.occurredAt, title: ctx.hide ? (e.type in EVENT_TITLES ? EVENT_TITLES[e.type]! : "Alteração registrada") : e.title, subtitle: ctx.hide ? undefined : e.description, by: e.actorName, tone: e.type === "receivable.received" ? "success" : e.type === "receivable.cancelled" ? "danger" : "info" });
  history.sort((a, b) => b.at.localeCompare(a.at));
  return {
    ...row,
    documentNumber: r.documentNumber,
    notes: r.notes,
    costCenter: { name: center.name, inherited: center.source !== "proprio" },
    accountId: r.accountId,
    accountName: accountName(r.accountId),
    categoryId: r.categoryId,
    costCenterId: r.costCenterId,
    cancelReason: r.cancelReason,
    paidAt: r.paidAt,
    originalAmount: ctx.hide ? undefined : r.originalAmount,
    residual: r.residualId ? { id: r.residualId, code: codeOf(r.residualId) } : undefined,
    residualOf: r.residualOf ? { id: r.residualOf, code: codeOf(r.residualOf) } : undefined,
    payments: ctx.hide ? [] : (r.payments ?? []).map((p) => ({ id: p.id, date: p.date, amount: p.amount, accountName: accountName(p.accountId) ?? "Conta removida", method: paymentMethodLabel(p.method), byName: p.byName })),
    attachments: attachments.map((d) => ({ id: d.id, name: d.name, url: d.url, createdAt: d.createdAt })),
    history,
    siblings: r.seriesId
      ? all
          .filter((x) => x.seriesId === r.seriesId && x.id !== r.id)
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
          .map((x) => ({ id: x.id, code: x.code ?? x.id, dueDate: x.dueDate, amount: ctx.hide ? null : x.amount, settlement: receivableSettlement(x, dateKey(new Date())).status }))
      : [],
  };
}

/** Títulos de evento sem quantia (sem "Visualizar valores" o título do evento, que traz valores, não vai à tela). */
const EVENT_TITLES: Partial<Record<string, string>> = {
  "receivable.created": "Título a receber lançado",
  "receivable.updated": "Título a receber alterado",
  "receivable.received": "Título recebido",
  "receivable.partially_received": "Recebimento parcial registrado",
  "receivable.residual_created": "Resíduo criado",
  "receivable.settled_by_paid": "Quitado pelo já recebido",
  "receivable.payment_undone": "Recebimento desfeito",
  "receivable.cancelled": "Título cancelado",
};
