import "server-only";
/**
 * Motor do Health Score (configurável).
 *
 * Combina sete fatores (0–100 cada) com os pesos de `settings.health_score.pesos` (normalizados para
 * somar 100%) e classifica pelos limiares `settings.health_score.limiares`. Fatores com peso 0 ficam de
 * fora. Cada fator devolve uma nota em português explicando o valor, para o drill-down.
 *
 * `computeHealthFromInput` é puro (sem I/O). `computeHealthScore(clientId)` carrega os dados de um
 * cliente; `loadAllHealthInputs()` carrega a base inteira de uma vez (recálculo em lote sem N+1).
 */
import { getById, list } from "@/server/db";
import { getSetting } from "@/server/admin/queries";
import { computeSlaState } from "@/server/sla";
import { isPastDue } from "@/server/finance/billing";
import { dateKey, formatCurrency } from "@/lib/format";
import { COLLECTIONS, type Billing, type Client, type CsAccount, type CsatResponse, type HealthScore, type SlaInstance, type SupportTicket } from "@/domain/types";
import type { HealthLevel } from "@/domain/constants";
import { HEALTH_FACTORS, levelForScore, type HealthFactorKey } from "./schemas";

const DAY_MS = 86_400_000;
export const HEALTH_WINDOW_DAYS = 90;

export interface HealthConfig {
  pesos: Record<string, number>;
  limiares: { saudavel: number; atencao: number };
}

/**
 * Padrão igual ao seed. `relacionamento` não existe no seed: entra com peso 10 até o administrador
 * configurá-lo (a tela de configurações aceita chaves livres em `pesos`).
 */
export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  pesos: { uso: 25, satisfacao: 20, sla: 15, suporte: 15, reincidencia: 10, financeiro: 15, relacionamento: 10 },
  limiares: { saudavel: 75, atencao: 50 },
};

export async function getHealthConfig(): Promise<HealthConfig> {
  const stored = await getSetting<Partial<HealthConfig>>("health_score", {});
  return {
    pesos: { ...DEFAULT_HEALTH_CONFIG.pesos, ...(stored.pesos ?? {}) },
    limiares: { ...DEFAULT_HEALTH_CONFIG.limiares, ...(stored.limiares ?? {}) },
  };
}

export interface HealthInput {
  client: Client;
  account: CsAccount | null;
  /** Chamados do cliente (qualquer data; o motor recorta a janela). */
  tickets: SupportTicket[];
  /** SLAs de chamados do cliente. */
  slas: SlaInstance[];
  csat: CsatResponse[];
  billings: Billing[];
  /** Média de chamados abertos por cliente da carteira na janela (referência do fator "suporte"). */
  baseAvgTickets: number;
}

export type HealthFactor = HealthScore["factors"][number];

export interface HealthResult {
  score: number;
  level: HealthLevel;
  factors: HealthFactor[];
  computedAt: string;
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const OPEN_TICKET = new Set<SupportTicket["status"]>(["aberto", "em_atendimento", "aguardando_cliente", "reaberto"]);

export function isReopened(t: Pick<SupportTicket, "reopenCount" | "reopenedFromId" | "status">): boolean {
  return t.reopenCount > 0 || Boolean(t.reopenedFromId) || t.status === "reaberto";
}

export function isOpenTicket(t: Pick<SupportTicket, "status">): boolean {
  return OPEN_TICKET.has(t.status);
}

/** Cobranças vencidas (status gravado ou vencimento passado ainda em aberto). */
export function overdueBillings(billings: Billing[], today = dateKey(new Date())): Billing[] {
  return billings.filter((b) => b.status === "vencida" || isPastDue(b, today));
}

/** Média de CSAT (0–10) das respostas a partir de `sinceIso`; null sem respostas. */
export function csatAverage(csat: CsatResponse[], sinceIso: string): { avg: number; count: number } | null {
  const recent = csat.filter((c) => (c.respondedAt ?? c.createdAt) >= sinceIso);
  if (recent.length === 0) return null;
  return { avg: recent.reduce((s, c) => s + c.score, 0) / recent.length, count: recent.length };
}

/** Última interação de relacionamento: conta de CS (checkpoints e contatos) e, sem ela, o cliente. */
export function lastInteractionOf(client: Pick<Client, "lastInteractionAt">, account: Pick<CsAccount, "lastInteractionAt"> | null): string | undefined {
  return account?.lastInteractionAt ?? client.lastInteractionAt;
}

type FactorValue = { value: number; note: string };

function factorValues(input: HealthInput, now: Date): Record<HealthFactorKey, FactorValue> {
  const since = new Date(now.getTime() - HEALTH_WINDOW_DAYS * DAY_MS).toISOString();
  const { client, account } = input;
  const recentTickets = input.tickets.filter((t) => t.openedAt >= since);

  // Utilização / adoção
  const uso: FactorValue = account
    ? { value: clamp(account.adoptionPct), note: `Adoção de ${account.adoptionPct}% registrada na conta de CS.` }
    : { value: 50, note: "Sem conta de CS: adoção ainda não medida (valor neutro 50)." };

  // Satisfação: CSAT médio da janela; sem respostas usa a satisfação percebida no checkpoint; senão neutro.
  const avg = csatAverage(input.csat, since);
  let satisfacao: FactorValue;
  if (avg) satisfacao = { value: clamp(avg.avg * 10), note: `CSAT médio ${avg.avg.toFixed(1)}/10 em ${plural(avg.count, "avaliação", "avaliações")} nos últimos ${HEALTH_WINDOW_DAYS} dias.` };
  else if (account?.satisfaction !== undefined) satisfacao = { value: clamp(account.satisfaction * 10), note: `Sem CSAT no período; satisfação percebida no último checkpoint: ${account.satisfaction.toFixed(1)}/10.` };
  else satisfacao = { value: 70, note: `Sem avaliações nos últimos ${HEALTH_WINDOW_DAYS} dias (valor neutro 70).` };

  // SLA: chamados resolvidos na janela dentro do prazo.
  const slaById = new Map(input.slas.map((s) => [s.id, s]));
  const slaByTicket = new Map(input.slas.filter((s) => s.entityType === "chamado").map((s) => [s.entityId, s]));
  const resolved = input.tickets.filter((t) => t.resolvedAt && t.resolvedAt >= since);
  let measured = 0;
  let within = 0;
  for (const t of resolved) {
    const sla = (t.slaInstanceId ? slaById.get(t.slaInstanceId) : undefined) ?? slaByTicket.get(t.id);
    if (!sla) continue;
    measured += 1;
    const late = sla.completedAt ? computeSlaState(sla).state === "violado" : t.resolvedAt! > sla.dueAt;
    if (!late) within += 1;
  }
  const sla: FactorValue =
    measured === 0
      ? { value: 100, note: `Nenhum chamado resolvido com SLA nos últimos ${HEALTH_WINDOW_DAYS} dias.` }
      : { value: clamp((within / measured) * 100), note: `${within} de ${plural(measured, "chamado resolvido", "chamados resolvidos")} dentro do SLA (${Math.round((within / measured) * 100)}%).` };

  // Suporte: volume de chamados comparado à média da carteira (cada "média" a mais tira 25 pontos).
  const count = recentTickets.length;
  const ratio = input.baseAvgTickets > 0 ? count / input.baseAvgTickets : count;
  const suporte: FactorValue =
    count === 0
      ? { value: 100, note: `Nenhum chamado aberto nos últimos ${HEALTH_WINDOW_DAYS} dias.` }
      : {
          value: clamp(100 - 25 * ratio),
          note: `${plural(count, "chamado", "chamados")} em ${HEALTH_WINDOW_DAYS} dias; média da carteira ${input.baseAvgTickets.toFixed(1)} (${ratio.toFixed(1)}× a média).`,
        };

  // Reincidência: reabertos / total da janela.
  const reopened = recentTickets.filter(isReopened).length;
  const reincidencia: FactorValue =
    count === 0
      ? { value: 100, note: "Sem chamados no período, sem reincidência." }
      : { value: clamp(100 * (1 - reopened / count)), note: reopened === 0 ? "Nenhum chamado reaberto no período." : `${reopened} de ${count} chamado(s) reaberto(s) (${Math.round((reopened / count) * 100)}%).` };

  // Financeiro: penaliza pelos dias da cobrança vencida mais antiga (até 60 pts) e pelo valor em relação ao MRR (até 40 pts).
  const today = dateKey(now);
  const overdue = overdueBillings(input.billings, today);
  let financeiro: FactorValue;
  if (overdue.length === 0) financeiro = { value: 100, note: "Nenhuma cobrança vencida." };
  else {
    const amount = overdue.reduce((s, b) => s + b.amount, 0);
    const oldest = overdue.reduce((min, b) => (b.dueDate < min ? b.dueDate : min), overdue[0].dueDate);
    const days = Math.max(0, Math.floor((now.getTime() - new Date(oldest).getTime()) / DAY_MS));
    const mrr = client.mrr > 0 ? client.mrr : 1;
    const penalty = Math.min(60, days * 2) + Math.min(40, (amount / mrr) * 20);
    financeiro = { value: clamp(100 - penalty), note: `${plural(overdue.length, "cobrança vencida", "cobranças vencidas")} somando ${formatCurrency(amount)}; a mais antiga há ${plural(days, "dia", "dias")}.` };
  }

  // Relacionamento: 100 até 15 dias sem interação, cai linearmente até 0 em 60 dias.
  const last = lastInteractionOf(client, account);
  let relacionamento: FactorValue;
  if (!last) relacionamento = { value: 0, note: "Nenhuma interação registrada com o cliente." };
  else {
    const days = Math.max(0, Math.floor((now.getTime() - new Date(last).getTime()) / DAY_MS));
    const value = days <= 15 ? 100 : days >= 60 ? 0 : (100 * (60 - days)) / 45;
    relacionamento = { value: clamp(value), note: days === 0 ? "Última interação hoje." : `Última interação há ${plural(days, "dia", "dias")}.` };
  }

  return { uso, satisfacao, sla, suporte, reincidencia, financeiro, relacionamento };
}

/** Cálculo puro a partir dos dados já carregados. */
export function computeHealthFromInput(input: HealthInput, config: HealthConfig, now: Date = new Date()): HealthResult {
  const values = factorValues(input, now);
  const active = HEALTH_FACTORS.filter((f) => (config.pesos[f.key] ?? 0) > 0);
  // Sem nenhum peso configurado, todos os fatores valem igual.
  const factorsUsed: readonly (typeof HEALTH_FACTORS)[number][] = active.length > 0 ? active : HEALTH_FACTORS;
  const weightOf = (key: string) => (active.length > 0 ? config.pesos[key] : 1);
  const total = factorsUsed.reduce((s: number, f) => s + weightOf(f.key), 0);

  let sum = 0;
  const factors: HealthFactor[] = factorsUsed.map((f) => {
    const { value, note } = values[f.key];
    const weightPct = (weightOf(f.key) / total) * 100;
    const contribution = (value * weightPct) / 100;
    sum += contribution;
    return { key: f.key, label: f.label, weight: Number(weightPct.toFixed(1)), value: Math.round(value), contribution: Number(contribution.toFixed(1)), note };
  });
  const score = Math.round(sum);
  return { score, level: levelForScore(score, config.limiares), factors, computedAt: now.toISOString() };
}

// ---------------------------------------------------------------------------
// Carga de dados
// ---------------------------------------------------------------------------

/** Clientes que compõem a carteira de CS (base da média de chamados). */
export function isPortfolioClient(c: Pick<Client, "status" | "currentStage">): boolean {
  return c.status === "ativo" || (c.status === "em_implantacao" && c.currentStage === "cs");
}

function averageTickets(tickets: SupportTicket[], clients: Client[], now: Date): number {
  const since = new Date(now.getTime() - HEALTH_WINDOW_DAYS * DAY_MS).toISOString();
  const base = clients.filter(isPortfolioClient);
  if (base.length === 0) return 0;
  const ids = new Set(base.map((c) => c.id));
  return tickets.filter((t) => t.openedAt >= since && ids.has(t.clientId)).length / base.length;
}

function latestAccount(accounts: CsAccount[]): CsAccount | null {
  return [...accounts].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null;
}

/** Dados de um cliente para o cálculo (a média da base exige a lista de chamados e clientes). */
export async function loadHealthInput(clientId: string, now: Date = new Date()): Promise<HealthInput | null> {
  const client = await getById<Client>(COLLECTIONS.clients, clientId);
  if (!client) return null;
  const byClient = { where: [["clientId", "==", clientId]] as [string, "==", unknown][] };
  const [accounts, allTickets, slas, csat, billings, clients] = await Promise.all([
    list<CsAccount>(COLLECTIONS.csAccounts, byClient),
    list<SupportTicket>(COLLECTIONS.supportTickets),
    list<SlaInstance>(COLLECTIONS.slaInstances, byClient),
    list<CsatResponse>(COLLECTIONS.csatResponses, byClient),
    list<Billing>(COLLECTIONS.billing, byClient),
    list<Client>(COLLECTIONS.clients),
  ]);
  return {
    client,
    account: latestAccount(accounts),
    tickets: allTickets.filter((t) => t.clientId === clientId),
    slas: slas.filter((s) => s.entityType === "chamado"),
    csat,
    billings,
    baseAvgTickets: averageTickets(allTickets, clients, now),
  };
}

/** Dados de todos os clientes da carteira em poucas leituras (recálculo em lote). */
export async function loadAllHealthInputs(now: Date = new Date()): Promise<HealthInput[]> {
  const [clients, accounts, tickets, slas, csat, billings] = await Promise.all([
    list<Client>(COLLECTIONS.clients),
    list<CsAccount>(COLLECTIONS.csAccounts),
    list<SupportTicket>(COLLECTIONS.supportTickets),
    list<SlaInstance>(COLLECTIONS.slaInstances, { where: [["entityType", "==", "chamado"]] }),
    list<CsatResponse>(COLLECTIONS.csatResponses),
    list<Billing>(COLLECTIONS.billing),
  ]);
  const group = <T extends { clientId?: string }>(items: T[]) => {
    const map = new Map<string, T[]>();
    for (const item of items) {
      if (!item.clientId) continue;
      const arr = map.get(item.clientId) ?? [];
      arr.push(item);
      map.set(item.clientId, arr);
    }
    return map;
  };
  const accountsBy = group(accounts);
  const ticketsBy = group(tickets);
  const slasBy = group(slas);
  const csatBy = group(csat);
  const billingsBy = group(billings);
  const baseAvgTickets = averageTickets(tickets, clients, now);
  return clients.filter(isPortfolioClient).map((client) => ({
    client,
    account: latestAccount(accountsBy.get(client.id) ?? []),
    tickets: ticketsBy.get(client.id) ?? [],
    slas: slasBy.get(client.id) ?? [],
    csat: csatBy.get(client.id) ?? [],
    billings: billingsBy.get(client.id) ?? [],
    baseAvgTickets,
  }));
}

/** Calcula (sem gravar) o health score de um cliente. */
export async function computeHealthScore(clientId: string): Promise<HealthResult | null> {
  const now = new Date();
  const [input, config] = await Promise.all([loadHealthInput(clientId, now), getHealthConfig()]);
  if (!input) return null;
  return computeHealthFromInput(input, config, now);
}
