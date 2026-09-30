/**
 * Verificação do seed: conta documentos por coleção no Firestore e confere invariantes.
 * Uso: npx tsx --env-file=.env.local scripts/seed/verify.ts
 */
import "./quiet";
import { COLLECTIONS, type Billing, type Client, type ClientProduct, type Commission, type Contract, type Counter, type Opportunity, type Payable, type PaymentEvent, type Proposal, type SlaInstance, type Task, type TimelineEvent, type User, type WorkflowStep, type CollectionName } from "../../src/domain/types";
import { counterId, list } from "../../src/server/db";
import { commissionIdFor } from "../../src/server/commissions/store";

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

  // (f) contadores de numeração nunca abaixo do maior número gravado (senão nextNumber repetiria números).
  const counters = cache.get(COLLECTIONS.counters) as Counter[];
  const opportunities = cache.get(COLLECTIONS.opportunities) as Opportunity[];
  const contracts = cache.get(COLLECTIONS.contracts) as Contract[];
  const numbered = [
    ...contracts.map((c) => c.number),
    ...(cache.get(COLLECTIONS.proposals) as Proposal[]).map((p) => p.number),
    ...opportunities.map((o) => o.saleNumber),
    ...(cache.get(COLLECTIONS.commissions) as Commission[]).map((c) => c.code),
    ...(cache.get(COLLECTIONS.payables) as Payable[]).map((p) => p.code),
  ];
  for (const n of numbered) {
    const m = n?.match(/^([A-Z]+)-(\d{4})-(\d+)$/);
    if (!m) continue;
    const counter = counters.find((c) => c.id === counterId(m[1], m[2]));
    if (!counter || counter.value < Number(m[3])) problems.push(`(f) contador ${m[1]}-${m[2]} (${counter?.value ?? "ausente"}) abaixo de ${n}`);
  }
  // (g) número da venda único; contrato com saleNumber aponta para a venda de mesmo número.
  const saleNumbers = opportunities.map((o) => o.saleNumber).filter(Boolean);
  if (new Set(saleNumbers).size !== saleNumbers.length) problems.push("(g) saleNumber duplicado em oportunidades");
  for (const c of contracts.filter((x) => x.saleNumber)) {
    const opp = opportunities.find((o) => o.id === c.opportunityId);
    if (!opp || opp.saleNumber !== c.saleNumber) problems.push(`(g) ${c.id} saleNumber ${c.saleNumber} sem venda correspondente`);
  }

  // (h) comissões do motor: sem duplicidade por chave de idempotência e id = com_<hash da chave>; código único.
  const commissions = cache.get(COLLECTIONS.commissions) as Commission[];
  const payables = cache.get(COLLECTIONS.payables) as Payable[];
  const keys = new Map<string, string>();
  for (const c of commissions.filter((x) => x.sourceKey)) {
    const dup = keys.get(c.sourceKey!);
    if (dup) problems.push(`(h) sourceKey duplicada: ${c.id} e ${dup}`);
    keys.set(c.sourceKey!, c.id);
    if (c.id !== commissionIdFor(c.sourceKey!)) problems.push(`(h) ${c.id} não corresponde à chave ${c.sourceKey}`);
  }
  const codes = commissions.map((c) => c.code).filter(Boolean);
  if (new Set(codes).size !== codes.length) problems.push("(h) código COM duplicado");
  const payableCodes = payables.map((p) => p.code).filter(Boolean);
  if (new Set(payableCodes).size !== payableCodes.length) problems.push("(h) código PAG duplicado");
  // (i) todo título de comissão (não cancelado) aponta para comissão "título gerado"/"paga" que aponta de volta.
  const commissionById = new Map(commissions.map((c) => [c.id, c]));
  const payableById = new Map(payables.map((p) => [p.id, p]));
  for (const p of payables.filter((x) => x.origin === "comissao_automatica" && x.status !== "cancelado")) {
    const c = commissionById.get(p.sourceIds.commissionIds[0] ?? "");
    if (!c) problems.push(`(i) ${p.id} aponta para comissão inexistente`);
    else if (c.payableId !== p.id || !(c.status === "titulo_gerado" || c.status === "paga" || (c.status === "estornada" && p.status === "pago"))) problems.push(`(i) ${p.id} → ${c.id} com status ${c.status} / payableId ${c.payableId}`);
  }
  // (j) comissão paga ⇔ título pago.
  for (const c of commissions.filter((x) => x.status === "paga")) {
    const p = c.payableId ? payableById.get(c.payableId) : undefined;
    if (!p || p.status !== "pago") problems.push(`(j) comissão paga ${c.id} com título ${c.payableId ?? "ausente"} ${p?.status ?? ""}`);
  }
  for (const p of payables.filter((x) => x.origin === "comissao_automatica" && x.status === "pago")) {
    const c = commissionById.get(p.sourceIds.commissionIds[0] ?? "");
    if (!c || !(c.status === "paga" || c.status === "estornada")) problems.push(`(j) título pago ${p.id} com comissão ${c?.status ?? "ausente"}`);
  }
  // (k) título existe só para comissão que já foi elegível; elegível sem título só depois de título cancelado.
  for (const c of commissions.filter((x) => x.status === "liberada" && !x.payableId && !(x.previousPayableIds?.length))) problems.push(`(k) comissão elegível ${c.id} sem título`);
  console.log(`Comissões: ${commissions.length} (${commissions.filter((c) => c.sourceKey).length} do motor); títulos: ${payables.length} (${payables.filter((p) => p.status === "pago").length} pagos)`);

  // (l) eventos de pagamento externos sem duplicidade (provedor + eventId) e id determinístico `<provedor>_<eventId>`.
  const paymentEvents = cache.get(COLLECTIONS.paymentEvents) as PaymentEvent[];
  const eventKeys = new Set<string>();
  for (const e of paymentEvents) {
    const key = `${e.provider}|${e.eventId}`;
    if (eventKeys.has(key)) problems.push(`(l) payment_event duplicado: ${key}`);
    eventKeys.add(key);
    if (!e.id.startsWith(`${e.provider}_`)) problems.push(`(l) ${e.id} não começa com o provedor ${e.provider}`);
  }
  // (m) toda cobrança com boleto/PIX registrado tem chargeStatus; paga ⇒ nunca "pendente"; cancelada ⇒ nunca paga.
  const billings = cache.get(COLLECTIONS.billing) as Billing[];
  for (const b of billings) {
    if ((b.boleto || b.pix || b.paymentUrl || b.externalId) && !b.chargeStatus) problems.push(`(m) ${b.id} com boleto sem chargeStatus`);
    if (b.status === "paga" && (b.paidAmount === undefined || !b.paidAt)) problems.push(`(m) ${b.id} paga sem paidAmount/paidAt`);
    if (b.status !== "paga" && (b.paidAt || b.paidAmount !== undefined)) problems.push(`(m) ${b.id} ${b.status} com dados de pagamento`);
  }
  console.log(`Cobranças: ${billings.length} (${billings.filter((b) => b.boleto).length} com boleto registrado); eventos de pagamento externos: ${paymentEvents.length}`);

  const activeSlas = slas.filter((s) => s.status !== "concluido");
  console.log(`SLA ativos: ${activeSlas.length}, violados: ${activeSlas.filter((s) => s.breachedAt).length}`);
  console.log(`Clientes: ${clients.length}; timeline por cliente ativo (mín.): ${Math.min(...clients.filter((c) => c.status === "ativo").map((c) => timeline.filter((t) => t.clientId === c.id).length))}`);

  if (problems.length === 0) {
    console.log("\nInvariantes (a)-(m): OK");
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
