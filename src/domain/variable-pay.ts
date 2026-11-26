/**
 * Remuneração variável (puro): consolida, por colaborador e competência, comissões + bônus + prêmios de vendas — cada
 * um continua calculado no seu módulo; aqui só se soma, compara com o fechamento e aponta o que pede atenção antes de
 * pagar (bônus ainda projetado, comissão bloqueada, valor que mudou depois do fechamento).
 */
import { formatCurrency } from "@/lib/format";
import type { CommissionStatus } from "./types";

export interface VariablePayCommissionInput {
  userId: string;
  amount: number;
  status: CommissionStatus;
}

export interface VariablePayBonusInput {
  userId: string;
  amount: number;
  /** fechado = gravado no fechamento do Bônus; projetado = cálculo do mês em aberto. */
  source: "fechado" | "projetado";
  blocked: boolean;
  tier?: string;
}

export interface VariablePayPrizeInput {
  userId: string;
  amount: number;
  /** Descrição de cada prêmio ganho ("Meta de adesão/setup batida"). */
  items: string[];
  /** Prêmio ainda em apuração (campanha que termina na competência mas não acabou). */
  provisional?: boolean;
}

/**
 * Ganhadores de uma campanha com prêmio em R$: quem bateu a meta, na ordem do ranking (atingimento), limitado aos N
 * primeiros quando a campanha define `prizeWinners`. Empate na última vaga: entra quem está antes na ordem do ranking.
 */
export function campaignPrizeWinners(rows: { userId: string; attainment: number | null; reached: boolean }[], winners?: number): string[] {
  const reached = rows.filter((r) => r.reached).sort((a, b) => (b.attainment ?? 0) - (a.attainment ?? 0));
  return (winners && winners > 0 ? reached.slice(0, winners) : reached).map((r) => r.userId);
}

export interface VariablePayPerson {
  id: string;
  name: string;
  department?: string;
}

export interface VariablePayClosedLine {
  userId: string;
  commissions: number;
  bonus: number;
  prizes: number;
  total: number;
}

export interface VariablePayLine {
  userId: string;
  userName: string;
  department?: string;
  commissions: { earned: number; paid: number; pending: number; blocked: number; count: number };
  bonus: { amount: number; source: "fechado" | "projetado" | "sem_regra"; blocked: boolean; tier?: string };
  prizes: { amount: number; items: string[] };
  /** A pagar na competência: comissões adquiridas + bônus + prêmios. */
  total: number;
  /** Ainda pode entrar: comissões pendentes (previstas, em carência, aguardando). */
  potential: number;
  closed?: VariablePayClosedLine;
  /** Diferença entre o total atual e o do fechamento (0 sem fechamento). */
  diffSinceClose: number;
  alerts: string[];
}

export interface VariablePayTotals {
  commissions: number;
  bonus: number;
  prizes: number;
  total: number;
  potential: number;
  people: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const PROVISIONAL = "Prêmio de campanha em apuração: a campanha ainda não terminou";
const EARNED: readonly CommissionStatus[] = ["liberada", "titulo_gerado", "paga"];
const PENDING: readonly CommissionStatus[] = ["prevista", "em_carencia", "aguardando_recebimento"];

export function buildVariablePayLines(input: {
  people: VariablePayPerson[];
  commissions: VariablePayCommissionInput[];
  bonuses: VariablePayBonusInput[];
  prizes: VariablePayPrizeInput[];
  closed?: VariablePayClosedLine[];
}): { lines: VariablePayLine[]; totals: VariablePayTotals } {
  const byUser = new Map<string, VariablePayLine>();
  const personById = new Map(input.people.map((p) => [p.id, p]));
  const line = (userId: string): VariablePayLine => {
    let l = byUser.get(userId);
    if (!l) {
      const p = personById.get(userId);
      l = {
        userId,
        userName: p?.name ?? "Colaborador",
        department: p?.department,
        commissions: { earned: 0, paid: 0, pending: 0, blocked: 0, count: 0 },
        bonus: { amount: 0, source: "sem_regra", blocked: false },
        prizes: { amount: 0, items: [] },
        total: 0,
        potential: 0,
        diffSinceClose: 0,
        alerts: [],
      };
      byUser.set(userId, l);
    }
    return l;
  };
  for (const c of input.commissions) {
    if (c.status === "cancelada" || c.status === "estornada") continue;
    const l = line(c.userId);
    l.commissions.count++;
    if (EARNED.includes(c.status)) l.commissions.earned = r2(l.commissions.earned + c.amount);
    if (c.status === "paga") l.commissions.paid = r2(l.commissions.paid + c.amount);
    if (PENDING.includes(c.status)) l.commissions.pending = r2(l.commissions.pending + c.amount);
    if (c.status === "bloqueada") l.commissions.blocked = r2(l.commissions.blocked + c.amount);
  }
  for (const b of input.bonuses) {
    const l = line(b.userId);
    l.bonus = { amount: b.blocked ? 0 : r2(b.amount), source: b.source, blocked: b.blocked, tier: b.tier };
  }
  for (const p of input.prizes) {
    if (p.amount <= 0) continue;
    const l = line(p.userId);
    l.prizes = { amount: r2(l.prizes.amount + p.amount), items: [...l.prizes.items, ...p.items] };
    if (p.provisional && !l.alerts.includes(PROVISIONAL)) l.alerts.push(PROVISIONAL);
  }
  const closedById = new Map((input.closed ?? []).map((c) => [c.userId, c]));
  for (const c of input.closed ?? []) line(c.userId);
  for (const l of byUser.values()) {
    l.total = r2(l.commissions.earned + l.bonus.amount + l.prizes.amount);
    l.potential = l.commissions.pending;
    const closed = closedById.get(l.userId);
    if (closed) {
      l.closed = closed;
      l.diffSinceClose = r2(l.total - closed.total);
    }
    if (l.bonus.source === "projetado" && l.bonus.amount > 0) l.alerts.push("Bônus ainda projetado: a competência não foi fechada em Bônus e Premiação");
    if (l.bonus.blocked) l.alerts.push("Bônus bloqueado na competência");
    if (l.commissions.blocked > 0) l.alerts.push(`Comissões bloqueadas pelo Financeiro (${formatCurrency(l.commissions.blocked)})`);
    if (closed && Math.abs(l.diffSinceClose) >= 0.01) l.alerts.push("Valor mudou depois do fechamento: confira antes de pagar");
  }
  const lines = Array.from(byUser.values())
    .filter((l) => l.total > 0 || l.potential > 0 || l.commissions.blocked > 0 || l.closed)
    .sort((a, b) => b.total - a.total || a.userName.localeCompare(b.userName, "pt-BR"));
  const totals = lines.reduce<VariablePayTotals>(
    (t, l) => ({ commissions: r2(t.commissions + l.commissions.earned), bonus: r2(t.bonus + l.bonus.amount), prizes: r2(t.prizes + l.prizes.amount), total: r2(t.total + l.total), potential: r2(t.potential + l.potential), people: t.people + 1 }),
    { commissions: 0, bonus: 0, prizes: 0, total: 0, potential: 0, people: 0 },
  );
  return { lines, totals };
}
