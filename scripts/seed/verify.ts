/**
 * Verificação do seed: conta documentos por coleção no Firestore e confere invariantes.
 * Uso: npx tsx --env-file=.env.local scripts/seed/verify.ts
 */
import "./quiet";
import { COLLECTIONS, type Client, type ClientProduct, type SlaInstance, type Task, type TimelineEvent, type User, type WorkflowStep, type CollectionName } from "../../src/domain/types";
import { list } from "../../src/server/db";

const ENTITY_COLLECTION: Record<SlaInstance["entityType"], CollectionName> = {
  tarefa: COLLECTIONS.tasks,
  workflow_step: COLLECTIONS.workflowSteps,
  chamado: COLLECTIONS.supportTickets,
  projeto: COLLECTIONS.implementationProjects,
  cs: COLLECTIONS.csAccounts,
  oportunidade: COLLECTIONS.opportunities,
};

async function main(): Promise<void> {
  const names = Object.values(COLLECTIONS) as CollectionName[];
  const counts = new Map<CollectionName, number>();
  const cache = new Map<CollectionName, { id: string }[]>();
  for (const name of names) {
    const docs = await list<{ id: string; organizationId: string; createdAt: string; updatedAt: string }>(name);
    cache.set(name, docs);
    counts.set(name, docs.length);
  }
  console.log("Documentos por coleção:");
  for (const name of names) console.log(`  ${name.padEnd(26)} ${String(counts.get(name)).padStart(5)}`);
  const total = Array.from(counts.values()).reduce((s, n) => s + n, 0);
  console.log(`  ${"TOTAL".padEnd(26)} ${String(total).padStart(5)}\n`);

  const problems: string[] = [];
  const clients = cache.get(COLLECTIONS.clients) as Client[];
  const steps = cache.get(COLLECTIONS.workflowSteps) as WorkflowStep[];
  const products = cache.get(COLLECTIONS.clientProducts) as ClientProduct[];
  const users = cache.get(COLLECTIONS.users) as User[];
  const tasks = cache.get(COLLECTIONS.tasks) as Task[];
  const slas = cache.get(COLLECTIONS.slaInstances) as SlaInstance[];
  const timeline = cache.get(COLLECTIONS.timelineEvents) as TimelineEvent[];
  const instanceIds = new Set(cache.get(COLLECTIONS.workflowInstances)!.map((d) => d.id));
  const clientIds = new Set(clients.map((c) => c.id));
  const userIds = new Set(users.map((u) => u.id));

  // (a) todo cliente não cancelado tem workflowInstanceId válido e um step em andamento/aguardando.
  for (const c of clients.filter((x) => x.status !== "cancelado")) {
    if (!c.workflowInstanceId || !instanceIds.has(c.workflowInstanceId)) problems.push(`(a) ${c.id} sem workflowInstanceId válido`);
    const open = steps.filter((s) => s.clientId === c.id && (s.status === "em_andamento" || s.status.startsWith("aguardando_")));
    if (open.length !== 1) problems.push(`(a) ${c.id} tem ${open.length} etapas abertas`);
  }
  // (b) client.mrr == soma de client_products ativos.
  for (const c of clients) {
    const sum = products.filter((p) => p.clientId === c.id && p.status === "ativo").reduce((s, p) => s + p.monthlyValue, 0);
    if (Math.abs(sum - c.mrr) > 0.005) problems.push(`(b) ${c.id} mrr=${c.mrr} soma=${sum}`);
  }
  // (c) toda task tem assigneeId existente.
  for (const t of tasks) if (!t.assigneeId || !userIds.has(t.assigneeId)) problems.push(`(c) ${t.id} assignee inválido: ${t.assigneeId}`);
  // (d) todo sla_instance aponta para entidade existente.
  for (const s of slas) {
    const coll = ENTITY_COLLECTION[s.entityType];
    if (!cache.get(coll)!.some((d) => d.id === s.entityId)) problems.push(`(d) ${s.id} -> ${s.entityType}/${s.entityId} inexistente`);
  }
  // (e) todo timeline_event tem clientId existente.
  for (const t of timeline) if (!clientIds.has(t.clientId)) problems.push(`(e) ${t.id} clientId inexistente: ${t.clientId}`);

  const activeSlas = slas.filter((s) => s.status !== "concluido");
  console.log(`SLA ativos: ${activeSlas.length}, violados: ${activeSlas.filter((s) => s.breachedAt).length}`);
  console.log(`Clientes: ${clients.length}; timeline por cliente ativo (mín.): ${Math.min(...clients.filter((c) => c.status === "ativo").map((c) => timeline.filter((t) => t.clientId === c.id).length))}`);

  if (problems.length === 0) {
    console.log("\nInvariantes (a)-(e): OK");
  } else {
    console.log(`\nInvariantes com ${problems.length} problema(s):`);
    for (const p of problems.slice(0, 50)) console.log("  " + p);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
