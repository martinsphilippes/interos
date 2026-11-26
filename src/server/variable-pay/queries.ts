import "server-only";
/**
 * Remuneração variável (leitura): por colaborador e competência, comissões (motor de comissões) + bônus (gravado no
 * fechamento do Bônus ou, com o mês aberto, a projeção do mesmo cálculo) + prêmios de vendas (setting premios_vendas,
 * metas batidas). Visibilidade = a das comissões (o próprio, a equipe ou todos — commissionVisibility).
 */
import { list } from "@/server/db";
import { can } from "@/server/auth/permissions";
import { commissionAllowed, commissionVisibility, type CommissionVisibility } from "@/server/commissions/access";
import { computeBonusForUsers } from "@/server/performance/bonus";
import { getSalesPerformance } from "@/server/performance/queries";
import { currentMonthKey, monthPeriod } from "@/server/kpis/period";
import { COMMISSION_REVENUE_LABELS } from "@/domain/commissions";
import { DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import { COLLECTIONS, type BonusResult, type Commission, type CurrentUser, type User, type VariablePayClosing } from "@/domain/types";
import { buildVariablePayLines, type VariablePayBonusInput, type VariablePayLine, type VariablePayPrizeInput, type VariablePayTotals } from "@/domain/variable-pay";

export interface VariablePayData {
  competence: string;
  label: string;
  months: { value: string; label: string }[];
  lines: VariablePayLine[];
  totals: VariablePayTotals;
  closing?: { version: number; closedAt: string; closedByName?: string; total: number; notes?: string };
  kind: CommissionVisibility["kind"];
  can: { close: boolean };
}

export function lastMonths(count: number, from = currentMonthKey()): string[] {
  const [y, m] = from.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
}

/** Consolidação de uma competência para um conjunto de colaboradores (null = todos os ativos). */
export async function computeVariablePay(competence: string, allowed: (userId: string) => boolean): Promise<{ lines: VariablePayLine[]; totals: VariablePayTotals; closing?: VariablePayClosing }> {
  const [users, commissions, results, closings] = await Promise.all([
    list<User>(COLLECTIONS.users),
    list<Commission>(COLLECTIONS.commissions, { where: [["competence", "==", competence]] }),
    list<BonusResult>(COLLECTIONS.bonusResults, { where: [["period", "==", competence]] }),
    list<VariablePayClosing>(COLLECTIONS.variablePayClosings, { where: [["competence", "==", competence]] }),
  ]);
  const people = users.filter((u) => allowed(u.id)).map((u) => ({ id: u.id, name: u.name, department: DEPARTMENT_LABELS[u.departmentId as DepartmentKey] ?? u.departmentId }));
  const ids = new Set(people.map((p) => p.id));
  const active = users.filter((u) => ids.has(u.id) && u.active !== false);

  // Bônus: o resultado gravado no fechamento vale; sem ele, a projeção do mesmo cálculo (mês em aberto).
  const closedBonus = results.filter((r) => ids.has(r.userId));
  const withClosed = new Set(closedBonus.map((r) => r.userId));
  const projections = await computeBonusForUsers(
    active.filter((u) => !withClosed.has(u.id)).map((u) => u.id),
    competence,
  );
  const bonuses: VariablePayBonusInput[] = [
    ...closedBonus.map((r) => ({ userId: r.userId, amount: (r.projectedAmount ?? 0) + (r.extrasAmount ?? 0), source: "fechado" as const, blocked: r.blocked, tier: r.tierLabel })),
    ...projections.filter((c) => c.rule).map((c) => ({ userId: c.userId, amount: c.totalAmount ?? 0, source: "projetado" as const, blocked: c.blocked, tier: c.tier?.label })),
  ];

  // Prêmios de vendas: metas do mês batidas (só quem é de Vendas tem metas comerciais).
  const sellers = active.filter((u) => u.departmentId === "vendas");
  const prizes: VariablePayPrizeInput[] = await Promise.all(
    sellers.map(async (u) => {
      const perf = await getSalesPerformance(u.id, competence);
      const earned = perf.prizes.filter((p) => p.earned);
      return { userId: u.id, amount: earned.reduce((s, p) => s + p.prize, 0), items: earned.map((p) => `Meta de ${COMMISSION_REVENUE_LABELS[p.type].toLowerCase()} batida`) };
    }),
  );

  const closing = closings.sort((a, b) => b.version - a.version)[0];
  const { lines, totals } = buildVariablePayLines({
    people,
    commissions: commissions.filter((c) => ids.has(c.userId)).map((c) => ({ userId: c.userId, amount: c.amount, status: c.status })),
    bonuses,
    prizes,
    closed: closing?.lines.filter((l) => ids.has(l.userId)),
  });
  return { lines, totals, closing };
}

export async function getVariablePayData(viewer: CurrentUser, requested?: string): Promise<VariablePayData> {
  const months = lastMonths(12);
  const competence = requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : months[0];
  const vis = await commissionVisibility(viewer);
  const { lines, totals, closing } = await computeVariablePay(competence, (id) => commissionAllowed(vis, id));
  return {
    competence,
    label: monthPeriod(competence).label,
    months: (months.includes(competence) ? months : [competence, ...months]).map((m) => ({ value: m, label: monthPeriod(m).label })),
    lines,
    totals,
    closing: closing ? { version: closing.version, closedAt: closing.createdAt, closedByName: closing.closedByName, total: closing.total, notes: closing.notes } : undefined,
    kind: vis.kind,
    can: { close: can(viewer, "financeiro.remuneracao-variavel.fechar") },
  };
}
