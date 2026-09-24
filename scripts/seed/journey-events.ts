/**
 * Histórico: eventos e timeline por cliente (coerentes com a jornada, chamados, oportunidades e
 * tarefas concluídas) e notificações (60) geradas a partir das entidades reais do seed.
 */
import { COLLECTIONS, type DomainEvent, type Notification, type SlaInstance, type TimelineEvent, type User } from "../../src/domain/types";
import type { DepartmentKey, EventType, NotificationKind } from "../../src/domain/constants";
import { NOW, addHours, hoursAgo, id, isPast, rng, type SeedDoc } from "./lib";
import type { SeedContext, SeededClient } from "./context";

interface EventSpec {
  type: EventType;
  occurredAt: string;
  actor: User;
  clientId?: string;
  entity?: { type: string; id: string };
  title: string;
  description?: string;
  payload?: Record<string, unknown>;
  department?: DepartmentKey;
}

function userById(ctx: SeedContext, userId: string | undefined, fallback: User): User {
  return Object.values(ctx.users).find((u) => u.id === userId) ?? fallback;
}
function firstName(u: User): string {
  return u.name.split(" ")[0];
}

function journeyEvents(ctx: SeedContext, client: SeededClient): EventSpec[] {
  const { users } = ctx;
  const j = client.journey;
  const c = client.doc;
  const marketing = users[Number(c.id.slice(-3)) % 2 === 0 ? "luciano" : "mateus"];
  const seller = userById(ctx, c.ownerSalesId, users.igor);
  const implementer = userById(ctx, c.ownerImplementationId, users.marcos);
  const csOwner = userById(ctx, c.ownerCsId, users.felipe);
  const lead = ctx.leads.find((l) => l.id === c.leadId);
  const opp = ctx.opportunities.find((o) => o.clientId === c.id && (o.stage === "ganho" || o.kind === "nova_venda"));
  const proposal = opp?.proposalId ? { id: opp.proposalId } : undefined;
  const contract = ctx.contracts.find((x) => x.clientId === c.id);
  const project = ctx.projects.find((p) => p.clientId === c.id);
  const out: EventSpec[] = [];
  const push = (type: EventType, occurredAt: string | undefined, actor: User, title: string, extra: Partial<EventSpec> = {}) => {
    if (!occurredAt) return;
    out.push({ type, occurredAt, actor, clientId: c.id, title, ...extra });
  };

  push("client.created", j.leadAt, marketing, `Cliente ${c.tradeName} cadastrado`, { entity: { type: "client", id: c.id }, department: "marketing", payload: { origin: c.origin } });
  push("lead.created", j.leadAt, marketing, `Lead recebido via ${c.origin}`, { entity: lead ? { type: "lead", id: lead.id } : undefined, department: "marketing" });
  push("workflow.started", j.leadAt, marketing, "Jornada do cliente iniciada", { entity: c.workflowInstanceId ? { type: "workflow_instance", id: c.workflowInstanceId } : undefined, department: "marketing" });
  push("lead.qualified", j.qualifiedAt, marketing, `Lead qualificado (MQL) por ${firstName(marketing)}`, { entity: lead ? { type: "lead", id: lead.id } : undefined, department: "marketing" });
  push("opportunity.created", j.opportunityAt, seller, `Oportunidade criada por ${firstName(seller)}`, { entity: opp ? { type: "opportunity", id: opp.id } : undefined, department: "vendas", payload: opp ? { monthlyTotal: opp.monthlyTotal } : undefined });
  push("proposal.sent", j.proposalAt, seller, `Proposta enviada por ${firstName(seller)}`, { entity: proposal ? { type: "proposal", id: proposal.id } : undefined, department: "vendas" });
  push("opportunity.won", j.wonAt, seller, `Negócio ganho: ${c.tradeName}`, { entity: opp ? { type: "opportunity", id: opp.id } : undefined, department: "vendas", payload: opp ? { setupTotal: opp.setupTotal, monthlyTotal: opp.monthlyTotal } : undefined });
  push("contract.created", j.contractAt, users.karem, `Contrato ${contract?.number ?? ""} gerado`.trim(), { entity: contract ? { type: "contract", id: contract.id } : undefined, department: "financeiro" });
  push("contract.signed", contract?.signedAt, users.karem, `Contrato ${contract?.number ?? ""} assinado`.trim(), { entity: contract ? { type: "contract", id: contract.id } : undefined, department: "financeiro" });
  push("payment.approved", j.paidAt, users.anapaula, "Pagamento da adesão confirmado", { entity: contract ? { type: "contract", id: contract.id } : undefined, department: "financeiro" });
  push("financial.released", j.releasedAt, users.karem, `Cliente liberado para implantação por ${firstName(users.karem)}`, { entity: contract ? { type: "contract", id: contract.id } : undefined, department: "financeiro" });
  push("implementation.started", j.implementationStartAt, implementer, `Implantação iniciada por ${firstName(implementer)}`, { entity: project ? { type: "project", id: project.id } : undefined, department: "implantacao" });
  push("implementation.training.completed", j.trainingAt, implementer, "Treinamento da equipe do cliente concluído", { entity: project ? { type: "project", id: project.id } : undefined, department: "implantacao" });
  push("implementation.go_live", j.goLiveAt, implementer, `Go-live realizado com aceite de ${client.contacts[0].name}`, { entity: project ? { type: "project", id: project.id } : undefined, department: "implantacao" });
  push("customer.activated", j.activatedAt, csOwner, `Cliente ativado por ${firstName(csOwner)}`, { entity: { type: "client", id: c.id }, department: "cs" });
  push("churn.registered", j.cancelledAt, csOwner, "Cancelamento registrado", { entity: { type: "client", id: c.id }, department: "cs" });

  // Etapas concluídas do workflow.
  for (const step of ctx.steps.filter((s) => s.clientId === c.id && s.status === "concluida")) {
    const actor = userById(ctx, step.completedBy, users.hercules);
    push("workflow.stage.completed", step.completedAt, actor, `Etapa ${step.stageName} concluída por ${firstName(actor)}`, { entity: { type: "workflow_step", id: step.id }, department: step.department });
  }
  // Chamados.
  for (const t of ctx.tickets.filter((x) => x.clientId === c.id)) {
    const actor = userById(ctx, t.assigneeId, users.rafael);
    push("support.ticket.created", t.openedAt, actor, `Chamado ${t.number} aberto: ${t.subject}`, { entity: { type: "ticket", id: t.id }, department: "suporte", payload: { priority: t.priority } });
    push("support.ticket.resolved", t.resolvedAt, actor, `Chamado ${t.number} resolvido por ${firstName(actor)}`, { entity: { type: "ticket", id: t.id }, department: "suporte", payload: { rootCause: t.rootCause } });
    if (t.reopenedFromId) push("support.ticket.reopened", t.openedAt, actor, `Chamado ${t.number} reaberto`, { entity: { type: "ticket", id: t.id }, department: "suporte" });
  }
  // Upsell / cross-sell.
  for (const o of ctx.opportunities.filter((x) => x.clientId === c.id && (x.kind === "upsell" || x.kind === "cross_sell"))) {
    const actor = userById(ctx, o.originUserId ?? o.ownerId, users.igor);
    push("upsell.created", o.createdAt, actor, `Oportunidade de ${o.kind === "upsell" ? "upsell" : "cross-sell"} criada por ${firstName(actor)}${o.originDepartment === "suporte" ? " (via suporte)" : ""}`, { entity: { type: "opportunity", id: o.id }, department: o.originDepartment ?? "vendas" });
    if (o.stage === "perdido") push("opportunity.lost", o.lostAt, actor, `Oportunidade perdida: ${o.lossReason}`, { entity: { type: "opportunity", id: o.id }, department: "vendas" });
  }
  return out;
}

function seedEvents(ctx: SeedContext): void {
  const { store, users } = ctx;
  const specs: EventSpec[] = [];
  for (const client of ctx.clients) specs.push(...journeyEvents(ctx, client));
  // Tarefas concluídas recentes.
  for (const task of ctx.tasks.filter((t) => t.status === "concluida" && t.completedAt)) {
    const actor = userById(ctx, task.completedBy, users.hercules);
    specs.push({ type: "task.completed", occurredAt: task.completedAt!, actor, clientId: task.clientId, entity: { type: "task", id: task.id }, title: `Tarefa concluída por ${firstName(actor)}: ${task.title}`, department: task.departmentId });
  }
  specs.sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));

  specs.forEach((e, i) => {
    const eventId = id("evt", i + 1, 5);
    store.add(COLLECTIONS.events, eventId, {
      type: e.type,
      occurredAt: e.occurredAt,
      actorId: e.actor.id,
      actorName: e.actor.name,
      clientId: e.clientId,
      entityType: e.entity?.type,
      entityId: e.entity?.id,
      title: e.title,
      description: e.description,
      payload: e.payload ?? {},
      department: e.department,
      createdAt: e.occurredAt,
    } satisfies SeedDoc<DomainEvent>);
    if (e.clientId) {
      store.add(COLLECTIONS.timelineEvents, id("tl", i + 1, 5), {
        clientId: e.clientId,
        eventId,
        type: e.type,
        occurredAt: e.occurredAt,
        actorId: e.actor.id,
        actorName: e.actor.name,
        title: e.title,
        description: e.description,
        entityType: e.entity?.type,
        entityId: e.entity?.id,
        department: e.department,
        createdAt: e.occurredAt,
      } satisfies SeedDoc<TimelineEvent>);
    }
  });
}

// ---------------------------------------------------------------------------
// Notificações
// ---------------------------------------------------------------------------

interface NotificationSpec {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  href: string;
  entity?: { type: string; id: string };
  at: string;
}

function seedNotifications(ctx: SeedContext): void {
  const { store, users } = ctx;
  const pool: NotificationSpec[] = [];
  const managerOf = (userId: string) => Object.values(users).find((u) => u.id === userId)?.managerId;
  const slas = store.all<SlaInstance>(COLLECTIONS.slaInstances);

  for (const task of ctx.tasks.filter((t) => (t.status === "aberta" || t.status === "em_andamento") && t.dueAt && isPast(t.dueAt))) {
    pool.push({ userId: task.assigneeId!, kind: "atencao", title: `Tarefa atrasada: ${task.title}`, body: task.clientName ? `Cliente ${task.clientName}` : undefined, href: `/tarefas?tarefa=${task.id}`, entity: { type: "task", id: task.id }, at: addHours(task.dueAt!, 1) });
  }
  for (const task of ctx.tasks.filter((t) => t.origin === "workflow" && t.status === "aberta").slice(0, 12)) {
    pool.push({ userId: task.assigneeId!, kind: "acao", title: `Nova tarefa atribuída: ${task.title}`, body: task.clientName, href: `/tarefas?tarefa=${task.id}`, entity: { type: "task", id: task.id }, at: task.createdAt });
  }
  for (const sla of slas.filter((s) => s.entityType === "workflow_step" && s.breachedAt)) {
    const step = ctx.steps.find((s) => s.id === sla.entityId)!;
    pool.push({ userId: step.assigneeId!, kind: "critica", title: `SLA violado na etapa ${step.stageName} — ${step.clientName}`, href: `/workflow?etapa=${step.id}`, entity: { type: "workflow_step", id: step.id }, at: sla.breachedAt! });
    const manager = managerOf(step.assigneeId!);
    if (manager) pool.push({ userId: manager, kind: "atencao", title: `SLA violado na sua equipe: ${step.stageName} — ${step.clientName}`, href: `/workflow?etapa=${step.id}`, entity: { type: "workflow_step", id: step.id }, at: sla.breachedAt! });
  }
  for (const step of ctx.steps.filter((s) => s.status === "aguardando_aprovacao")) {
    const approver = step.department === "financeiro" ? users.karem : users.lando;
    pool.push({ userId: approver.id, kind: "acao", title: `Aprovação pendente: ${step.stageName} — ${step.clientName}`, href: `/workflow?etapa=${step.id}`, entity: { type: "workflow_step", id: step.id }, at: step.approval?.requestedAt ?? hoursAgo(5) });
  }
  for (const t of ctx.tickets.filter((x) => x.status === "aberto" || x.status === "em_atendimento" || x.status === "reaberto")) {
    pool.push({ userId: t.assigneeId ?? users.lando.id, kind: t.priority === "critico" ? "critica" : "acao", title: `${t.status === "reaberto" ? "Chamado reaberto" : "Novo chamado"} ${t.number}: ${t.subject}`, href: `/suporte/chamados?chamado=${t.id}`, entity: { type: "ticket", id: t.id }, at: t.openedAt });
  }
  for (const o of ctx.opportunities.filter((x) => x.nextActionAt && isPast(x.nextActionAt) && x.stage !== "ganho" && x.stage !== "perdido")) {
    pool.push({ userId: o.ownerId, kind: "atencao", title: `Follow-up vencido: ${o.title}`, body: o.nextAction, href: `/vendas/oportunidades?oportunidade=${o.id}`, entity: { type: "opportunity", id: o.id }, at: o.nextActionAt! });
  }
  for (const c of ctx.clients.filter((x) => x.doc.healthLevel === "risco")) {
    pool.push({ userId: c.doc.ownerCsId ?? users.felipe.id, kind: "atencao", title: `Cliente em risco: ${c.doc.tradeName} (saúde ${c.doc.healthScore})`, href: `/clientes/${c.doc.id}`, entity: { type: "client", id: c.doc.id }, at: hoursAgo(rng.int(2, 40)) });
    pool.push({ userId: users.felipe.id, kind: "atencao", title: `Saúde caiu para risco: ${c.doc.tradeName}`, href: `/clientes/${c.doc.id}`, entity: { type: "client", id: c.doc.id }, at: hoursAgo(rng.int(2, 40)) });
  }
  for (const p of ctx.projects.filter((x) => x.status === "concluida")) {
    const client = ctx.clients.find((c) => c.doc.id === p.clientId)!;
    pool.push({ userId: client.doc.ownerCsId ?? users.felipe.id, kind: "informativa", title: `Go-live concluído: ${client.doc.tradeName} — handoff para CS`, href: `/clientes/${p.clientId}`, entity: { type: "project", id: p.id }, at: p.goLiveAt! });
    pool.push({ userId: users.hercules.id, kind: "informativa", title: `Go-live concluído: ${client.doc.tradeName}`, href: `/clientes/${p.clientId}`, entity: { type: "project", id: p.id }, at: p.goLiveAt! });
  }
  for (const l of ctx.leads.filter((x) => x.status === "novo" && x.temperature === "quente")) {
    pool.push({ userId: users.igor.id, kind: "acao", title: `Lead quente recebido: ${l.name}${l.company ? ` (${l.company})` : ""}`, href: `/marketing/leads?lead=${l.id}`, entity: { type: "lead", id: l.id }, at: l.createdAt });
  }
  for (const c of ctx.clients.filter((x) => x.doc.status === "prospect" && x.stage === "financeiro")) {
    pool.push({ userId: users.karem.id, kind: "acao", title: `Negócio ganho aguardando contrato: ${c.doc.tradeName}`, href: `/clientes/${c.doc.id}`, entity: { type: "client", id: c.doc.id }, at: c.journey.wonAt! });
  }
  pool.push({ userId: users.philippe.id, kind: "informativa", title: "Cockpit atualizado com os indicadores do mês", href: "/gestao/cockpit", at: hoursAgo(6) });
  pool.push({ userId: users.hercules.id, kind: "informativa", title: "Relatório semanal de vendas disponível", href: "/gestao/relatorios", at: hoursAgo(30) });
  pool.push({ userId: users.mateus.id, kind: "informativa", title: "Campanha 'ERP + TEF para supermercados' atingiu 64% do orçamento", href: "/marketing/campanhas", at: hoursAgo(12) });

  pool.sort((a, b) => (a.at < b.at ? 1 : -1));
  const selected = pool.slice(0, 60);
  selected.forEach((n, i) => {
    const read = i % 10 >= 7; // 30% lidas
    store.add(COLLECTIONS.notifications, id("notif", i + 1), {
      userId: n.userId,
      kind: n.kind,
      title: n.title,
      body: n.body,
      href: n.href,
      entityType: n.entity?.type,
      entityId: n.entity?.id,
      readAt: read ? addHours(n.at, rng.int(1, 12)) : undefined,
      createdAt: n.at > NOW.toISOString() ? hoursAgo(1) : n.at,
    } satisfies SeedDoc<Notification>);
  });
}

export async function seedEventsAndNotifications(ctx: SeedContext): Promise<void> {
  seedEvents(ctx);
  seedNotifications(ctx);
}
