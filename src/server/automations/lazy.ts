import "server-only";
import type { SweepKey } from "./schemas";

/**
 * Disparo preguiçoso das varreduras centrais (runSweeps) a partir das telas dos módulos: roda só as
 * varreduras pedidas que estão vencidas pela frequência configurada em /admin/automacoes (as marcas
 * antigas dos módulos — followupLastRunAt, csHealthLastRunAt, csRenewalsLastRunAt — continuam valendo).
 * Complementa o cron diário (/api/cron/sweep), que no plano Hobby roda 1x por dia.
 *
 * Nunca lança: uma falha de varredura não pode derrubar a tela que a disparou.
 */
export async function runDueSweeps(keys: SweepKey[]): Promise<void> {
  try {
    const { runSweeps } = await import("./scheduler");
    await runSweeps({ only: keys });
  } catch (error) {
    console.error(`[automacoes] varredura preguiçosa (${keys.join(", ")}) falhou`, error);
  }
}
