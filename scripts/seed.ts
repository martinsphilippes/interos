/**
 * Seed de dados demonstrativos do INTEROS.
 *
 * Uso: npm run seed (emuladores, via .env.local) ou npm run seed:prod (FIREBASE_SERVICE_ACCOUNT_JSON).
 * Idempotente: limpa todas as coleções da organização e recria os usuários do Auth.
 * Roda com `--conditions=react-server`: o seed usa o registro de fórmulas e os motores de KPIs e bônus
 * (módulos server-only) para gerar definições, snapshots e o fechamento do bônus coerentes com os dados.
 */
import "./seed/quiet";
import { COLLECTIONS, type CollectionName, type SlaInstance } from "../src/domain/types";
import { clearCollection } from "../src/server/db";
import { computeSlaState } from "../src/server/sla";
import { Store } from "./seed/lib";
import type { SeedContext } from "./seed/context";
import { seedAuthUsers, seedOrg } from "./seed/org";
import { seedCatalog } from "./seed/catalog";
import { seedClients } from "./seed/clients";
import { seedSales } from "./seed/journey-sales";
import { seedDelivery } from "./seed/journey-delivery";
import { seedSupport } from "./seed/journey-support";
import { seedWorkflowAndTasks } from "./seed/journey-workflow";
import { seedEventsAndNotifications } from "./seed/journey-events";
import { seedPerformance } from "./seed/journey-performance";
import { seedDerived } from "./seed/derived";

function elapsed(from: number): string {
  return `${((Date.now() - from) / 1000).toFixed(1)}s`;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const target = process.env.FIRESTORE_EMULATOR_HOST ? `emulador ${process.env.FIRESTORE_EMULATOR_HOST}` : "PRODUÇÃO";
  console.log(`INTEROS seed — alvo: ${target}`);

  // 1. Limpeza de todas as coleções da organização.
  const names = Object.values(COLLECTIONS) as CollectionName[];
  const removed = await Promise.all(names.map(async (name) => [name, await clearCollection(name)] as const));
  const totalRemoved = removed.reduce((s, [, n]) => s + n, 0);
  console.log(`Limpeza: ${totalRemoved} documentos removidos em ${names.length} coleções (${elapsed(t0)})`);

  // 2. Geração em memória.
  const ctx = { store: new Store(), holidays: new Set<string>() } as SeedContext;
  const steps: [string, (c: SeedContext) => Promise<void>][] = [
    ["organização, departamentos e usuários", seedOrg],
    ["catálogo e configurações", seedCatalog],
    ["clientes, contatos e produtos", seedClients],
    ["leads, oportunidades, contratos e cobranças", seedSales],
    ["implantação e CS", seedDelivery],
    ["suporte", seedSupport],
    ["workflow, tarefas e SLA", seedWorkflowAndTasks],
    ["eventos, timeline e notificações", seedEventsAndNotifications],
    ["KPIs, metas, comissões e bônus", seedPerformance],
  ];
  for (const [label, fn] of steps) {
    const t = Date.now();
    await fn(ctx);
    console.log(`Gerado: ${label} (${elapsed(t)})`);
  }

  // 3. Usuários no Firebase Auth.
  const tAuth = Date.now();
  const authCount = await seedAuthUsers();
  console.log(`Auth: ${authCount} usuários recriados (${elapsed(tAuth)})`);

  // 4. Gravação por coleção.
  console.log("Gravando no Firestore:");
  let total = 0;
  const summary: [string, number][] = [];
  for (const name of names) {
    const count = await ctx.store.flush(name);
    if (count === 0) continue;
    total += count;
    summary.push([name, count]);
    console.log(`  ${name.padEnd(26)} ${String(count).padStart(5)}`);
  }
  // 5. Derivados calculados pelos motores sobre os dados gravados.
  const tDerived = Date.now();
  const derived = await seedDerived();
  total += derived.snapshots + derived.bonus;
  console.log(`  ${"kpi_snapshots (motor)".padEnd(26)} ${String(derived.snapshots).padStart(5)}  (${derived.skipped} sem valor)`);
  console.log(`  ${"bonus_results (motor)".padEnd(26)} ${String(derived.bonus).padStart(5)}  (${elapsed(tDerived)})`);
  console.log(`\nResumo: ${total} documentos em ${summary.length} coleções — tempo total ${elapsed(t0)}`);
  const sla = slaSummary(ctx);
  console.log(`SLA ativos: ${sla.total} — ${sla.breached} violados, ${sla.atRisk} em risco (${Math.round(((sla.breached + sla.atRisk) / sla.total) * 100)}% violados ou em risco)`);
}

function slaSummary(ctx: SeedContext): { total: number; breached: number; atRisk: number } {
  const all = ctx.store.all<SlaInstance>(COLLECTIONS.slaInstances).filter((s) => s.status !== "concluido");
  const breached = all.filter((s) => s.breachedAt).length;
  const atRisk = all.filter((s) => !s.breachedAt && computeSlaState(s).state === "em_risco").length;
  return { total: all.length, breached, atRisk };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed falhou:", error);
    process.exit(1);
  });
