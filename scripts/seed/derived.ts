/**
 * Dados derivados, calculados pelos próprios motores depois que o seed foi gravado:
 * - kpi_snapshots dos 7 meses anteriores (empresa, departamentos e colaboradores), com IDs determinísticos
 *   do motor (snap_<kpi>_<período>_<escopo>_<id>) — assim histórico, tendência e drill-down batem;
 * - fechamento do bônus da competência anterior (bonus_<userId>_<AAAA-MM>), como o botão "Fechar competência".
 *
 * Requer o seed rodando com `--conditions=react-server` (os motores são server-only).
 */
import { listRecentMonths, previousPeriod, currentMonthKey, monthPeriod } from "../../src/server/kpis/period";

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
