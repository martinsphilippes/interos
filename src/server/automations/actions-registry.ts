import "server-only";
/**
 * Registro das ações do motor de automações. Cada ação tem parâmetros validados por zod
 * (ACTION_PARAM_SCHEMAS em schemas.ts) e roda em dois modos:
 * - real: executa a mutação pelos serviços dos módulos (tarefas, notificações, SLA, CS);
 * - simulação: resolve destinatários e textos e descreve o que aconteceria, sem efeitos.
 *
 * Destinatários (assignee de criar_tarefa, to de notificar):
 *   "responsavel_entidade" · "responsavel_cliente" · "gestor_departamento" · "papel:<role>" ·
 *   "departamento:<key>" · caminho do contexto ("opportunity.ownerId", "sla.ownerId", "cs.ownerId",
 *   "department.managerId", "department.<key>.managerId") · ID de usuário.
 */
import { getById, list, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { notify } from "@/server/notifications";
import { getSlaRule, listSlaByEntity, startSla } from "@/server/sla";
import { createTaskInternal } from "@/server/tasks/service";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import {
  COLLECTIONS,
  type Client,
  type ClientProduct,
  type CollectionName,
  type CsAccount,
  type Department,
  type Notification,
  type SlaInstance,
  type SuccessPlan,
  type SupportTicket,
  type Task,
  type TaskProcessType,
  type User,
  type UserRef,
} from "@/domain/types";
import { CLIENT_STATUS_LABELS, DEPARTMENT_KEYS, DEPARTMENT_LABELS, type DepartmentKey, type RoleKey } from "@/domain/constants";
import { getPath, hasTemplate, renderTemplate } from "./conditions";
import { ACTION_PARAM_SCHEMAS, ACTION_TYPE_LABELS, STATUS_WHITELIST, type ActionOutcome, type AutomationRuleRecord, type RuleAction, type RuleActionType } from "./schemas";

export const AUTOMATION_ACTOR: UserRef = { id: "system", name: "INTEROS (automação)" };

// ---------------------------------------------------------------------------
// Contexto da execução
// ---------------------------------------------------------------------------

export interface AutomationContext {
  now: string;
  rule: { id: string; name: string };
  event?: {
    id: string;
    type: string;
    title: string;
    description?: string;
    occurredAt: string;
    actorId: string;
    actorName: string;
    entityType?: string;
    entityId?: string;
    clientId?: string;
    department?: DepartmentKey;
  };
  payload: Record<string, unknown>;
  entityType?: string;
  entity?: Record<string, unknown> & { id: string };
  client?: Client;
  cs?: CsAccount;
  sla?: SlaInstance;
  department?: { key: DepartmentKey; name: string; managerId?: string };
  /** Apelidos da entidade pelo tipo ("opportunity", "lead", "ticket"...), para caminhos como opportunity.ownerId. */
  [alias: string]: unknown;
}

export interface ActionRuntime {
  simulate: boolean;
  rule: AutomationRuleRecord;
  actor: UserRef;
  eventId?: string;
}

/** Coleção de cada tipo de entidade usado nos eventos. */
export const ENTITY_COLLECTIONS: Record<string, CollectionName> = {
  lead: COLLECTIONS.leads,
  prospect: COLLECTIONS.prospects,
  prospect_list: COLLECTIONS.prospectLists,
  opportunity: COLLECTIONS.opportunities,
  proposal: COLLECTIONS.proposals,
  visit: COLLECTIONS.visits,
  contract: COLLECTIONS.contracts,
  billing: COLLECTIONS.billing,
  project: COLLECTIONS.implementationProjects,
  training: COLLECTIONS.trainings,
  ticket: COLLECTIONS.supportTickets,
  task: COLLECTIONS.tasks,
  client: COLLECTIONS.clients,
  contact: COLLECTIONS.contacts,
  renewal: COLLECTIONS.renewals,
  success_plan: COLLECTIONS.successPlans,
  cs_account: COLLECTIONS.csAccounts,
  churn_record: COLLECTIONS.churnRecords,
  sla_instance: COLLECTIONS.slaInstances,
  workflow_step: COLLECTIONS.workflowSteps,
  workflow_instance: COLLECTIONS.workflowInstances,
  document: COLLECTIONS.documents,
  communication: COLLECTIONS.communications,
  user: COLLECTIONS.users,
};

/** Departamento natural de cada tipo de entidade (quando o evento não informa). */
export const ENTITY_DEPARTMENT: Record<string, DepartmentKey> = {
  lead: "marketing",
  prospect: "marketing",
  prospect_list: "marketing",
  opportunity: "vendas",
  proposal: "vendas",
  visit: "vendas",
  contract: "financeiro",
  billing: "financeiro",
  project: "implantacao",
  training: "implantacao",
  ticket: "suporte",
  renewal: "cs",
  success_plan: "cs",
  cs_account: "cs",
  churn_record: "cs",
};

const PROCESS_TYPES: Record<string, TaskProcessType> = {
  lead: "lead",
  prospect: "prospect",
  opportunity: "opportunity",
  contract: "contract",
  project: "project",
  ticket: "ticket",
  renewal: "renewal",
  workflow_step: "workflow",
  success_plan: "cs",
  cs_account: "cs",
};

const SLA_ENTITY_BY_TYPE: Record<string, SlaInstance["entityType"]> = {
  task: "tarefa",
  workflow_step: "workflow_step",
  ticket: "chamado",
  project: "projeto",
  opportunity: "oportunidade",
  cs_account: "cs",
  client: "cs",
};

const OPEN_TASK = new Set<Task["status"]>(["aberta", "em_andamento", "aguardando"]);

export function entityHref(type: string | undefined, id: string | undefined, clientId?: string): string | undefined {
  if (type && id) {
    switch (type) {
      case "lead":
        return `/marketing/leads?lead=${id}`;
      case "opportunity":
        return `/vendas/oportunidades?oportunidade=${id}`;
      case "visit":
        return `/vendas/visitas?visita=${id}`;
      case "task":
        return `/tarefas?tarefa=${id}`;
      case "ticket":
        return `/suporte/chamados?chamado=${id}`;
      case "project":
        return `/implantacao/${id}`;
      case "workflow_step":
        return `/workflow?etapa=${id}`;
      case "workflow_instance":
        return `/workflow/${id}`;
      case "contract":
        return `/financeiro/contratos/${id}`;
      case "success_plan":
        return `/cs/planos?plano=${id}`;
      case "renewal":
        return "/cs/renovacoes";
      case "client":
        return `/clientes/${id}`;
      case "user":
        return `/admin/usuarios?usuario=${id}`;
    }
  }
  return clientId ? `/clientes/${clientId}` : undefined;
}

/** Nome legível do registro que disparou a regra (lead, oportunidade, chamado, cliente...). */
export function subjectLabel(ctx: AutomationContext): string {
  const e = ctx.entity;
  if (e) {
    const s = (k: string) => (typeof e[k] === "string" && e[k] ? String(e[k]) : "");
    switch (ctx.entityType) {
      case "lead":
        return [s("name"), s("company") ? `(${s("company")})` : ""].filter(Boolean).join(" ");
      case "ticket":
        return [s("number"), s("subject")].filter(Boolean).join(" · ");
      case "client":
        return s("tradeName");
      case "task":
      case "opportunity":
        return s("title");
      case "project":
        return s("name") || ctx.client?.tradeName || "";
      case "workflow_step":
        return [s("stageName"), s("clientName")].filter(Boolean).join(" · ");
    }
    const generic = s("title") || s("name") || s("subject") || s("number");
    if (generic) return ctx.client && !generic.includes(ctx.client.tradeName) ? `${generic} · ${ctx.client.tradeName}` : generic;
  }
  return ctx.client?.tradeName ?? "";
}

/** Responsável natural do registro (dono, atribuído, vendedor, responsável do SLA...). */
export function ownerOf(ctx: AutomationContext): string | undefined {
  const e: Record<string, unknown> = ctx.entity ?? {};
  const pick = (...values: unknown[]) => values.find((v): v is string => typeof v === "string" && v.length > 0);
  if (ctx.entityType === "client" && ctx.client) return clientOwnerFor(ctx.client, ctx.department?.key);
  return pick(e.ownerId, e.assigneeId, e.sellerId, e.instructorId, e.responsibleId, ctx.sla?.ownerId, ctx.payload.ownerId, ctx.payload.assigneeId);
}

/** Responsável do cliente para um departamento (vendas → vendedor, implantação, CS). */
export function clientOwnerFor(client: Pick<Client, "ownerSalesId" | "ownerCsId" | "ownerImplementationId">, department: DepartmentKey | undefined): string | undefined {
  if (department === "vendas" || department === "marketing" || department === "financeiro") return client.ownerSalesId ?? client.ownerCsId;
  if (department === "implantacao") return client.ownerImplementationId ?? client.ownerCsId;
  return client.ownerCsId ?? client.ownerSalesId;
}

// ---------------------------------------------------------------------------
// Consultas com cache curto (organização pequena: leitura completa em memória)
// ---------------------------------------------------------------------------

const LOOKUP_TTL_MS = 60_000;
let usersCache: { at: number; users: Map<string, User> } | null = null;
let departmentsCache: { at: number; items: Department[] } | null = null;

export async function cachedUsers(): Promise<Map<string, User>> {
  if (usersCache && Date.now() - usersCache.at < LOOKUP_TTL_MS) return usersCache.users;
  const users = await list<User>(COLLECTIONS.users);
  usersCache = { at: Date.now(), users: new Map(users.map((u) => [u.id, u])) };
  return usersCache.users;
}

export async function cachedDepartments(): Promise<Department[]> {
  if (departmentsCache && Date.now() - departmentsCache.at < LOOKUP_TTL_MS) return departmentsCache.items;
  departmentsCache = { at: Date.now(), items: await list<Department>(COLLECTIONS.departments) };
  return departmentsCache.items;
}

export async function departmentInfo(key: DepartmentKey): Promise<{ key: DepartmentKey; name: string; managerId?: string }> {
  const dept = (await cachedDepartments()).find((d) => d.key === key);
  return { key, name: dept?.name ?? DEPARTMENT_LABELS[key], managerId: dept?.managerId };
}

/** Gestor ativo do departamento. */
export async function managerOf(key: DepartmentKey): Promise<string | undefined> {
  const { managerId } = await departmentInfo(key);
  if (!managerId) return undefined;
  const user = (await cachedUsers()).get(managerId);
  return user && user.active !== false ? user.id : undefined;
}

function isDepartment(value: string): value is DepartmentKey {
  return (DEPARTMENT_KEYS as readonly string[]).includes(value);
}

/** Entre vários candidatos, o com menos tarefas abertas. */
async function leastLoaded(ids: string[]): Promise<string | undefined> {
  if (ids.length <= 1) return ids[0];
  const tasks = await list<Task>(COLLECTIONS.tasks, { where: [["assigneeId", "in", ids]] });
  const load = new Map(ids.map((id) => [id, 0]));
  for (const t of tasks) if (t.assigneeId && OPEN_TASK.has(t.status)) load.set(t.assigneeId, (load.get(t.assigneeId) ?? 0) + 1);
  return [...ids].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0))[0];
}

export interface ResolvedRecipients {
  ids: string[];
  unresolved: string[];
}

/** Resolve especificações de destinatário em IDs de usuários ativos. */
export async function resolveRecipients(
  spec: string | string[] | undefined,
  ctx: AutomationContext,
  options: { mode: "assignee" | "notify"; department?: DepartmentKey },
): Promise<ResolvedRecipients> {
  const specs = (Array.isArray(spec) ? spec : spec ? [spec] : ["responsavel_entidade"]).map((s) => s.trim()).filter(Boolean);
  const users = await cachedUsers();
  const active = (id: string | undefined) => (id && users.get(id)?.active !== false && users.has(id) ? id : undefined);
  const department = options.department ?? ctx.department?.key;
  const ids: string[] = [];
  const unresolved: string[] = [];

  for (const s of specs) {
    let found: (string | undefined)[] = [];
    if (s === "responsavel_entidade") found = [ownerOf(ctx)];
    else if (s === "responsavel_cliente") found = [ctx.client ? clientOwnerFor(ctx.client, department) : undefined];
    else if (s === "gestor_departamento") found = [department ? await managerOf(department) : undefined];
    else if (s.startsWith("papel:")) {
      const role = s.slice(6) as RoleKey;
      const withRole = Array.from(users.values()).filter((u) => u.active !== false && u.role === role);
      // Para atribuir, prefere quem tem o papel dentro do departamento da regra.
      const inDept = department ? withRole.filter((u) => u.departmentId === department) : [];
      const pool = (options.mode === "assignee" && inDept.length > 0 ? inDept : withRole).map((u) => u.id);
      found = options.mode === "assignee" ? [await leastLoaded(pool)] : pool;
    } else if (s.startsWith("departamento:")) {
      const key = s.slice(13);
      if (isDepartment(key)) {
        found = options.mode === "assignee" ? [await managerOf(key)] : Array.from(users.values()).filter((u) => u.active !== false && u.departmentId === key).map((u) => u.id);
      }
    } else if (/^department\.[a-z_]+\.managerId$/.test(s) && isDepartment(s.split(".")[1])) {
      // Formato do seed: "department.vendas.managerId" = gestor do departamento informado.
      found = [await managerOf(s.split(".")[1] as DepartmentKey)];
    } else if (s.includes(".")) {
      const value = getPath(ctx, s);
      found = Array.isArray(value) ? value.map((v) => (typeof v === "string" ? v : undefined)) : [typeof value === "string" ? value : undefined];
    } else found = [s];

    const ok = found.map(active).filter((id): id is string => Boolean(id));
    if (ok.length === 0) unresolved.push(s);
    for (const id of ok) if (!ids.includes(id)) ids.push(id);
  }
  return { ids, unresolved };
}

/** Responsável padrão de uma tarefa sem assignee: dono do cliente no departamento → dono do registro → gestor. */
async function defaultAssignee(ctx: AutomationContext, department: DepartmentKey | undefined): Promise<string | undefined> {
  const users = await cachedUsers();
  const valid = (id: string | undefined, sameDept: boolean) => {
    const u = id ? users.get(id) : undefined;
    if (!u || u.active === false) return undefined;
    return !sameDept || !department || u.departmentId === department ? u.id : undefined;
  };
  return (
    (ctx.client ? valid(clientOwnerFor(ctx.client, department), false) : undefined) ??
    valid(ownerOf(ctx), true) ??
    (department ? await managerOf(department) : undefined) ??
    valid(ownerOf(ctx), false)
  );
}

function userName(users: Map<string, User>, id: string | undefined): string {
  return id ? (users.get(id)?.name ?? id) : "sem responsável";
}

function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

type ActionHandler = (params: Record<string, unknown>, ctx: AutomationContext, rt: ActionRuntime) => Promise<ActionOutcome>;

const criarTarefa: ActionHandler = async (raw, ctx, rt) => {
  const p = ACTION_PARAM_SCHEMAS.criar_tarefa.parse(raw);
  const users = await cachedUsers();
  const department = p.department ?? ctx.department?.key;
  let assigneeId: string | undefined;
  let note = "";
  if (p.assignee) {
    assigneeId = (await resolveRecipients(p.assignee, ctx, { mode: "assignee", department })).ids[0];
    if (!assigneeId) note = ` (destinatário "${p.assignee}" não encontrado; usado o responsável padrão)`;
  }
  assigneeId ??= await defaultAssignee(ctx, department);

  const subject = subjectLabel(ctx);
  let title = renderTemplate(p.title, ctx);
  // Sem template, o título ganha o nome do registro para não virar uma tarefa genérica.
  if (!hasTemplate(p.title) && subject && !title.includes(subject)) title = `${title}: ${subject}`;
  const description = p.description
    ? renderTemplate(p.description, ctx)
    : [`Criada pela automação "${rt.rule.name}".`, ctx.event ? `Gatilho: ${ctx.event.title}.` : "", ctx.event?.description ?? ""].filter(Boolean).join(" ");
  const dueAt = addHours(ctx.now, p.dueInHours);
  const departmentId = department ?? users.get(assigneeId ?? "")?.departmentId ?? "administrativo";
  const processType = ctx.entityType ? PROCESS_TYPES[ctx.entityType] : undefined;
  const processId = processType ? (ctx.entityType === "client" ? ctx.cs?.id : ctx.entity?.id) : undefined;

  // Idempotência: mesma tarefa aberta para o mesmo registro/evento não é recriada.
  const existing = rt.eventId
    ? await list<Task>(COLLECTIONS.tasks, { where: [["sourceEventId", "==", rt.eventId]] })
    : processId
      ? await list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", processId]] })
      : [];
  const duplicate = existing.find((t) => t.title === title && OPEN_TASK.has(t.status));
  if (duplicate) return { type: "criar_tarefa", status: "ignorada", detail: `Tarefa "${title}" já está aberta`, href: `/tarefas?tarefa=${duplicate.id}` };

  const who = userName(users, assigneeId);
  if (rt.simulate) return { type: "criar_tarefa", status: "simulada", detail: `Criaria a tarefa "${title}" para ${who} (${DEPARTMENT_LABELS[departmentId]}, prioridade ${p.priority}, prazo ${formatDateTime(dueAt)})${note}` };

  const task = await createTaskInternal(
    {
      title,
      description,
      clientId: ctx.client?.id,
      assigneeId,
      departmentId,
      priority: p.priority,
      dueAt,
      processType,
      processId,
      origin: "automacao",
      sourceEventId: rt.eventId,
      tags: ["automacao"],
    },
    rt.actor,
  );
  return { type: "criar_tarefa", status: "sucesso", effect: "tarefa criada", detail: `Tarefa "${title}" criada para ${who}${note}`, clientId: task.clientId, href: `/tarefas?tarefa=${task.id}` };
};

const notificar: ActionHandler = async (raw, ctx, rt) => {
  const p = ACTION_PARAM_SCHEMAS.notificar.parse(raw);
  const { ids, unresolved } = await resolveRecipients(p.to, ctx, { mode: "notify" });
  const users = await cachedUsers();
  let targets = ids;
  // Quem já foi notificado pelo mesmo evento (ex.: handler genérico de SLA) não recebe de novo.
  if (rt.eventId && targets.length > 0) {
    const sent = await list<Notification>(COLLECTIONS.notifications, { where: [["eventId", "==", rt.eventId]] });
    const already = new Set(sent.map((n) => n.userId));
    targets = targets.filter((id) => !already.has(id));
  }
  const missing = unresolved.length > 0 ? ` · sem destinatário para: ${unresolved.join(", ")}` : "";
  if (targets.length === 0) return { type: "notificar", status: "ignorada", detail: ids.length > 0 ? "Destinatários já notificados por este evento" : `Nenhum destinatário encontrado${missing}` };

  const title = p.title ? renderTemplate(p.title, ctx) : rt.rule.name;
  const body = p.body ? renderTemplate(p.body, ctx) : (ctx.event?.title ?? subjectLabel(ctx));
  const href = p.href ? renderTemplate(p.href, ctx) : entityHref(ctx.entityType, ctx.entity?.id, ctx.client?.id);
  const names = targets.map((id) => userName(users, id)).join(", ");
  if (rt.simulate) return { type: "notificar", status: "simulada", detail: `Notificaria (${p.kind}) ${names}: "${title}"${missing}` };

  await notify({
    userIds: targets,
    kind: p.kind,
    title,
    body,
    href,
    entity: ctx.entityType && ctx.entity ? { type: ctx.entityType, id: ctx.entity.id } : undefined,
    eventId: rt.eventId,
  });
  return { type: "notificar", status: "sucesso", effect: "notificação enviada", detail: `Notificação enviada para ${names}${missing}`, href };
};

const mudarStatus: ActionHandler = async (raw, ctx, rt) => {
  const p = ACTION_PARAM_SCHEMAS.mudar_status.parse(raw);
  const collection = p.collection as CollectionName;
  let targetId: string | undefined;
  if (ctx.entityType && ENTITY_COLLECTIONS[ctx.entityType] === collection) targetId = ctx.entity?.id;
  else if (collection === COLLECTIONS.csAccounts) targetId = ctx.cs?.id;
  const label = STATUS_WHITELIST[p.collection]?.label ?? p.collection;
  if (!targetId) return { type: "mudar_status", status: "erro", detail: `O gatilho não traz um registro do tipo ${label}` };

  const current = await getById<{ id: string; organizationId: string; createdAt: string; updatedAt: string } & Record<string, unknown>>(collection, targetId);
  if (!current) return { type: "mudar_status", status: "erro", detail: `${label} não encontrado(a)` };
  if (current[p.field] === p.value) return { type: "mudar_status", status: "ignorada", detail: `${label}: ${p.field} já é "${p.value}"` };
  const from = current[p.field] ?? "vazio";
  if (rt.simulate) return { type: "mudar_status", status: "simulada", detail: `Alteraria ${label}.${p.field}: "${String(from)}" → "${p.value}"` };

  await update(collection, targetId, { [p.field]: p.value });
  const clientId = typeof current.clientId === "string" ? current.clientId : ctx.client?.id;
  return { type: "mudar_status", status: "sucesso", effect: `${p.field} alterado`, detail: `${label}.${p.field}: "${String(from)}" → "${p.value}"`, clientId };
};

const iniciarSla: ActionHandler = async (raw, ctx, rt) => {
  const p = ACTION_PARAM_SCHEMAS.iniciar_sla.parse(raw);
  const entityType = p.entityType ?? (ctx.entityType ? SLA_ENTITY_BY_TYPE[ctx.entityType] : undefined);
  const entityId = entityType === "cs" ? (ctx.cs?.id ?? ctx.client?.id) : ctx.entity?.id;
  if (!entityType || !entityId) return { type: "iniciar_sla", status: "erro", detail: "O gatilho não traz um registro que aceite SLA" };
  const slaRule = await getSlaRule(p.ruleKey);
  if (!slaRule) return { type: "iniciar_sla", status: "erro", detail: `Regra de SLA "${p.ruleKey}" não encontrada` };
  const running = (await listSlaByEntity(entityType, entityId)).find((s) => s.ruleKey === p.ruleKey && (s.status === "em_andamento" || s.status === "pausado"));
  if (running) return { type: "iniciar_sla", status: "ignorada", detail: `SLA "${slaRule.name}" já está em andamento` };
  const ownerId = ownerOf(ctx);
  if (rt.simulate) return { type: "iniciar_sla", status: "simulada", detail: `Iniciaria o SLA "${slaRule.name}" (${slaRule.resolutionHours}h) para ${entityType} ${entityId}` };

  const sla = await startSla({ ruleKey: p.ruleKey, entityType, entityId, clientId: ctx.client?.id, ownerId, department: slaRule.department ?? ctx.department?.key });
  await emitEvent({
    type: "sla.started",
    actor: rt.actor,
    clientId: ctx.client?.id,
    entity: ctx.entityType && ctx.entity ? { type: ctx.entityType, id: ctx.entity.id } : { type: "sla_instance", id: sla.id },
    title: `SLA iniciado por automação: ${slaRule.name}`,
    description: `Prazo ${formatDateTime(sla.dueAt)}`,
    department: sla.department,
    payload: { slaInstanceId: sla.id, ruleKey: p.ruleKey, ownerId, dueAt: sla.dueAt, __automation: rt.rule.id },
    timeline: false,
  });
  return { type: "iniciar_sla", status: "sucesso", effect: "SLA iniciado", detail: `SLA "${slaRule.name}" iniciado (prazo ${formatDateTime(sla.dueAt)})`, clientId: ctx.client?.id };
};

/** Resumo do cliente para o handoff: status, MRR, produtos, saúde, chamados e responsáveis. */
async function clientSummary(client: Client, users: Map<string, User>): Promise<string> {
  const [products, tickets] = await Promise.all([
    list<ClientProduct>(COLLECTIONS.clientProducts, { where: [["clientId", "==", client.id]] }),
    list<SupportTicket>(COLLECTIONS.supportTickets, { where: [["clientId", "==", client.id]] }),
  ]);
  const activeProducts = products.filter((p) => p.status === "ativo" || p.status === "em_implantacao");
  const openTickets = tickets.filter((t) => t.status !== "resolvido" && t.status !== "fechado");
  const owners = [
    client.ownerSalesId ? `Vendas: ${userName(users, client.ownerSalesId)}` : "",
    client.ownerImplementationId ? `Implantação: ${userName(users, client.ownerImplementationId)}` : "",
    client.ownerCsId ? `CS: ${userName(users, client.ownerCsId)}` : "",
  ].filter(Boolean);
  return [
    `Cliente: ${client.tradeName} (${client.legalName}) · ${CLIENT_STATUS_LABELS[client.status]}`,
    `MRR: ${formatCurrency(client.mrr)}${client.healthScore !== undefined ? ` · Saúde: ${client.healthScore} (${client.healthLevel ?? "—"})` : ""}`,
    `Produtos: ${activeProducts.map((p) => `${p.productName}${p.status === "em_implantacao" ? " (em implantação)" : ""}`).join(", ") || "nenhum ativo"}`,
    `Chamados abertos: ${openTickets.length}${client.activatedAt ? ` · Ativo desde ${formatDate(client.activatedAt)}` : ""}`,
    owners.length ? `Responsáveis: ${owners.join(" · ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const criarHandoff: ActionHandler = async (raw, ctx, rt) => {
  const p = ACTION_PARAM_SCHEMAS.criar_handoff.parse(raw);
  const client = ctx.client;
  if (!client) return { type: "criar_handoff", status: "erro", detail: "Handoff exige um cliente no gatilho" };
  const users = await cachedUsers();
  const deptLabel = DEPARTMENT_LABELS[p.department];
  const manager = await managerOf(p.department);
  const ownerCandidate = clientOwnerFor(client, p.department);
  const owner = ownerCandidate && users.get(ownerCandidate)?.active !== false && users.get(ownerCandidate)?.departmentId === p.department ? ownerCandidate : undefined;
  const assigneeId = owner ?? manager;
  const summary = await clientSummary(client, users);
  const title = p.title ? renderTemplate(p.title, ctx) : `Handoff para ${deptLabel}: ${client.tradeName}`;

  const clientTasks = await list<Task>(COLLECTIONS.tasks, { where: [["clientId", "==", client.id]] });
  const existing = clientTasks.find((t) => OPEN_TASK.has(t.status) && t.departmentId === p.department && t.tags.includes("handoff"));
  const notifyIds = [manager, existing ? undefined : assigneeId].filter((id, i, arr): id is string => Boolean(id) && arr.indexOf(id) === i);

  if (rt.simulate) {
    return {
      type: "criar_handoff",
      status: "simulada",
      detail: existing
        ? `Handoff para ${deptLabel} já existe (tarefa "${existing.title}"); notificaria ${notifyIds.map((id) => userName(users, id)).join(", ") || "ninguém"} com o resumo do cliente`
        : `Criaria a tarefa "${title}" para ${userName(users, assigneeId)} e notificaria o gestor de ${deptLabel} com o resumo do cliente`,
    };
  }

  let taskId = existing?.id;
  if (!existing) {
    const processType = ctx.entityType ? PROCESS_TYPES[ctx.entityType] : undefined;
    const task = await createTaskInternal(
      {
        title,
        description: [summary, p.note ? renderTemplate(p.note, ctx) : "", ctx.event ? `Origem: ${ctx.event.title}` : ""].filter(Boolean).join("\n\n"),
        clientId: client.id,
        assigneeId,
        departmentId: p.department,
        priority: "alta",
        dueAt: addHours(ctx.now, p.dueInHours),
        processType,
        processId: processType ? ctx.entity?.id : undefined,
        origin: "automacao",
        sourceEventId: rt.eventId,
        checklist: ["Ler o resumo do cliente", "Contato de apresentação com o cliente", "Registrar próximos passos"],
        tags: ["handoff", "automacao"],
      },
      rt.actor,
    );
    taskId = task.id;
  }
  const href = taskId ? `/tarefas?tarefa=${taskId}` : `/clientes/${client.id}`;
  if (notifyIds.length > 0) {
    await notify({ userIds: notifyIds, kind: "acao", title: `Handoff de ${client.tradeName} para ${deptLabel}`, body: summary, href, entity: { type: "client", id: client.id }, eventId: rt.eventId });
  }
  return {
    type: "criar_handoff",
    status: "sucesso",
    effect: existing ? "handoff notificado" : "handoff criado",
    detail: existing
      ? `Handoff para ${deptLabel} já existia (tarefa "${existing.title}"); resumo enviado a ${notifyIds.map((id) => userName(users, id)).join(", ") || "ninguém"}`
      : `Tarefa de handoff criada para ${userName(users, assigneeId)}; gestor de ${deptLabel} notificado`,
    clientId: client.id,
    href,
  };
};

const criarPlanoSucesso: ActionHandler = async (raw, ctx, rt) => {
  const p = ACTION_PARAM_SCHEMAS.criar_plano_sucesso.parse(raw);
  const client = ctx.client;
  if (!client) return { type: "criar_plano_sucesso", status: "erro", detail: "Plano de sucesso exige um cliente no gatilho" };
  const plans = await list<SuccessPlan>(COLLECTIONS.successPlans, { where: [["clientId", "==", client.id]] });
  const active = plans.find((pl) => pl.status === "ativo");
  if (active) return { type: "criar_plano_sucesso", status: "ignorada", detail: `Cliente já tem plano ativo: ${active.objective}`, href: `/cs/planos?plano=${active.id}` };

  const users = await cachedUsers();
  const isActive = (id: string | undefined) => (id && users.get(id)?.active !== false && users.has(id) ? id : undefined);
  const ownerId = isActive(ctx.cs?.ownerId) ?? isActive(client.ownerCsId) ?? (await managerOf("cs"));
  if (!ownerId) return { type: "criar_plano_sucesso", status: "erro", detail: "Nenhum responsável de CS encontrado para o cliente" };

  const objective = renderTemplate(p.objective, ctx);
  const day = 86_400_000;
  const base = new Date(ctx.now).getTime();
  const descriptions = p.actions.length > 0 ? p.actions.map((a) => renderTemplate(a, ctx)) : [`Contato com o cliente sobre: ${objective}`, "Plano de ação para os pontos críticos", "Checkpoint de acompanhamento"];
  const actions = descriptions.map((description, i) => ({
    description,
    responsibleId: ownerId,
    dueAt: new Date(base + (i === descriptions.length - 1 && p.actions.length === 0 ? p.checkpointInDays : (i + 1) * 2) * day).toISOString(),
  }));
  const checkpointAt = new Date(base + p.checkpointInDays * day).toISOString();
  if (rt.simulate) return { type: "criar_plano_sucesso", status: "simulada", detail: `Criaria o plano "${objective}" para ${userName(users, ownerId)} com ${actions.length} ação(ões) e checkpoint em ${formatDate(checkpointAt)}` };

  const cs = await import("@/server/cs/service");
  const plan = await cs.createSuccessPlan({ clientId: client.id, ownerId, objective, checkpointAt, actions }, rt.actor, "automacao", rt.eventId);
  return { type: "criar_plano_sucesso", status: "sucesso", effect: "plano de sucesso criado", detail: `Plano "${objective}" criado para ${userName(users, ownerId)}`, clientId: client.id, href: `/cs/planos?plano=${plan.id}` };
};

const WEBHOOK_TIMEOUT_MS = 5_000;

const webhook: ActionHandler = async (raw, ctx, rt) => {
  const p = ACTION_PARAM_SCHEMAS.webhook.parse(raw);
  const enabled = process.env.AUTOMATION_WEBHOOKS_ENABLED === "true";
  if (rt.simulate || !enabled) {
    return {
      type: "webhook",
      status: "simulada",
      effect: "webhook não enviado",
      detail: `${rt.simulate ? "Chamaria" : "Webhook não enviado (AUTOMATION_WEBHOOKS_ENABLED desligado):"} ${p.method} ${p.url}`,
    };
  }
  const body = {
    rule: { id: rt.rule.id, name: rt.rule.name },
    event: ctx.event ?? null,
    entity: ctx.entity ? { type: ctx.entityType, id: ctx.entity.id } : null,
    clientId: ctx.client?.id ?? null,
    payload: ctx.payload,
    sentAt: nowIso(),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(p.url, {
      method: p.method,
      headers: p.method === "GET" ? undefined : { "content-type": "application/json" },
      body: p.method === "GET" ? undefined : JSON.stringify(body),
      signal: controller.signal,
      redirect: "manual",
    });
    if (!res.ok) return { type: "webhook", status: "erro", detail: `${p.method} ${p.url} respondeu HTTP ${res.status}` };
    return { type: "webhook", status: "sucesso", effect: "webhook chamado", detail: `${p.method} ${p.url} respondeu HTTP ${res.status}` };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { type: "webhook", status: "erro", detail: aborted ? `${p.method} ${p.url}: tempo esgotado (5s)` : `${p.method} ${p.url}: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearTimeout(timer);
  }
};

export const ACTION_REGISTRY: Record<RuleActionType, ActionHandler> = {
  criar_tarefa: criarTarefa,
  notificar,
  mudar_status: mudarStatus,
  iniciar_sla: iniciarSla,
  criar_handoff: criarHandoff,
  criar_plano_sucesso: criarPlanoSucesso,
  webhook,
};

/** Executa uma ação isolando erros (validação ou execução) em um resultado "erro". */
export async function runAction(action: RuleAction, ctx: AutomationContext, rt: ActionRuntime): Promise<ActionOutcome> {
  const handler = ACTION_REGISTRY[action.type];
  if (!handler) return { type: action.type, status: "erro", detail: `Ação desconhecida: ${String(action.type)}` };
  try {
    return await handler(action.params ?? {}, ctx, rt);
  } catch (error) {
    const message = error instanceof Error && "issues" in error ? `parâmetros inválidos (${(error as { issues: { message: string }[] }).issues[0]?.message ?? ""})` : error instanceof Error ? error.message : String(error);
    return { type: action.type, status: "erro", detail: `${ACTION_TYPE_LABELS[action.type]}: ${message}` };
  }
}

/** Resumo de uma ação para a lista de regras. */
export function describeAction(action: RuleAction): string {
  const p = action.params ?? {};
  const s = (k: string) => (typeof p[k] === "string" ? String(p[k]) : "");
  switch (action.type) {
    case "criar_tarefa":
      return `Tarefa "${s("title")}"${s("assignee") ? ` → ${s("assignee")}` : ""}`;
    case "notificar":
      return `Notificar ${Array.isArray(p.to) ? (p.to as string[]).join(", ") : s("to") || "responsável"}`;
    case "mudar_status":
      return `${s("collection")}.${s("field")} = ${s("value")}`;
    case "iniciar_sla":
      return `SLA ${s("ruleKey")}`;
    case "criar_handoff":
      return `Handoff → ${DEPARTMENT_LABELS[(s("department") || s("toDepartment")) as DepartmentKey] ?? s("department")}`;
    case "criar_plano_sucesso":
      return `Plano "${s("objective")}"`;
    case "webhook":
      return `${s("method") || "POST"} ${s("url")}`;
  }
}

