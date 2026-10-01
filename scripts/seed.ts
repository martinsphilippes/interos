/**
 * Seed de dados demonstrativos do INTEROS.
 *
 * Uso: npm run seed (emuladores, via .env.local) ou npm run seed:prod (FIREBASE_SERVICE_ACCOUNT_JSON).
 * Idempotente: limpa todas as coleções da organização e recria os usuários do Auth.
 * Roda com `--conditions=react-server`: o seed usa o registro de fórmulas e os motores de KPIs e bônus
 * (módulos server-only) para gerar definições, snapshots e o fechamento do bônus coerentes com os dados.
 */
import "./seed/quiet";
import { COLLECTIONS, type CashEntry, type CollectionName, type SlaInstance } from "../src/domain/types";
import { clearCollection, list } from "../src/server/db";
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
import { seedAmendments, seedBoletos, seedCommissionEngine, seedDerived, seedFinanceRegistry, seedPayablesGeneral, seedPortalLinks } from "./seed/derived";

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
  // Cadastros financeiros primeiro (etapa CP/CR 2): os títulos pagos pelo motor baixam com a conta corrente.
  const registry = await seedFinanceRegistry();
  total += registry.accounts + registry.centers + registry.categories + registry.subcategories;
  console.log(`  ${"cadastros financeiros".padEnd(26)} ${String(registry.accounts + registry.centers + registry.categories + registry.subcategories).padStart(5)}  (${registry.accounts} contas, ${registry.centers} centros, ${registry.categories} categorias, ${registry.subcategories} subcategorias)`);
  const tCommissions = Date.now();
  const commissions = await seedCommissionEngine(registry.bankAccountId);
  total += commissions.commissions + commissions.payables;
  console.log(`  ${"commissions (motor)".padEnd(26)} ${String(commissions.commissions).padStart(5)}`);
  console.log(`  ${"payables (motor)".padEnd(26)} ${String(commissions.payables).padStart(5)}  (${commissions.paid} pagos, ${commissions.scheduled - commissions.paid} a pagar, ${commissions.approved} aprovados · ${elapsed(tCommissions)})`);
  const cashEntries = (await list<CashEntry>(COLLECTIONS.cashEntries)).length;
  total += cashEntries;
  console.log(`  ${"cash_entries (baixas)".padEnd(26)} ${String(cashEntries).padStart(5)}  (despesas dos ${commissions.paid} títulos pagos, conta corrente)`);
  const boletos = await seedBoletos();
  console.log(`  ${"boletos (serviço)".padEnd(26)} ${String(boletos.registered.length).padStart(5)}  (registrados manualmente em cobranças abertas: ${boletos.registered.join(", ")})`);
  const portal = await seedPortalLinks(boletos.registered);
  total += portal.links;
  console.log(`  ${"portal_links (serviço)".padEnd(26)} ${String(portal.links).padStart(5)}  (cliente ${portal.clientId ?? "—"}; só o hash do token é gravado)`);
  const amendments = await seedAmendments();
  total += amendments.applied.length;
  console.log(`  ${"aditivos (serviço)".padEnd(26)} ${String(amendments.applied.length).padStart(5)}  (${amendments.applied.join(", ") || "nenhum"} aplicado em ctr_028 → v${amendments.version ?? "?"})`);
  const cap = await seedPayablesGeneral();
  total += cap.suppliers + cap.parcels + cap.recurring;
  console.log(`  ${"contas a pagar (serviço)".padEnd(26)} ${String(cap.suppliers + cap.parcels + cap.recurring).padStart(5)}  (${cap.suppliers} fornecedores, ${cap.parcels} parcelas, ${cap.recurring} série recorrente)`);
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
