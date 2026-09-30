/**
 * Dados derivados, calculados pelos próprios motores depois que o seed foi gravado:
 * - comissões e títulos a pagar pelo MOTOR DE COMISSÕES (D19) a partir dos contratos, cobranças e regras do seed,
 *   com a data de referência do seed (sem eventos: o seed não dispara notificações/automações); em seguida parte dos
 *   títulos percorre o fluxo real (aprovar → programar → pagar) pelos mesmos serviços da tela;
 * - kpi_snapshots dos 7 meses anteriores (empresa, departamentos e colaboradores), com IDs determinísticos
 *   do motor (snap_<kpi>_<período>_<escopo>_<id>) — assim histórico, tendência e drill-down batem;
 * - fechamento do bônus da competência anterior (bonus_<userId>_<AAAA-MM>), como o botão "Fechar competência".
 *
 * Requer o seed rodando com `--conditions=react-server` (os motores são server-only).
 */
import { listRecentMonths, previousPeriod, currentMonthKey, monthPeriod } from "../../src/server/kpis/period";
import { COLLECTIONS, type Payable } from "../../src/domain/types";
import { list } from "../../src/server/db";
import { dateKey } from "../../src/lib/format";
import { NOW, addDays } from "./lib";

export interface CommissionSeedResult {
  commissions: number;
  payables: number;
  paid: number;
  scheduled: number;
  approved: number;
}

/**
 * Comissões pelo motor (data de referência = NOW do seed) e títulos em estados variados pelo fluxo real:
 * elegíveis de meses anteriores → pagos no vencimento (menos os 2 mais recentes, que ficam vencidos a pagar);
 * elegíveis do mês → metade aprovada, metade prevista.
 */
export async function seedCommissionEngine(): Promise<CommissionSeedResult> {
  const { reconcileCommissions } = await import("../../src/server/commissions/engine");
  const { approvePayable, schedulePayable, payPayable } = await import("../../src/server/commissions/payables");
  const r = await reconcileCommissions({ now: NOW, emit: false, backfill: true });
  const karem = { id: "user_karem", name: "Karem Feitosa" };
  const today = dateKey(NOW);
  const month = today.slice(0, 7);
  const payables = (await list<Payable>(COLLECTIONS.payables)).filter((p) => p.origin === "comissao_automatica").sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  const out: CommissionSeedResult = { commissions: r.created, payables: payables.length, paid: 0, scheduled: 0, approved: 0 };
  const past = payables.filter((p) => p.competence < month);
  const current = payables.filter((p) => p.competence >= month);
  const due = past.filter((p) => dateKey(p.dueDate) <= today);
  // Todos os vencidos são pagos no vencimento, menos os 2 mais recentes (exemplo de título vencido a pagar).
  const unpaid = new Set(due.slice(-2).map((p) => p.id));
  for (const p of past) {
    const approvedAt = addDays(p.createdAt, 2) < NOW.toISOString() ? addDays(p.createdAt, 2) : NOW.toISOString();
    await approvePayable(p.id, karem, undefined, { emit: false, at: approvedAt });
    await schedulePayable(p.id, {}, karem, { emit: false, at: approvedAt });
    out.scheduled++;
    if (dateKey(p.dueDate) <= today && !unpaid.has(p.id)) {
      await payPayable(p.id, { paidAt: dateKey(p.dueDate), paymentMethod: "folha" }, karem, { emit: false, at: p.dueDate });
      out.paid++;
    }
  }
  for (const [i, p] of current.entries()) {
    if (i % 2 === 1) continue;
    await approvePayable(p.id, karem, undefined, { emit: false });
    out.approved++;
  }
  return out;
}

export async function seedDerived(): Promise<{ snapshots: number; skipped: number; bonus: number }> {
  const { storeSnapshots, invalidateDataBundleCache } = await loadEngine();
  const { storeBonusResults } = await import("../../src/server/performance/bonus");
  invalidateDataBundleCache();
  const current = monthPeriod(currentMonthKey());
  const months = listRecentMonths(7, previousPeriod(current));
  let snapshots = 0;
  let skipped = 0;
  for (const m of months) {
    const r = await storeSnapshots(m);
    snapshots += r.written;
    skipped += r.skipped;
  }
  const bonus = await storeBonusResults(previousPeriod(current));
  return { snapshots, skipped, bonus: bonus.written };
}

async function loadEngine() {
  const engine = await import("../../src/server/kpis/engine");
  const formulas = await import("../../src/server/kpis/formulas");
  return { storeSnapshots: engine.storeSnapshots, invalidateDataBundleCache: formulas.invalidateDataBundle };
}
