/**
 * Workflow (instâncias e etapas da jornada do cliente), tarefas (90) e instâncias de SLA.
 * Roda depois de vendas, entrega e suporte porque liga tarefas e SLAs a essas entidades.
 */
import { COLLECTIONS, type ChecklistItem, type SlaInstance, type SlaRule, type Task, type WorkflowInstance, type WorkflowStep } from "../../src/domain/types";
import { JOURNEY_STAGES, type DepartmentKey, type JourneyStage, type Priority, type TaskStatus } from "../../src/domain/constants";
import { addBusinessHours } from "../../src/server/sla";
import { NOW, addDays, addHours, businessTime, daysAgo, daysFromNow, hoursAgo, id, isPast, rng, type SeedDoc } from "./lib";
import { clientById, type SeedContext, type SeededClient, type UserKey } from "./context";
import { WORKFLOW_TEMPLATE_ID } from "./catalog";

// ---------------------------------------------------------------------------
// Instâncias e etapas
// ---------------------------------------------------------------------------

/** Responsável padrão de cada etapa para um cliente. */
function assigneeFor(ctx: SeedContext, client: SeededClient, stage: JourneyStage): { id: string; name: string } {
  const { users } = ctx;
  const n = Number(client.doc.id.slice(-3));
  const byStage: Record<JourneyStage, UserKey> = {
    marketing: n % 2 === 0 ? "luciano" : "mateus",
    vendas: client.doc.ownerSalesId === users.igor.id ? "igor" : "vinicius",
    financeiro: n % 3 === 0 ? "karem" : "anapaula",
    implantacao: client.doc.ownerImplementationId === users.marcos.id ? "marcos" : "bruno",
    cs: client.doc.ownerCsId === users.camila.id ? "camila" : "felipe",
    suporte: n % 2 === 0 ? "rafael" : "larissa",
  };
  const u = users[byStage[stage]];
  return { id: u.id, name: u.name };
}

/** Início e fim de uma etapa concluída, a partir dos marcos da jornada. */
function stageWindow(client: SeededClient, stage: JourneyStage): { startedAt: string; completedAt?: string } {
  const j = client.journey;
  switch (stage) {
    case "marketing":
      return { startedAt: j.leadAt, completedAt: j.qualifiedAt };
    case "vendas":
      return { startedAt: j.qualifiedAt ?? j.leadAt, completedAt: j.wonAt };
    case "financeiro":
      return { startedAt: j.wonAt ?? j.leadAt, completedAt: j.releasedAt };
    case "implantacao":
      return { startedAt: j.implementationStartAt ?? j.releasedAt ?? j.leadAt, completedAt: j.goLiveAt };
    case "cs":
      return { startedAt: j.goLiveAt ?? j.leadAt, completedAt: j.activatedAt };
    case "suporte":
      return { startedAt: j.activatedAt ?? j.leadAt };
  }
}

/** Dados exigidos pelo gate de cada etapa concluída. */
function gateDataFor(ctx: SeedContext, client: SeededClient, stage: JourneyStage): Record<string, unknown> {
  const lead = ctx.leads.find((l) => l.id === client.doc.leadId);
  const opp = ctx.opportunities.find((o) => o.clientId === client.doc.id && o.stage === "ganho");
  const contract = ctx.contracts.find((c) => c.clientId === client.doc.id);
  const project = ctx.projects.find((p) => p.clientId === client.doc.id);
  switch (stage) {
    case "marketing":
      return { "lead.phone": lead?.phone ?? client.doc.whatsapp, "lead.interest": lead?.interest ?? "ERP e meios de pagamento", "lead.consent": true, "lead.score": lead?.score ?? rng.int(55, 90) };
    case "vendas":
      return { "opportunity.products": (opp?.products ?? client.products).map((p) => p.productName), "opportunity.monthlyTotal": opp?.monthlyTotal ?? client.products.reduce((s, p) => s + p.monthlyValue, 0), "opportunity.billingData.document": client.doc.document };
    case "financeiro":
      return { "contract.number": contract?.number, "contract.signedAt": contract?.signedAt, "contract.financialStatus": contract?.financialStatus ?? "aprovado" };
    case "implantacao":
      return { "project.checklist": project ? project.checklist.every((c) => c.done) : true, "project.trainingDone": true, "project.acceptance": project?.acceptance?.acceptedBy ?? client.contacts[0].name };
    case "cs":
      return { "cs.adoptionPct": rng.int(60, 95), "cs.ownerId": client.doc.ownerCsId, "cs.successPlanId": "splan_auto" };
    default:
      return {};
  }
}

function seedWorkflow(ctx: SeedContext): void {
  const { store, users } = ctx;
  const template = ctx.workflowTemplate;
  const steps: WorkflowStep[] = [];

  for (const client of ctx.clients) {
    if (client.doc.status === "cancelado") continue;
    const n = Number(client.doc.id.slice(-3));
    const instanceId = id("wfi", n);
    const currentIdx = JOURNEY_STAGES.indexOf(client.stage);
    const opp = ctx.opportunities.find((o) => o.clientId === client.doc.id && (o.stage === "ganho" || o.kind === "nova_venda"));
    const contract = ctx.contracts.find((c) => c.clientId === client.doc.id);
    const project = ctx.projects.find((p) => p.clientId === client.doc.id);
    const gateData: Record<string, Record<string, unknown>> = {};
    let currentStepId: string | undefined;

    for (let k = 0; k <= currentIdx; k++) {
      const stageKey = JOURNEY_STAGES[k];
      const stageSpec = template.stages.find((s) => s.key === stageKey)!;
      const stepId = `wfs_${String(n).padStart(3, "0")}_${stageKey}`;
      const isCurrent = k === currentIdx;
      const assignee = assigneeFor(ctx, client, stageKey);
      const window = stageWindow(client, stageKey);
      let status: WorkflowStep["status"] = isCurrent ? "em_andamento" : "concluida";
      let waitingClient: WorkflowStep["waitingClient"];
      let approval: WorkflowStep["approval"];
      let startedAt = window.startedAt;
      // Etapas atuais de clientes ativos em CS começaram no handoff recente, não no go-live antigo.
      if (isCurrent && stageKey === "cs") startedAt = client.doc.status === "inativo" ? businessTime(daysAgo(30)) : businessTime(daysAgo(rng.int(1, 9)));
      if (isCurrent && n === 29) {
        status = "aguardando_cliente";
        waitingClient = { reason: "Aguardando certificado digital A1 do cliente.", since: daysAgo(3, 10) };
      }
      if (isCurrent && (n === 31 || n === 36)) {
        status = "aguardando_aprovacao";
        approval = { requestedAt: hoursAgo(rng.int(3, 20)) };
      }
      if (!isCurrent && stageSpec.gate.requiresApproval) {
        approval = { requestedAt: addHours(window.completedAt!, -4), approvedAt: window.completedAt, approvedBy: stageKey === "financeiro" ? users.karem.id : users.lando.id };
      }
      const doneCount = isCurrent ? Math.min(stageSpec.gate.checklist.length, rng.int(0, 2)) : stageSpec.gate.checklist.length;
      const checklist: ChecklistItem[] = stageSpec.gate.checklist.map((c, i) => ({
        id: c.key,
        label: c.label,
        required: c.required,
        done: i < doneCount,
        doneAt: i < doneCount ? businessTime(addDays(startedAt, Math.min(i, 2))) : undefined,
        doneBy: i < doneCount ? assignee.id : undefined,
      }));
      const fields = isCurrent ? {} : gateDataFor(ctx, client, stageKey);
      if (!isCurrent) gateData[stageKey] = fields;

      const step = store.add(COLLECTIONS.workflowSteps, stepId, {
        instanceId,
        clientId: client.doc.id,
        clientName: client.doc.tradeName,
        templateKey: template.key,
        stageKey,
        stageName: stageSpec.name,
        department: stageSpec.department,
        order: stageSpec.order,
        status,
        assigneeId: assignee.id,
        assigneeName: assignee.name,
        startedAt,
        dueAt: undefined, // definido pelo SLA
        completedAt: isCurrent ? undefined : window.completedAt,
        completedBy: isCurrent ? undefined : assignee.id,
        checklist,
        fields,
        approval,
        notes: isCurrent && n === 30 ? "Bloqueado: cliente sem servidor local compatível; aguardando decisão de nuvem." : undefined,
        waitingClient,
        slaInstanceId: undefined,
        taskIds: [],
        createdAt: startedAt,
        updatedAt: window.completedAt ?? startedAt,
      } satisfies SeedDoc<WorkflowStep>);
      steps.push(step);
      if (isCurrent) currentStepId = stepId;
      // A etapa atual de clientes ativos em CS começa quando a de implantação foi aprovada.
      if (!isCurrent && stageKey === "implantacao" && client.stage === "cs") step.completedAt = step.completedAt ?? startedAt;
    }

    const instance = store.add(COLLECTIONS.workflowInstances, instanceId, {
      templateId: WORKFLOW_TEMPLATE_ID,
      templateKey: template.key,
      templateVersion: template.version,
      clientId: client.doc.id,
      clientName: client.doc.tradeName,
      title: `Jornada — ${client.doc.tradeName}`,
      currentStageKey: client.stage,
      currentStepId,
      status: "ativo",
      startedAt: client.journey.leadAt,
      context: { leadId: client.doc.leadId, opportunityId: opp?.id, contractId: contract?.id, projectId: project?.id },
      gateData,
      createdAt: client.journey.leadAt,
      updatedAt: client.doc.lastInteractionAt ?? client.journey.leadAt,
    } satisfies SeedDoc<WorkflowInstance>);
    client.doc.workflowInstanceId = instance.id;
    if (project) project.workflowInstanceId = instance.id;
  }
  ctx.steps = steps;
}

// ---------------------------------------------------------------------------
// Tarefas (90)
// ---------------------------------------------------------------------------

interface TaskSpec {
  title: string;
  description?: string;
  client?: SeededClient;
  processType?: Task["processType"];
  processId?: string;
  department: DepartmentKey;
  assigneeId: string;
  origin: Task["origin"];
  priority?: Priority;
  stepId?: string;
  recurrence?: Task["recurrence"];
  tags?: string[];
}

const MANUAL_TASKS: { title: string; department: DepartmentKey; user: UserKey; recurrence?: Task["recurrence"]; priority?: Priority }[] = [
  { title: "Fechar relatório mensal de marketing", department: "marketing", user: "mateus", recurrence: { freq: "mensal", interval: 1 } },
  { title: "Publicar 3 posts da campanha de supermercados", department: "marketing", user: "luciano", recurrence: { freq: "semanal", interval: 1 } },
  { title: "Revisar pipeline com a equipe", department: "vendas", user: "igor", recurrence: { freq: "semanal", interval: 1 }, priority: "media" },
  { title: "Atualizar tabela de preços dos pacotes", department: "vendas", user: "igor" },
  { title: "Conferir comissões da competência anterior", department: "financeiro", user: "karem", recurrence: { freq: "mensal", interval: 1 }, priority: "alta" },
  { title: "Emitir boletos da competência atual", department: "financeiro", user: "anapaula", recurrence: { freq: "mensal", interval: 1 }, priority: "alta" },
  { title: "Cobrar mensalidades vencidas", department: "financeiro", user: "anapaula", recurrence: { freq: "semanal", interval: 1 }, priority: "alta" },
  { title: "Reunião semanal de implantação", department: "implantacao", user: "lando", recurrence: { freq: "semanal", interval: 1 } },
  { title: "Atualizar roteiro de treinamento de PDV", department: "implantacao", user: "bruno" },
  { title: "Revisar checklists de go-live pendentes", department: "implantacao", user: "marcos" },
  { title: "Rodada de checkpoints da carteira", department: "cs", user: "felipe", recurrence: { freq: "semanal", interval: 1 } },
  { title: "Preparar apresentação de resultados de CS", department: "cs", user: "camila" },
  { title: "Revisar artigos da base de conhecimento", department: "suporte", user: "larissa", recurrence: { freq: "mensal", interval: 1 } },
  { title: "Auditoria de qualidade dos chamados da semana", department: "suporte", user: "lando", recurrence: { freq: "semanal", interval: 1 } },
  { title: "Consolidar cockpit do mês para a diretoria", department: "diretoria", user: "philippe", recurrence: { freq: "mensal", interval: 1 }, priority: "alta" },
  { title: "Definir metas do próximo trimestre", department: "diretoria", user: "hercules", priority: "alta" },
  { title: "Renovar certificado digital da Intercert", department: "administrativo", user: "karem", priority: "critica" },
];

function managerOf(ctx: SeedContext, userId: string): string {
  const u = Object.values(ctx.users).find((x) => x.id === userId);
  return u?.managerId ?? ctx.users.hercules.id;
}

function seedTasks(ctx: SeedContext): void {
  const { store, users } = ctx;
  const template = ctx.workflowTemplate;
  const specs: TaskSpec[] = [];

  // 1) Uma tarefa automática por etapa em andamento (43).
  for (const step of ctx.steps) {
    if (step.status === "concluida") continue;
    const stage = template.stages.find((s) => s.key === step.stageKey)!;
    const auto = stage.autoTasks[Number(step.clientId.slice(-3)) % stage.autoTasks.length];
    specs.push({ title: auto.title, description: auto.description, client: clientById(ctx, step.clientId), processType: "workflow", processId: step.id, department: step.department, assigneeId: step.assigneeId!, origin: "workflow", priority: auto.priority, stepId: step.id });
  }

  const rest: TaskSpec[] = [];
  // 2) Projetos em andamento (12).
  for (const project of ctx.projects.filter((p) => p.status !== "concluida")) {
    const client = clientById(ctx, project.clientId);
    rest.push({ title: `Configurar ambiente fiscal — ${client.doc.tradeName}`, client, processType: "project", processId: project.id, department: "implantacao", assigneeId: project.ownerId, origin: "workflow", priority: "alta" });
    rest.push({ title: `Agendar treinamento — ${client.doc.tradeName}`, client, processType: "project", processId: project.id, department: "implantacao", assigneeId: rng.pick([users.marcos.id, users.bruno.id]), origin: "manual", priority: "media" });
  }
  // 3) Chamados abertos (8).
  for (const ticket of ctx.tickets.filter((t) => t.status !== "resolvido" && t.status !== "fechado").slice(0, 8)) {
    rest.push({ title: `Acompanhar chamado ${ticket.number}: ${ticket.subject}`, client: clientById(ctx, ticket.clientId), processType: "ticket", processId: ticket.id, department: "suporte", assigneeId: ticket.assigneeId ?? users.rafael.id, origin: "evento", priority: ticket.priority === "critico" ? "critica" : ticket.priority === "alto" ? "alta" : "media" });
  }
  // 4) Oportunidades abertas (6).
  for (const opp of ctx.opportunities.filter((o) => o.stage !== "ganho" && o.stage !== "perdido" && o.kind !== "nova_venda").slice(0, 6)) {
    rest.push({ title: `Follow-up: ${opp.title}`, description: "Criada pela automação de follow-up de 48h.", client: clientById(ctx, opp.clientId), processType: "opportunity", processId: opp.id, department: "vendas", assigneeId: opp.ownerId, origin: "automacao", priority: "alta" });
  }
  // 5) Leads novos (4).
  for (const lead of ctx.leads.filter((l) => l.status === "novo").slice(0, 4)) {
    rest.push({ title: `Primeiro contato com lead ${lead.name}${lead.company ? ` (${lead.company})` : ""}`, processType: "lead", processId: lead.id, department: "marketing", assigneeId: lead.ownerId ?? users.luciano.id, origin: "automacao", priority: lead.temperature === "quente" ? "critica" : "media" });
  }
  // 6) Rotinas manuais sem cliente (17).
  for (const m of MANUAL_TASKS) rest.push({ title: m.title, department: m.department, assigneeId: users[m.user].id, origin: "manual", priority: m.priority, recurrence: m.recurrence, tags: ["rotina"] });

  specs.push(...rng.shuffle(rest));
  if (specs.length !== 90) throw new Error(`Esperava 90 tarefas, gerou ${specs.length}`);

  // Distribuição de status: 59 abertas (36/18/5) nas primeiras posições, 31 encerradas (27/4) no resto.
  const openStatuses = rng.shuffle<TaskStatus>([...Array<TaskStatus>(36).fill("aberta"), ...Array<TaskStatus>(18).fill("em_andamento"), ...Array<TaskStatus>(5).fill("aguardando")]);
  const closedStatuses = rng.shuffle<TaskStatus>([...Array<TaskStatus>(27).fill("concluida"), ...Array<TaskStatus>(4).fill("cancelada")]);
  const statuses = [...openStatuses, ...closedStatuses];
  // Prazos das abertas: 15 atrasadas, 12 hoje, 20 próximos 7 dias, 12 sem prazo.
  type DueKind = "atrasada" | "hoje" | "semana" | "sem";
  const dueKinds = rng.shuffle<DueKind>([...Array<DueKind>(15).fill("atrasada"), ...Array<DueKind>(12).fill("hoje"), ...Array<DueKind>(20).fill("semana"), ...Array<DueKind>(12).fill("sem")]);
  const priorities = rng.shuffle<Priority>([...Array<Priority>(18).fill("baixa"), ...Array<Priority>(40).fill("media"), ...Array<Priority>(25).fill("alta"), ...Array<Priority>(7).fill("critica")]);
  const withChecklist = new Set(rng.pickN(specs.map((_, i) => i), 27));

  const tasks: Task[] = [];
  specs.forEach((spec, i) => {
    const status = statuses[i];
    const isOpen = i < 59;
    let dueAt: string | undefined;
    let createdAt: string;
    let completedAt: string | undefined;
    if (isOpen) {
      const kind = dueKinds[i];
      if (kind === "atrasada") dueAt = daysAgo(rng.int(1, 10), rng.int(9, 17));
      else if (kind === "hoje") dueAt = daysFromNow(0, rng.int(9, 17));
      else if (kind === "semana") dueAt = daysFromNow(rng.int(1, 7), rng.int(9, 17));
      // Atrasadas foram criadas dias antes do prazo; as demais são recentes (o SLA da tarefa corre desde a criação).
      createdAt = kind === "atrasada" ? businessTime(addDays(dueAt!, -rng.int(1, 5))) : hoursAgo(rng.int(1, 20));
    } else {
      dueAt = status === "concluida" ? daysAgo(rng.int(1, 20), rng.int(9, 17)) : rng.chance(0.5) ? daysAgo(rng.int(1, 10)) : undefined;
      createdAt = businessTime(addDays(dueAt ?? daysAgo(rng.int(5, 25)), -rng.int(2, 6)));
      completedAt = status === "concluida" ? businessTime(addDays(dueAt!, rng.chance(0.8) ? -rng.int(0, 1) : rng.int(1, 2))) : undefined;
      if (completedAt && completedAt > NOW.toISOString()) completedAt = hoursAgo(2);
    }
    const checklist: ChecklistItem[] = withChecklist.has(i)
      ? ["Levantar informações", "Executar", "Registrar no INTEROS", "Confirmar com o cliente"].slice(0, rng.int(2, 4)).map((label, k) => {
          const done = status === "concluida" || (status === "em_andamento" && k === 0);
          return { id: `chk_${k + 1}`, label, done, doneAt: done ? completedAt ?? createdAt : undefined, doneBy: done ? spec.assigneeId : undefined };
        })
      : [];
    const assignee = Object.values(users).find((u) => u.id === spec.assigneeId)!;
    const task = store.add(COLLECTIONS.tasks, id("task", i + 1, 4), {
      title: spec.title,
      description: spec.description,
      clientId: spec.client?.doc.id,
      clientName: spec.client?.doc.tradeName,
      processType: spec.processType,
      processId: spec.processId,
      departmentId: spec.department,
      assigneeId: spec.assigneeId,
      assigneeName: assignee.name,
      creatorId: spec.origin === "manual" ? managerOf(ctx, spec.assigneeId) : spec.origin === "workflow" ? users.hercules.id : spec.assigneeId,
      priority: spec.priority ?? priorities[i],
      dueAt,
      startAt: status === "em_andamento" ? hoursAgo(rng.int(1, 30)) : undefined,
      status,
      checklist,
      tags: spec.tags ?? (spec.client ? [spec.client.segment] : []),
      recurrence: spec.recurrence,
      completedAt,
      completedBy: completedAt ? spec.assigneeId : undefined,
      origin: spec.origin,
      slaInstanceId: undefined,
      order: i + 1,
      createdAt,
      updatedAt: completedAt ?? createdAt,
    } satisfies SeedDoc<Task>);
    tasks.push(task);
    if (spec.stepId) {
      const step = ctx.steps.find((s) => s.id === spec.stepId)!;
      step.taskIds.push(task.id);
    }
  });
  ctx.tasks = tasks;
}

// ---------------------------------------------------------------------------
// SLA
// ---------------------------------------------------------------------------

function seedSla(ctx: SeedContext): void {
  const { store } = ctx;
  const rules = new Map(store.all<SlaRule>(COLLECTIONS.slaRules).map((r) => [r.key, r]));
  let seq = 0;
  const nowIso = NOW.toISOString();

  const start = (input: {
    ruleKey: string;
    entityType: SlaInstance["entityType"];
    entityId: string;
    clientId?: string;
    ownerId?: string;
    department?: DepartmentKey;
    startedAt: string;
    completedAt?: string;
    respondedAt?: string;
    paused?: { since: string; reason: string };
  }): SlaInstance => {
    const rule = rules.get(input.ruleKey);
    if (!rule) throw new Error(`Regra de SLA não encontrada: ${input.ruleKey}`);
    const startDate = new Date(input.startedAt);
    const due = rule.businessHoursOnly ? addBusinessHours(startDate, rule.resolutionHours, ctx.holidays) : new Date(startDate.getTime() + rule.resolutionHours * 3_600_000);
    const responseDue = rule.responseHours === undefined ? undefined : rule.businessHoursOnly ? addBusinessHours(startDate, rule.responseHours, ctx.holidays) : new Date(startDate.getTime() + rule.responseHours * 3_600_000);
    const dueAt = due.toISOString();
    seq += 1;
    const status: SlaInstance["status"] = input.completedAt ? "concluido" : input.paused ? "pausado" : "em_andamento";
    const breached = input.completedAt ? input.completedAt > dueAt : status === "em_andamento" && dueAt < nowIso;
    return store.add(COLLECTIONS.slaInstances, id("sla", seq, 4), {
      ruleKey: rule.key,
      ruleName: rule.name,
      entityType: input.entityType,
      entityId: input.entityId,
      clientId: input.clientId,
      ownerId: input.ownerId,
      department: input.department ?? rule.department,
      startedAt: input.startedAt,
      responseDueAt: responseDue?.toISOString(),
      respondedAt: input.respondedAt,
      dueAt,
      status,
      pausedAt: input.paused?.since,
      pausedTotalMs: 0,
      pauseReason: input.paused?.reason,
      completedAt: input.completedAt,
      breachedAt: breached ? dueAt : undefined,
      attentionPct: rule.attentionPct,
      riskPct: rule.riskPct,
      createdAt: input.startedAt,
      updatedAt: input.completedAt ?? input.startedAt,
    } satisfies SeedDoc<SlaInstance>);
  };

  // Etapas de workflow em andamento (a etapa de suporte é contínua e não tem SLA).
  for (const step of ctx.steps) {
    if (step.status === "concluida") continue;
    const stage = ctx.workflowTemplate.stages.find((s) => s.key === step.stageKey)!;
    if (!stage.slaRuleKey) continue;
    const sla = start({
      ruleKey: stage.slaRuleKey,
      entityType: "workflow_step",
      entityId: step.id,
      clientId: step.clientId,
      ownerId: step.assigneeId,
      department: step.department,
      startedAt: step.startedAt!,
      paused: step.waitingClient ? { since: step.waitingClient.since, reason: step.waitingClient.reason } : undefined,
    });
    step.slaInstanceId = sla.id;
    step.dueAt = sla.dueAt;
  }

  // Chamados: abertos em andamento; resolvidos concluídos (para os KPIs de SLA).
  for (const ticket of ctx.tickets) {
    const closed = ticket.status === "resolvido" || ticket.status === "fechado";
    const sla = start({
      ruleKey: `suporte.${ticket.priority}`,
      entityType: "chamado",
      entityId: ticket.id,
      clientId: ticket.clientId,
      ownerId: ticket.assigneeId,
      department: "suporte",
      startedAt: ticket.openedAt,
      completedAt: closed ? ticket.resolvedAt : undefined,
      respondedAt: ticket.firstResponseAt,
      paused: ticket.status === "aguardando_cliente" ? { since: addHours(ticket.firstResponseAt ?? ticket.openedAt, 1), reason: "Aguardando retorno do cliente" } : undefined,
    });
    ticket.slaInstanceId = sla.id;
  }

  // Projetos em andamento.
  for (const project of ctx.projects) {
    if (project.status === "concluida") continue;
    const sla = start({
      ruleKey: "implantacao.projeto",
      entityType: "projeto",
      entityId: project.id,
      clientId: project.clientId,
      ownerId: project.ownerId,
      department: "implantacao",
      startedAt: project.startDate!,
      paused: project.waitingClient ? { since: project.waitingClient.since, reason: project.waitingClient.reason } : undefined,
    });
    project.slaInstanceId = sla.id;
  }

  // ~20 tarefas abertas com prazo.
  const openWithDue = ctx.tasks.filter((t) => (t.status === "aberta" || t.status === "em_andamento") && t.dueAt);
  const overdue = openWithDue.filter((t) => isPast(t.dueAt!)).slice(0, 6);
  const others = openWithDue
    .filter((t) => !isPast(t.dueAt!))
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
    .slice(0, 14);
  for (const task of [...overdue, ...others]) {
    const sla = start({ ruleKey: "tarefa.padrao", entityType: "tarefa", entityId: task.id, clientId: task.clientId, ownerId: task.assigneeId, department: task.departmentId, startedAt: task.createdAt });
    task.slaInstanceId = sla.id;
  }
}

export async function seedWorkflowAndTasks(ctx: SeedContext): Promise<void> {
  seedWorkflow(ctx);
  seedTasks(ctx);
  seedSla(ctx);
}
