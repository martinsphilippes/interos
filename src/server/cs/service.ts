import "server-only";
/**
 * Serviço de Customer Success: regras de negócio SEM validação de sessão. Usado pelas Server Actions
 * (que validam sessão e entrada), pelos handlers de evento (src/server/events/handlers/cs.ts) e pelas
 * varreduras diárias (saúde e renovações).
 *
 * Toda mutação relevante emite evento (timeline, notificações, KPIs). Erros de regra são lançados como
 * Error com mensagem em português (as actions devolvem a mensagem ao usuário).
 */
import { addDays, addMonths } from "date-fns";
import { create, getById, getManyByIds, list, newId, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { registerHandler } from "@/server/events/emit";
import { registerCsHandlers } from "@/server/events/handlers/cs";
import { notify } from "@/server/notifications";
import { assignTaskInternal, cancelTaskInternal, completeTaskInternal, createTaskInternal, reopenTaskInternal } from "@/server/tasks/service";
import { getDepartmentManager, updateStepChecklist } from "@/server/workflow/service";
import { createOpportunity } from "@/server/sales/service";
import { formatCurrency, formatDate } from "@/lib/format";
import { shortId } from "@/lib/utils";
import {
  COLLECTIONS,
  type ChurnRecord,
  type Client,
  type ClientProduct,
  type Contract,
  type CsAccount,
  type DomainEvent,
  type HealthScore,
  type Opportunity,
  type Product,
  type Renewal,
  type Settings,
  type SuccessPlan,
  type Task,
  type User,
  type UserRef,
  type WorkflowInstance,
  type WorkflowStep,
} from "@/domain/types";
import type { HealthLevel } from "@/domain/constants";
import { computeHealthFromInput, getHealthConfig, loadAllHealthInputs, loadHealthInput, type HealthConfig, type HealthInput, type HealthResult } from "./health";
import { CHECKPOINT_TYPE_LABELS, CHURN_REASON_LABELS, HEALTH_FACTORS, HEALTH_LEVEL_LABELS, HEALTH_LEVEL_RANK, type CheckpointType } from "./schemas";

// Registro idempotente dos handlers de CS (ver src/server/events/handlers/cs.ts).
registerCsHandlers(registerHandler);

export const CS_SYSTEM_ACTOR: UserRef = { id: "system", name: "INTEROS (automação)" };

const DAY_MS = 86_400_000;
/** Janela em que a renovação é criada automaticamente (dias antes do fim do contrato). */
export const RENEWAL_WINDOW_DAYS = 90;
/** Antecedência da tarefa de preparação da renovação e abertura da janela de negociação. */
export const RENEWAL_LEAD_DAYS = 60;
/** Contratos vencendo neste horizonte aparecem na tela de renovações, mesmo sem renovação criada. */
export const RENEWAL_LOOKAHEAD_DAYS = 120;
const SWEEP_INTERVAL_MS = 24 * 3600_000;
const OPEN_TASK = new Set<Task["status"]>(["aberta", "em_andamento", "aguardando"]);
const OPEN_OPPORTUNITY = new Set<Opportunity["stage"]>(["qualificacao", "diagnostico", "proposta", "negociacao", "fechamento"]);

/** Ação de plano com o vínculo à tarefa real (campo aditivo; ver "needs" do módulo). */
export type PlanAction = SuccessPlan["actions"][number] & { taskId?: string };
export type SuccessPlanWithTasks = Omit<SuccessPlan, "actions"> & { actions: PlanAction[] };

const daysFromNowIso = (days: number) => addDays(new Date(), days).toISOString();

async function loadClient(id: string): Promise<Client> {
  const client = await getById<Client>(COLLECTIONS.clients, id);
  if (!client) throw new Error("Cliente não encontrado");
  return client;
}

async function csManager(): Promise<User | null> {
  return getDepartmentManager("cs");
}

// ---------------------------------------------------------------------------
// Configurações auxiliares (varreduras e gate de ativação)
// ---------------------------------------------------------------------------

async function readSettingDoc(key: string): Promise<Settings | null> {
  const docs = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", key]] });
  return docs[0] ?? null;
}

/** Mescla campos em `settings/<key>.value` (merge profundo do Firestore) criando o documento se preciso. */
async function mergeSetting(key: string, patch: Record<string, unknown>, description: string): Promise<void> {
  const doc = await readSettingDoc(key);
  if (doc) await update<Settings>(COLLECTIONS.settings, doc.id, { value: patch });
  else await create<Settings>(COLLECTIONS.settings, { key, value: patch, description }, `setting_${key}`);
}

async function claimSweep(field: string): Promise<boolean> {
  const doc = await readSettingDoc("sweeps");
  const last = doc?.value?.[field];
  if (typeof last === "string" && Date.now() - new Date(last).getTime() < SWEEP_INTERVAL_MS) return false;
  // Marca antes de rodar para que acessos simultâneos não disparem a mesma varredura.
  await mergeSetting("sweeps", { [field]: nowIso() }, "Última execução das varreduras automáticas.");
  return true;
}

export interface ActivationSettings {
  adocaoMinimaPct: number;
  exigePlano: boolean;
}
const ACTIVATION_DEFAULTS: ActivationSettings = { adocaoMinimaPct: 30, exigePlano: true };

/** Critérios do gate de CS (`settings/cs_ativacao`); cria o documento com o padrão quando não existe. */
export async function getActivationSettings(): Promise<ActivationSettings> {
  const doc = await readSettingDoc("cs_ativacao");
  if (!doc) {
    await create<Settings>(COLLECTIONS.settings, { key: "cs_ativacao", value: { ...ACTIVATION_DEFAULTS }, description: "Critérios do gate de ativação do cliente pelo Customer Success." }, "setting_cs_ativacao");
    return { ...ACTIVATION_DEFAULTS };
  }
  const v = doc.value as Partial<ActivationSettings>;
  return {
    adocaoMinimaPct: typeof v.adocaoMinimaPct === "number" ? v.adocaoMinimaPct : ACTIVATION_DEFAULTS.adocaoMinimaPct,
    exigePlano: typeof v.exigePlano === "boolean" ? v.exigePlano : ACTIVATION_DEFAULTS.exigePlano,
  };
}

// ---------------------------------------------------------------------------
// Conta de CS
// ---------------------------------------------------------------------------

export async function getCsAccount(clientId: string): Promise<CsAccount | null> {
  const accounts = await list<CsAccount>(COLLECTIONS.csAccounts, { where: [["clientId", "==", clientId]] });
  return accounts.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null;
}

/** Garante a conta de CS do cliente (idempotente: ID determinístico por cliente). */
export async function ensureCsAccount(clientId: string, actor: UserRef = CS_SYSTEM_ACTOR): Promise<CsAccount> {
  const existing = await getCsAccount(clientId);
  if (existing) return existing;
  const client = await loadClient(clientId);
  const ownerId = client.ownerCsId ?? (await csManager())?.id ?? actor.id;
  const contracts = await list<Contract>(COLLECTIONS.contracts, { where: [["clientId", "==", clientId]] });
  const renewalDate = contracts
    .filter((c) => c.status !== "cancelado" && c.endDate)
    .map((c) => c.endDate!)
    .sort()[0];
  const account = await create<CsAccount>(
    COLLECTIONS.csAccounts,
    {
      clientId,
      ownerId,
      adoptionPct: 0,
      riskLevel: client.healthLevel ?? "saudavel",
      riskReasons: [],
      // Primeiro contato (boas-vindas) em até 7 dias.
      nextInteractionAt: client.nextInteractionAt ?? daysFromNowIso(7),
      renewalDate,
      createdBy: actor.id,
    },
    `csacc_${clientId}`,
  );
  const patch: Partial<Client> = {};
  if (!client.ownerCsId) patch.ownerCsId = ownerId;
  if (!client.nextInteractionAt) patch.nextInteractionAt = account.nextInteractionAt;
  if (Object.keys(patch).length > 0) await update<Client>(COLLECTIONS.clients, clientId, patch);
  return account;
}

const FACTOR_PREFIXES = HEALTH_FACTORS.map((f) => `${f.label}:`);
/** Motivos de risco gerados pelo motor começam com o rótulo do fator; os demais vêm dos checkpoints. */
const isFactorReason = (reason: string) => FACTOR_PREFIXES.some((p) => reason.startsWith(p));

// ---------------------------------------------------------------------------
// Health score: recálculo, histórico e eventos
// ---------------------------------------------------------------------------

export interface RecalculateResult extends HealthResult {
  clientId: string;
  previousLevel?: HealthLevel;
  previousScore?: number;
  changed: boolean;
}

/**
 * Recalcula e grava o health score: novo documento em `health_scores` (histórico), cliente
 * (healthScore/healthLevel) e conta de CS (riskLevel/riskReasons: fatores abaixo de 50 viram motivos).
 * Mudança de nível emite `customer.health_changed`; virar risco emite `customer.risk.detected`.
 */
export async function recalculateClientHealth(clientId: string, actor: UserRef = CS_SYSTEM_ACTOR, preloaded?: { input: HealthInput; config: HealthConfig }): Promise<RecalculateResult | null> {
  const now = new Date();
  const input = preloaded?.input ?? (await loadHealthInput(clientId, now));
  if (!input) return null;
  const config = preloaded?.config ?? (await getHealthConfig());
  const result = computeHealthFromInput(input, config, now);
  const { client, account } = input;

  await create<HealthScore>(COLLECTIONS.healthScores, { clientId, score: result.score, level: result.level, factors: result.factors, computedAt: result.computedAt, createdBy: actor.id });
  await update<Client>(COLLECTIONS.clients, clientId, { healthScore: result.score, healthLevel: result.level });

  const factorReasons = result.factors.filter((f) => f.value < 50).map((f) => `${f.label}: ${f.note ?? `${f.value}/100`}`);
  if (account) {
    const manual = account.riskReasons.filter((r) => !isFactorReason(r));
    await update<CsAccount>(COLLECTIONS.csAccounts, account.id, { riskLevel: result.level, riskReasons: [...factorReasons, ...manual] });
  }

  const previousLevel = client.healthLevel;
  const changed = previousLevel !== result.level;
  const worsened = previousLevel ? HEALTH_LEVEL_RANK[result.level] > HEALTH_LEVEL_RANK[previousLevel] : result.level !== "saudavel";
  if (changed && (previousLevel || worsened)) {
    await emitEvent({
      type: "customer.health_changed",
      actor,
      clientId,
      entity: { type: "client", id: clientId },
      title: previousLevel
        ? `Saúde do cliente: ${HEALTH_LEVEL_LABELS[previousLevel]} → ${HEALTH_LEVEL_LABELS[result.level]} (score ${result.score})`
        : `Saúde do cliente calculada: ${HEALTH_LEVEL_LABELS[result.level]} (score ${result.score})`,
      description: factorReasons.length > 0 ? factorReasons.join(" · ") : undefined,
      department: "cs",
      payload: { from: previousLevel ?? null, to: result.level, score: result.score, previousScore: client.healthScore ?? null, worsened },
    });
  }
  if (result.level === "risco" && previousLevel !== "risco") {
    await emitEvent({
      type: "customer.risk.detected",
      actor,
      clientId,
      entity: { type: "client", id: clientId },
      title: `Cliente em risco: ${client.tradeName} (score ${result.score})`,
      description: factorReasons.join(" · ") || undefined,
      department: "cs",
      payload: { score: result.score, reasons: factorReasons, ownerId: account?.ownerId ?? client.ownerCsId ?? null },
    });
  }
  return { ...result, clientId, previousLevel, previousScore: client.healthScore, changed };
}

export interface RecalculateAllResult {
  count: number;
  changed: number;
  risk: number;
  ranAt: string;
}

/** Recalcula toda a carteira com uma leitura em lote. */
export async function recalculateAllHealth(actor: UserRef = CS_SYSTEM_ACTOR): Promise<RecalculateAllResult> {
  const now = new Date();
  const [inputs, config] = await Promise.all([loadAllHealthInputs(now), getHealthConfig()]);
  let changed = 0;
  let risk = 0;
  for (const input of inputs) {
    const r = await recalculateClientHealth(input.client.id, actor, { input, config });
    if (r?.changed) changed += 1;
    if (r?.level === "risco") risk += 1;
  }
  return { count: inputs.length, changed, risk, ranAt: now.toISOString() };
}

/** Recálculo automático no máximo 1x por dia (chamado ao abrir /cs/saude). */
export async function maybeRunHealthSweep(): Promise<RecalculateAllResult | null> {
  if (!(await claimSweep("csHealthLastRunAt"))) return null;
  const result = await recalculateAllHealth(CS_SYSTEM_ACTOR);
  await mergeSetting("sweeps", { csHealthLastResult: result }, "Última execução das varreduras automáticas.");
  return result;
}

export async function getLastHealthSweep(): Promise<{ ranAt?: string; result?: RecalculateAllResult }> {
  const doc = await readSettingDoc("sweeps");
  const v = (doc?.value ?? {}) as { csHealthLastRunAt?: string; csHealthLastResult?: RecalculateAllResult };
  return { ranAt: v.csHealthLastRunAt, result: v.csHealthLastResult };
}

/** Handler: eventos de suporte e financeiro recalculam a saúde do cliente. */
export async function recalculateHealthFromEvent(event: DomainEvent): Promise<void> {
  if (!event.clientId) return;
  const client = await getById<Client>(COLLECTIONS.clients, event.clientId);
  if (!client || client.status === "cancelado") return;
  await recalculateClientHealth(event.clientId, CS_SYSTEM_ACTOR);
}

// ---------------------------------------------------------------------------
// Checkpoints e contatos
// ---------------------------------------------------------------------------

export interface CheckpointData {
  clientId: string;
  type: CheckpointType;
  summary: string;
  satisfaction: number;
  adoptionPct: number;
  risks: string[];
  nextSteps: string[];
  createTasks: boolean;
  nextInDays: number;
}

export interface CheckpointResult {
  accountId: string;
  eventId: string;
  tasksCreated: number;
  nextInteractionAt: string;
  health: RecalculateResult | null;
}

export async function registerCheckpoint(data: CheckpointData, actor: UserRef): Promise<CheckpointResult> {
  const client = await loadClient(data.clientId);
  if (client.status === "cancelado") throw new Error("Cliente cancelado não recebe checkpoints");
  const account = await ensureCsAccount(client.id, actor);
  const now = nowIso();
  const next = addDays(new Date(now), data.nextInDays).toISOString();
  const autoReasons = account.riskReasons.filter(isFactorReason);

  await update<CsAccount>(COLLECTIONS.csAccounts, account.id, {
    lastInteractionAt: now,
    nextInteractionAt: next,
    adoptionPct: data.adoptionPct,
    satisfaction: data.satisfaction,
    riskReasons: [...autoReasons, ...data.risks],
  });
  await update<Client>(COLLECTIONS.clients, client.id, { lastInteractionAt: now, nextInteractionAt: next });

  const description = [
    data.summary,
    data.risks.length > 0 ? `Riscos: ${data.risks.join("; ")}` : null,
    data.nextSteps.length > 0 ? `Próximos passos: ${data.nextSteps.join("; ")}` : null,
    `Satisfação percebida ${data.satisfaction}/10 · adoção ${data.adoptionPct}% · próxima interação ${formatDate(next)}`,
  ]
    .filter(Boolean)
    .join("\n");
  const event = await emitEvent({
    type: "customer.checkpoint.completed",
    actor,
    clientId: client.id,
    entity: { type: "cs_account", id: account.id },
    title: `Checkpoint (${CHECKPOINT_TYPE_LABELS[data.type].toLowerCase()}) registrado por ${actor.name}`,
    description,
    department: "cs",
    payload: {
      checkpointType: data.type,
      satisfaction: data.satisfaction,
      adoptionPct: data.adoptionPct,
      previousAdoptionPct: account.adoptionPct,
      risks: data.risks,
      nextSteps: data.nextSteps,
      nextInteractionAt: next,
      summary: data.summary,
    },
  });

  let tasksCreated = 0;
  if (data.createTasks && data.nextSteps.length > 0) {
    const dueAt = daysFromNowIso(Math.min(data.nextInDays, 7));
    for (const step of data.nextSteps) {
      await createTaskInternal(
        {
          title: step,
          description: `Próximo passo do checkpoint de ${formatDate(now)} com ${client.tradeName}.`,
          clientId: client.id,
          assigneeId: account.ownerId,
          departmentId: "cs",
          priority: "media",
          dueAt,
          processType: "cs",
          processId: account.id,
          origin: "evento",
          sourceEventId: event.id,
          tags: ["checkpoint"],
        },
        actor,
      );
      tasksCreated += 1;
    }
  }

  const health = await recalculateClientHealth(client.id, actor);
  return { accountId: account.id, eventId: event.id, tasksCreated, nextInteractionAt: next, health };
}

/** Handler: ligação, WhatsApp ou visita registrada por uma pessoa conta como interação da conta de CS. */
export async function touchInteraction(event: DomainEvent): Promise<void> {
  if (!event.clientId) return;
  const account = await getCsAccount(event.clientId);
  if (!account) return;
  if (account.lastInteractionAt && account.lastInteractionAt >= event.occurredAt) return;
  await update<CsAccount>(COLLECTIONS.csAccounts, account.id, { lastInteractionAt: event.occurredAt });
}

// ---------------------------------------------------------------------------
// Planos de sucesso (ações viram tarefas reais, sincronizadas nos dois sentidos)
// ---------------------------------------------------------------------------

export interface PlanActionData {
  id?: string;
  description: string;
  responsibleId: string;
  dueAt: string;
}

export interface SuccessPlanData {
  clientId: string;
  ownerId: string;
  objective: string;
  checkpointAt?: string;
  actions: PlanActionData[];
}

async function createPlanTask(planId: string, client: Client, objective: string, action: PlanActionData, responsible: User, actor: UserRef, origin: SuccessPlan["origin"], sourceEventId?: string): Promise<Task> {
  return createTaskInternal(
    {
      title: `Plano de sucesso: ${action.description}`,
      description: `Objetivo do plano: ${objective}`,
      clientId: client.id,
      assigneeId: responsible.id,
      departmentId: responsible.departmentId,
      priority: origin === "automacao" ? "alta" : "media",
      dueAt: action.dueAt,
      processType: "cs",
      processId: planId,
      origin: origin === "automacao" ? "automacao" : "manual",
      sourceEventId,
      tags: ["plano-de-sucesso"],
    },
    actor,
  );
}

async function loadResponsibles(ids: string[]): Promise<Map<string, User>> {
  const users = await getManyByIds<User>(COLLECTIONS.users, ids);
  for (const id of new Set(ids)) {
    const u = users.get(id);
    if (!u || u.active === false) throw new Error("Responsável não encontrado ou inativo");
  }
  return users;
}

export async function createSuccessPlan(data: SuccessPlanData, actor: UserRef, origin: SuccessPlan["origin"] = "manual", sourceEventId?: string): Promise<SuccessPlan> {
  const client = await loadClient(data.clientId);
  const users = await loadResponsibles([data.ownerId, ...data.actions.map((a) => a.responsibleId)]);
  const planId = newId(COLLECTIONS.successPlans);
  const actions: PlanAction[] = [];
  for (const a of data.actions) {
    const task = await createPlanTask(planId, client, data.objective, a, users.get(a.responsibleId)!, actor, origin, sourceEventId);
    actions.push({ id: shortId("act"), description: a.description, responsibleId: a.responsibleId, dueAt: a.dueAt, done: false, taskId: task.id });
  }
  const plan = await create<SuccessPlan>(
    COLLECTIONS.successPlans,
    { clientId: client.id, ownerId: data.ownerId, objective: data.objective, actions, checkpointAt: data.checkpointAt, status: "ativo", origin, createdBy: actor.id },
    planId,
  );
  await emitEvent({
    type: "success_plan.created",
    actor,
    clientId: client.id,
    entity: { type: "success_plan", id: plan.id },
    title: `Plano de sucesso criado${origin === "automacao" ? " por automação" : ""}: ${plan.objective}`,
    description: `${actions.length} ação(ões) · responsável ${users.get(data.ownerId)?.name ?? ""}${plan.checkpointAt ? ` · checkpoint ${formatDate(plan.checkpointAt)}` : ""}`,
    department: "cs",
    payload: { origin, ownerId: plan.ownerId, actions: actions.length, sourceEventId: sourceEventId ?? null },
  });
  if (data.ownerId !== actor.id) {
    await notify({
      userIds: [data.ownerId],
      kind: "acao",
      title: `Plano de sucesso de ${client.tradeName}`,
      body: plan.objective,
      href: `/cs/planos?plano=${plan.id}`,
      entity: { type: "success_plan", id: plan.id },
    });
  }
  return plan;
}

async function loadPlan(id: string): Promise<SuccessPlan> {
  const plan = await getById<SuccessPlan>(COLLECTIONS.successPlans, id);
  if (!plan) throw new Error("Plano de sucesso não encontrado");
  return plan;
}

export async function updateSuccessPlan(planId: string, data: SuccessPlanData, actor: UserRef): Promise<SuccessPlan> {
  const plan = await loadPlan(planId);
  if (plan.status !== "ativo") throw new Error("Plano encerrado não pode ser editado");
  if (plan.clientId !== data.clientId) throw new Error("O cliente do plano não pode ser alterado");
  const client = await loadClient(plan.clientId);
  const users = await loadResponsibles([data.ownerId, ...data.actions.map((a) => a.responsibleId)]);
  const current = new Map((plan.actions as PlanAction[]).map((a) => [a.id, a]));
  const taskIds = (plan.actions as PlanAction[]).map((a) => a.taskId).filter((id): id is string => Boolean(id));
  const tasks = await getManyByIds<Task>(COLLECTIONS.tasks, taskIds);

  const next: PlanAction[] = [];
  for (const input of data.actions) {
    const existing = input.id ? current.get(input.id) : undefined;
    if (!existing) {
      const task = await createPlanTask(plan.id, client, data.objective, input, users.get(input.responsibleId)!, actor, plan.origin);
      next.push({ id: shortId("act"), description: input.description, responsibleId: input.responsibleId, dueAt: input.dueAt, done: false, taskId: task.id });
      continue;
    }
    current.delete(existing.id);
    const task = existing.taskId ? tasks.get(existing.taskId) : undefined;
    if (task && OPEN_TASK.has(task.status)) {
      if (existing.description !== input.description || existing.dueAt !== input.dueAt) {
        await update<Task>(COLLECTIONS.tasks, task.id, { title: `Plano de sucesso: ${input.description}`, dueAt: input.dueAt });
      }
      if (existing.responsibleId !== input.responsibleId) await assignTaskInternal(task, input.responsibleId, actor);
    }
    next.push({ ...existing, description: input.description, responsibleId: input.responsibleId, dueAt: input.dueAt });
  }
  // Ações removidas: cancela a tarefa ainda aberta.
  for (const removed of current.values()) {
    const task = removed.taskId ? tasks.get(removed.taskId) : undefined;
    if (task && OPEN_TASK.has(task.status)) await cancelTaskInternal(task, actor, "Ação removida do plano de sucesso");
  }

  await update<SuccessPlan>(COLLECTIONS.successPlans, plan.id, { objective: data.objective, ownerId: data.ownerId, checkpointAt: data.checkpointAt, actions: next });
  await emitEvent({
    type: "note.added",
    actor,
    clientId: plan.clientId,
    entity: { type: "success_plan", id: plan.id },
    title: `Plano de sucesso atualizado: ${data.objective}`,
    description: `${next.length} ação(ões)${current.size > 0 ? ` · ${current.size} removida(s)` : ""}`,
    department: "cs",
    payload: { successPlanId: plan.id, actions: next.length },
  });
  return { ...plan, objective: data.objective, ownerId: data.ownerId, checkpointAt: data.checkpointAt, actions: next };
}

/** Marca/desmarca uma ação e conclui/reabre a tarefa ligada. */
export async function setPlanActionDone(planId: string, actionId: string, done: boolean, actor: UserRef): Promise<void> {
  const plan = await loadPlan(planId);
  if (plan.status !== "ativo") throw new Error("Plano encerrado não pode ser alterado");
  const actions = plan.actions as PlanAction[];
  const action = actions.find((a) => a.id === actionId);
  if (!action) throw new Error("Ação não encontrada no plano");
  if (action.done === done) return;
  const now = nowIso();
  const nextActions = actions.map((a) => (a.id === actionId ? { ...a, done, doneAt: done ? now : undefined } : a));
  await update<SuccessPlan>(COLLECTIONS.successPlans, plan.id, { actions: nextActions });

  const task = action.taskId ? await getById<Task>(COLLECTIONS.tasks, action.taskId) : null;
  if (task) {
    // A tarefa emite o evento (task.completed / task.status_changed); o handler encontra a ação já sincronizada.
    if (done && OPEN_TASK.has(task.status)) await completeTaskInternal(task, actor);
    if (!done && task.status === "concluida") await reopenTaskInternal(task, actor);
    return;
  }
  await emitEvent({
    type: "note.added",
    actor,
    clientId: plan.clientId,
    entity: { type: "success_plan", id: plan.id },
    title: `${done ? "Ação concluída" : "Ação reaberta"} no plano de sucesso: ${action.description}`,
    department: "cs",
    payload: { successPlanId: plan.id, actionId, done },
  });
}

/** Handler: tarefa de plano concluída (ou reaberta) atualiza a ação correspondente pelo taskId. */
export async function syncPlanActionFromTask(event: DomainEvent, done: boolean): Promise<void> {
  let planId = typeof event.payload.processId === "string" ? event.payload.processId : undefined;
  if (!done) {
    // task.status_changed não traz o processo: lê a tarefa.
    const task = event.entityId ? await getById<Task>(COLLECTIONS.tasks, event.entityId) : null;
    if (!task || task.processType !== "cs" || !task.processId) return;
    planId = task.processId;
  }
  if (!planId) return;
  const plan = await getById<SuccessPlan>(COLLECTIONS.successPlans, planId);
  if (!plan) return;
  const actions = plan.actions as PlanAction[];
  const idx = actions.findIndex((a) => a.taskId === event.entityId);
  if (idx < 0 || actions[idx].done === done) return;
  const nextActions = actions.map((a, i) => (i === idx ? { ...a, done, doneAt: done ? event.occurredAt : undefined } : a));
  await update<SuccessPlan>(COLLECTIONS.successPlans, plan.id, { actions: nextActions });
}

/** Encerra o plano (concluído ou cancelado) com o resultado; tarefas de ações pendentes são canceladas. */
export async function closeSuccessPlan(planId: string, status: "concluido" | "cancelado", result: string, actor: UserRef): Promise<void> {
  const plan = await loadPlan(planId);
  if (plan.status !== "ativo") throw new Error("O plano já está encerrado");
  const pending = (plan.actions as PlanAction[]).filter((a) => !a.done && a.taskId);
  const tasks = await getManyByIds<Task>(COLLECTIONS.tasks, pending.map((a) => a.taskId!));
  for (const task of tasks.values()) if (OPEN_TASK.has(task.status)) await cancelTaskInternal(task, actor, `Plano de sucesso ${status === "concluido" ? "concluído" : "cancelado"}`);
  await update<SuccessPlan>(COLLECTIONS.successPlans, plan.id, { status, result });
  const done = plan.actions.filter((a) => a.done).length;
  await emitEvent({
    type: "note.added",
    actor,
    clientId: plan.clientId,
    entity: { type: "success_plan", id: plan.id },
    title: `Plano de sucesso ${status === "concluido" ? "concluído" : "cancelado"}: ${plan.objective}`,
    description: `Resultado: ${result} · ${done}/${plan.actions.length} ação(ões) concluída(s)`,
    department: "cs",
    payload: { successPlanId: plan.id, status, result },
  });
}

// ---------------------------------------------------------------------------
// Risco detectado (handler)
// ---------------------------------------------------------------------------

export async function onRiskDetected(event: DomainEvent): Promise<void> {
  if (!event.clientId) return;
  const client = await getById<Client>(COLLECTIONS.clients, event.clientId);
  if (!client || client.status === "cancelado") return;
  const account = await ensureCsAccount(client.id);
  const ownerId = account.ownerId;
  const reasons = Array.isArray(event.payload.reasons) ? (event.payload.reasons as string[]) : [];

  const plans = await list<SuccessPlan>(COLLECTIONS.successPlans, { where: [["clientId", "==", client.id]] });
  let plan = plans.find((p) => p.status === "ativo") ?? null;
  if (!plan) {
    const topic = reasons[0]?.split(":")[0]?.toLowerCase();
    plan = await createSuccessPlan(
      {
        clientId: client.id,
        ownerId,
        objective: `Recuperar a saúde de ${client.tradeName}${topic ? ` (${topic})` : ""}`,
        checkpointAt: daysFromNowIso(15),
        actions: [
          { description: "Contato com o decisor para entender os riscos", responsibleId: ownerId, dueAt: daysFromNowIso(2) },
          { description: "Plano de ação para os fatores críticos do score", responsibleId: ownerId, dueAt: daysFromNowIso(5) },
          { description: "Checkpoint de acompanhamento da recuperação", responsibleId: ownerId, dueAt: daysFromNowIso(15) },
        ],
      },
      CS_SYSTEM_ACTOR,
      "automacao",
      event.id,
    );
  }

  // Tarefa imediata para o responsável (uma por risco detectado; não duplica se já houver aberta).
  const tasks = await list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", account.id]] });
  const hasOpen = tasks.some((t) => OPEN_TASK.has(t.status) && t.tags.includes("risco"));
  if (!hasOpen) {
    await createTaskInternal(
      {
        title: `Atuar no risco de ${client.tradeName}`,
        description: reasons.length > 0 ? `Motivos: ${reasons.join("; ")}` : "Saúde do cliente entrou em risco.",
        clientId: client.id,
        assigneeId: ownerId,
        departmentId: "cs",
        priority: "alta",
        dueAt: daysFromNowIso(1),
        processType: "cs",
        processId: account.id,
        origin: "evento",
        sourceEventId: event.id,
        tags: ["risco"],
      },
      CS_SYSTEM_ACTOR,
    );
  }

  const manager = await csManager();
  await notify({
    userIds: [manager?.id ?? "", ownerId].filter((id) => id && id !== event.actorId),
    kind: "critica",
    title: `Cliente em risco: ${client.tradeName}`,
    body: reasons.length > 0 ? reasons.slice(0, 3).join(" · ") : event.title,
    href: `/cs/saude?cliente=${client.id}`,
    entity: { type: "client", id: client.id },
    eventId: event.id,
  });
}

/** Escala o risco ao gestor de CS (e ao gestor direto de quem escalou): notificação crítica + timeline. */
export async function escalateRisk(clientId: string, note: string, actor: UserRef & { managerId?: string }): Promise<number> {
  const client = await loadClient(clientId);
  const manager = await csManager();
  const targets = Array.from(new Set([manager?.id, actor.managerId].filter((id): id is string => Boolean(id) && id !== actor.id)));
  if (targets.length === 0) throw new Error("Nenhum gestor encontrado para receber a escalação");
  const event = await emitEvent({
    type: "note.added",
    actor,
    clientId: client.id,
    entity: { type: "client", id: client.id },
    title: `Risco escalado ao gestor por ${actor.name}`,
    description: note,
    department: "cs",
    payload: { escalation: true, targets },
  });
  await notify({
    userIds: targets,
    kind: "critica",
    title: `Risco escalado: ${client.tradeName}`,
    body: `${actor.name}: ${note}`,
    href: `/cs/riscos`,
    entity: { type: "client", id: client.id },
    eventId: event.id,
  });
  return targets.length;
}

// ---------------------------------------------------------------------------
// Ativação (gate de CS no workflow)
// ---------------------------------------------------------------------------

export interface ActivationCheck {
  ok: boolean;
  missing: string[];
  settings: ActivationSettings;
  adoptionPct?: number;
  ownerId?: string;
  activePlan?: { id: string; objective: string };
  activatedAt?: string;
  /** A jornada do cliente está na etapa de CS (ativação pendente). */
  stageOpen: boolean;
}

export async function checkActivation(clientId: string): Promise<ActivationCheck> {
  const client = await loadClient(clientId);
  const [settings, account, plans] = await Promise.all([
    getActivationSettings(),
    getCsAccount(clientId),
    list<SuccessPlan>(COLLECTIONS.successPlans, { where: [["clientId", "==", clientId]] }),
  ]);
  const activePlan = plans.find((p) => p.status === "ativo");
  const ownerId = account?.ownerId ?? client.ownerCsId;
  const missing: string[] = [];
  if (!account) missing.push("Conta de CS não criada (registre um checkpoint)");
  else if (account.adoptionPct < settings.adocaoMinimaPct) missing.push(`Adoção de ${account.adoptionPct}% abaixo do mínimo de ${settings.adocaoMinimaPct}%`);
  if (!ownerId) missing.push("Responsável de CS não definido");
  if (settings.exigePlano && !activePlan) missing.push("Plano de sucesso ativo");
  return {
    ok: missing.length === 0,
    missing,
    settings,
    adoptionPct: account?.adoptionPct,
    ownerId,
    activePlan: activePlan ? { id: activePlan.id, objective: activePlan.objective } : undefined,
    activatedAt: account?.activatedAt,
    stageOpen: client.currentStage === "cs",
  };
}

export async function activateCustomer(clientId: string, actor: UserRef): Promise<{ activatedAt: string }> {
  const client = await loadClient(clientId);
  if (client.status === "cancelado") throw new Error("Cliente cancelado não pode ser ativado");
  const check = await checkActivation(clientId);
  if (!check.ok) throw new Error(`Gate de ativação não atendido: ${check.missing.join("; ")}`);
  const account = (await getCsAccount(clientId))!;
  const now = nowIso();
  const activatedAt = account.activatedAt ?? now;
  await update<CsAccount>(COLLECTIONS.csAccounts, account.id, { activatedAt });
  const clientPatch: Partial<Client> = {};
  if (client.status !== "ativo") clientPatch.status = "ativo";
  if (!client.activatedAt) clientPatch.activatedAt = now;
  if (!client.ownerCsId) clientPatch.ownerCsId = account.ownerId;
  if (Object.keys(clientPatch).length > 0) await update<Client>(COLLECTIONS.clients, client.id, clientPatch);

  // Marca no checklist do gate de CS o que os dados já comprovam, para a etapa avançar sem exceção.
  if (client.workflowInstanceId) {
    const instance = await getById<WorkflowInstance>(COLLECTIONS.workflowInstances, client.workflowInstanceId);
    const step = instance?.currentStageKey === "cs" && instance.currentStepId ? await getById<WorkflowStep>(COLLECTIONS.workflowSteps, instance.currentStepId) : null;
    if (step && step.status !== "concluida" && step.status !== "pulada") {
      const proven = new Set(["adocao", "plano"]);
      if (account.lastInteractionAt) proven.add("boas_vindas");
      if (account.nextInteractionAt && account.nextInteractionAt > now) proven.add("checkpoint");
      const updates = (step.checklist ?? []).filter((c) => !c.done && proven.has(c.id)).map((c) => ({ id: c.id, done: true }));
      if (updates.length > 0) {
        try {
          await updateStepChecklist(step.id, updates, actor);
        } catch (error) {
          console.warn("[cs] não foi possível marcar o checklist da etapa de CS", error);
        }
      }
    }
  }

  const event = await emitEvent({
    type: "customer.activated",
    actor,
    clientId: client.id,
    entity: { type: "cs_account", id: account.id },
    title: `Cliente ativado pelo Customer Success`,
    description: `Adoção ${account.adoptionPct}%${check.activePlan ? ` · plano "${check.activePlan.objective}"` : ""}`,
    department: "cs",
    payload: { adoptionPct: account.adoptionPct, successPlanId: check.activePlan?.id ?? null, ownerId: account.ownerId },
  });
  const manager = await csManager();
  if (manager && manager.id !== actor.id) {
    await notify({ userIds: [manager.id], kind: "informativa", title: `Cliente ativado: ${client.tradeName}`, body: `Ativado por ${actor.name}`, href: `/clientes/${client.id}?aba=cs`, entity: { type: "client", id: client.id }, eventId: event.id });
  }
  return { activatedAt };
}

/** Handler: go-live garante a conta de CS (caso a implantação não a tenha criado). */
export async function onGoLive(event: DomainEvent): Promise<void> {
  if (!event.clientId) return;
  await ensureCsAccount(event.clientId, CS_SYSTEM_ACTOR);
}

// ---------------------------------------------------------------------------
// Renovações
// ---------------------------------------------------------------------------

const OPEN_RENEWAL = new Set<Renewal["status"]>(["aguardando", "em_negociacao"]);

async function renewalOwner(client: Client): Promise<string> {
  if (client.ownerCsId) return client.ownerCsId;
  const account = await getCsAccount(client.id);
  if (account) return account.ownerId;
  const manager = await csManager();
  if (!manager) throw new Error("Defina o responsável de CS do cliente");
  return manager.id;
}

async function createRenewalRecord(contract: Contract, client: Client, actor: UserRef): Promise<Renewal> {
  const ownerId = await renewalOwner(client);
  const renewal = await create<Renewal>(COLLECTIONS.renewals, {
    clientId: client.id,
    contractId: contract.id,
    ownerId,
    dueDate: contract.endDate!,
    windowOpensAt: addDays(new Date(contract.endDate!), -RENEWAL_LEAD_DAYS).toISOString(),
    risk: client.healthLevel ?? "saudavel",
    status: "aguardando",
    createdBy: actor.id,
  });
  const account = await getCsAccount(client.id);
  if (account) await update<CsAccount>(COLLECTIONS.csAccounts, account.id, { renewalDate: contract.endDate });
  return renewal;
}

async function emitRenewalDue(renewal: Renewal, contract: Contract | undefined, client: Client | undefined): Promise<void> {
  const daysLeft = Math.ceil((new Date(renewal.dueDate).getTime() - Date.now()) / DAY_MS);
  await emitEvent({
    type: "renewal.due",
    actor: CS_SYSTEM_ACTOR,
    clientId: renewal.clientId,
    entity: { type: "renewal", id: renewal.id },
    title: `Renovação entrou na janela: contrato ${contract?.number ?? renewal.contractId} vence ${daysLeft >= 0 ? `em ${daysLeft} dia(s)` : `há ${-daysLeft} dia(s)`}`,
    description: `${client?.tradeName ?? "Cliente"} · vencimento ${formatDate(renewal.dueDate)}${contract ? ` · ${formatCurrency(contract.monthlyTotal)}/mês` : ""}`,
    department: "cs",
    payload: { renewalId: renewal.id, contractId: renewal.contractId, dueDate: renewal.dueDate, ownerId: renewal.ownerId, daysLeft },
  });
}

export interface EnsureRenewalsResult {
  created: number;
  dueEmitted: number;
  ranAt: string;
}

/**
 * Cria renovações para contratos liberados que vencem dentro da janela (90 dias) e emite
 * `renewal.due` uma única vez por renovação aberta dentro da janela.
 */
export async function ensureRenewals(actor: UserRef = CS_SYSTEM_ACTOR): Promise<EnsureRenewalsResult> {
  const [contracts, renewals, clients, dueEvents] = await Promise.all([
    list<Contract>(COLLECTIONS.contracts, { where: [["status", "==", "liberado"]] }),
    list<Renewal>(COLLECTIONS.renewals),
    list<Client>(COLLECTIONS.clients),
    list<DomainEvent>(COLLECTIONS.events, { where: [["type", "==", "renewal.due"]] }),
  ]);
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const contractById = new Map(contracts.map((c) => [c.id, c]));
  const horizon = addDays(new Date(), RENEWAL_WINDOW_DAYS).toISOString();
  const staleLimit = addDays(new Date(), -RENEWAL_LEAD_DAYS).toISOString();
  const all = [...renewals];
  let created = 0;

  for (const contract of contracts) {
    if (!contract.endDate || contract.endDate > horizon || contract.endDate < staleLimit) continue;
    const client = clientById.get(contract.clientId);
    if (!client || client.status === "cancelado") continue;
    const exists = renewals.some((r) => r.contractId === contract.id && (OPEN_RENEWAL.has(r.status) || r.dueDate.slice(0, 10) === contract.endDate!.slice(0, 10)));
    if (exists) continue;
    all.push(await createRenewalRecord(contract, client, actor));
    created += 1;
  }

  const emitted = new Set(dueEvents.map((e) => e.entityId));
  let dueEmitted = 0;
  for (const renewal of all) {
    if (renewal.status !== "aguardando" || renewal.dueDate > horizon || emitted.has(renewal.id)) continue;
    await emitRenewalDue(renewal, contractById.get(renewal.contractId), clientById.get(renewal.clientId));
    dueEmitted += 1;
  }
  return { created, dueEmitted, ranAt: nowIso() };
}

/** Varredura de renovações no máximo 1x por dia (chamada ao abrir /cs/renovacoes). */
export async function maybeRunRenewalSweep(): Promise<EnsureRenewalsResult | null> {
  if (!(await claimSweep("csRenewalsLastRunAt"))) return null;
  const result = await ensureRenewals(CS_SYSTEM_ACTOR);
  await mergeSetting("sweeps", { csRenewalsLastResult: result }, "Última execução das varreduras automáticas.");
  return result;
}

/** Criação manual para contratos vencendo além da janela automática. */
export async function createRenewalForContract(contractId: string, actor: UserRef): Promise<Renewal> {
  const contract = await getById<Contract>(COLLECTIONS.contracts, contractId);
  if (!contract) throw new Error("Contrato não encontrado");
  if (contract.status !== "liberado") throw new Error("Só contratos liberados (ativos) têm renovação");
  if (!contract.endDate) throw new Error("O contrato não tem data de término");
  const renewals = await list<Renewal>(COLLECTIONS.renewals, { where: [["contractId", "==", contractId]] });
  if (renewals.some((r) => OPEN_RENEWAL.has(r.status))) throw new Error("Já existe uma renovação aberta para este contrato");
  const client = await loadClient(contract.clientId);
  const renewal = await createRenewalRecord(contract, client, actor);
  await emitRenewalDue(renewal, contract, client);
  return renewal;
}

/** Handler de renewal.due: tarefa de preparação (60 dias antes do vencimento) e notificação ao responsável. */
export async function onRenewalDue(event: DomainEvent): Promise<void> {
  const renewal = await getById<Renewal>(COLLECTIONS.renewals, event.entityId!);
  if (!renewal || !OPEN_RENEWAL.has(renewal.status)) return;
  const tasks = await list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", renewal.id]] });
  if (tasks.some((t) => t.processType === "renewal" && OPEN_TASK.has(t.status))) return;
  const [client, contract] = await Promise.all([getById<Client>(COLLECTIONS.clients, renewal.clientId), getById<Contract>(COLLECTIONS.contracts, renewal.contractId)]);
  const leadDate = addDays(new Date(renewal.dueDate), -RENEWAL_LEAD_DAYS);
  const dueAt = (leadDate.getTime() > Date.now() ? leadDate : addDays(new Date(), 2)).toISOString();
  const daysLeft = Math.ceil((new Date(renewal.dueDate).getTime() - Date.now()) / DAY_MS);
  await createTaskInternal(
    {
      title: `Preparar renovação: ${client?.tradeName ?? "cliente"}`,
      description: `Contrato ${contract?.number ?? renewal.contractId} vence em ${formatDate(renewal.dueDate)}. Revise saúde, uso e condições antes de negociar.`,
      clientId: renewal.clientId,
      assigneeId: renewal.ownerId,
      departmentId: "cs",
      priority: daysLeft <= 30 ? "alta" : "media",
      dueAt,
      processType: "renewal",
      processId: renewal.id,
      origin: "evento",
      sourceEventId: event.id,
      tags: ["renovacao"],
    },
    CS_SYSTEM_ACTOR,
  );
  await notify({
    userIds: [renewal.ownerId],
    kind: daysLeft <= 30 ? "atencao" : "acao",
    title: `Renovação na janela: ${client?.tradeName ?? "cliente"}`,
    body: `Contrato vence em ${formatDate(renewal.dueDate)}${contract ? ` · ${formatCurrency(contract.monthlyTotal)}/mês` : ""}`,
    href: "/cs/renovacoes",
    entity: { type: "renewal", id: renewal.id },
    eventId: event.id,
  });
}

async function loadRenewal(id: string): Promise<Renewal> {
  const renewal = await getById<Renewal>(COLLECTIONS.renewals, id);
  if (!renewal) throw new Error("Renovação não encontrada");
  return renewal;
}

async function closeRenewalTasks(renewalId: string, actor: UserRef, outcome: "renovado" | "perdido"): Promise<void> {
  const tasks = await list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", renewalId]] });
  for (const task of tasks.filter((t) => t.processType === "renewal" && OPEN_TASK.has(t.status))) {
    if (outcome === "renovado") await completeTaskInternal(task, actor);
    else await cancelTaskInternal(task, actor, "Renovação perdida");
  }
}

export async function startRenewalNegotiation(renewalId: string, actor: UserRef): Promise<Task> {
  const renewal = await loadRenewal(renewalId);
  if (renewal.status !== "aguardando") throw new Error("A negociação só pode ser iniciada em renovações aguardando");
  const [client, contract] = await Promise.all([loadClient(renewal.clientId), getById<Contract>(COLLECTIONS.contracts, renewal.contractId)]);
  await update<Renewal>(COLLECTIONS.renewals, renewal.id, { status: "em_negociacao" });
  return createTaskInternal(
    {
      title: `Negociar renovação: ${client.tradeName}`,
      description: `Negociação iniciada por ${actor.name}. Contrato ${contract?.number ?? renewal.contractId} vence em ${formatDate(renewal.dueDate)}${contract ? ` · ${formatCurrency(contract.monthlyTotal)}/mês` : ""}.`,
      clientId: client.id,
      assigneeId: renewal.ownerId,
      departmentId: "cs",
      priority: "alta",
      dueAt: daysFromNowIso(3),
      processType: "renewal",
      processId: renewal.id,
      origin: "manual",
      tags: ["renovacao"],
    },
    actor,
  );
}

export async function completeRenewal(renewalId: string, termMonths: number, notes: string | undefined, actor: UserRef): Promise<{ newEndDate: string }> {
  const renewal = await loadRenewal(renewalId);
  if (!OPEN_RENEWAL.has(renewal.status)) throw new Error("Renovação já encerrada");
  const contract = await getById<Contract>(COLLECTIONS.contracts, renewal.contractId);
  if (!contract) throw new Error("Contrato da renovação não encontrado");
  const base = contract.endDate ?? renewal.dueDate;
  const newEndDate = addMonths(new Date(base), termMonths).toISOString();
  await update<Contract>(COLLECTIONS.contracts, contract.id, { endDate: newEndDate, termMonths });
  const result = notes ? `Renovado por ${termMonths} meses até ${formatDate(newEndDate)}. ${notes}` : `Renovado por ${termMonths} meses até ${formatDate(newEndDate)}.`;
  await update<Renewal>(COLLECTIONS.renewals, renewal.id, { status: "renovado", result });
  const account = await getCsAccount(renewal.clientId);
  if (account) await update<CsAccount>(COLLECTIONS.csAccounts, account.id, { renewalDate: newEndDate });
  await closeRenewalTasks(renewal.id, actor, "renovado");
  await emitEvent({
    type: "renewal.completed",
    actor,
    clientId: renewal.clientId,
    entity: { type: "renewal", id: renewal.id },
    title: `Contrato ${contract.number} renovado por ${termMonths} meses`,
    description: result,
    department: "cs",
    payload: { outcome: "renovado", contractId: contract.id, termMonths, newEndDate, previousEndDate: base, monthlyTotal: contract.monthlyTotal },
  });
  return { newEndDate };
}

export async function loseRenewal(renewalId: string, reason: string, actor: UserRef): Promise<{ clientId: string }> {
  const renewal = await loadRenewal(renewalId);
  if (!OPEN_RENEWAL.has(renewal.status)) throw new Error("Renovação já encerrada");
  const contract = await getById<Contract>(COLLECTIONS.contracts, renewal.contractId);
  await update<Renewal>(COLLECTIONS.renewals, renewal.id, { status: "perdido", result: reason });
  await closeRenewalTasks(renewal.id, actor, "perdido");
  await emitEvent({
    type: "renewal.completed",
    actor,
    clientId: renewal.clientId,
    entity: { type: "renewal", id: renewal.id },
    title: `Renovação perdida: contrato ${contract?.number ?? renewal.contractId}`,
    description: reason,
    department: "cs",
    payload: { outcome: "perdido", contractId: renewal.contractId, reason, monthlyTotal: contract?.monthlyTotal ?? null },
  });
  const manager = await csManager();
  if (manager && manager.id !== actor.id) {
    await notify({ userIds: [manager.id], kind: "atencao", title: "Renovação perdida", body: reason, href: `/cs/churn?registrar=${renewal.clientId}`, entity: { type: "renewal", id: renewal.id } });
  }
  return { clientId: renewal.clientId };
}

// ---------------------------------------------------------------------------
// Churn
// ---------------------------------------------------------------------------

export interface ChurnData {
  clientId: string;
  clientProductIds: string[];
  reasonCategory: ChurnRecord["reasonCategory"];
  reason: string;
  responsibleId: string;
  date: string;
  context?: string;
}

export interface ChurnResult {
  churnRecordId: string;
  lostMrr: number;
  newMrr: number;
  fullChurn: boolean;
  cancelledContracts: number;
}

export async function registerChurn(data: ChurnData, actor: UserRef): Promise<ChurnResult> {
  const client = await loadClient(data.clientId);
  if (client.status === "cancelado") throw new Error("O cliente já está cancelado");
  const responsible = await getById<User>(COLLECTIONS.users, data.responsibleId);
  if (!responsible) throw new Error("Responsável não encontrado");
  const [products, contracts, renewals, plans] = await Promise.all([
    list<ClientProduct>(COLLECTIONS.clientProducts, { where: [["clientId", "==", client.id]] }),
    list<Contract>(COLLECTIONS.contracts, { where: [["clientId", "==", client.id]] }),
    list<Renewal>(COLLECTIONS.renewals, { where: [["clientId", "==", client.id]] }),
    list<SuccessPlan>(COLLECTIONS.successPlans, { where: [["clientId", "==", client.id]] }),
  ]);
  const ids = new Set(data.clientProductIds);
  const selected = products.filter((p) => ids.has(p.id) && p.status !== "cancelado");
  if (selected.length !== ids.size) throw new Error("Produto inválido ou já cancelado");

  const cancelledAt = new Date(data.date).toISOString();
  for (const p of selected) await update<ClientProduct>(COLLECTIONS.clientProducts, p.id, { status: "cancelado", cancelledAt });

  // Receita perdida: mensalidades que estavam faturando (ativos ou suspensos).
  const lostMrr = selected.filter((p) => p.status === "ativo" || p.status === "suspenso").reduce((s, p) => s + p.monthlyValue, 0);
  const remaining = products.filter((p) => !ids.has(p.id) && p.status !== "cancelado");
  const newMrr = remaining.filter((p) => p.status === "ativo").reduce((s, p) => s + p.monthlyValue, 0);
  const fullChurn = remaining.length === 0;

  // Contratos: cancela os que ficaram sem produto vigente (pelo vínculo contractId; sem vínculo, pelos itens).
  const cancelledProductIds = new Set(selected.map((p) => p.productId));
  const remainingByContract = new Map<string, number>();
  for (const p of remaining) if (p.contractId) remainingByContract.set(p.contractId, (remainingByContract.get(p.contractId) ?? 0) + 1);
  const cancelledContractIds: string[] = [];
  for (const c of contracts.filter((x) => x.status !== "cancelado")) {
    const linked = products.some((p) => p.contractId === c.id);
    const cancel = fullChurn || (linked ? !remainingByContract.has(c.id) && selected.some((p) => p.contractId === c.id) : c.items.length > 0 && c.items.every((i) => cancelledProductIds.has(i.productId)));
    if (!cancel) continue;
    await update<Contract>(COLLECTIONS.contracts, c.id, { status: "cancelado" });
    cancelledContractIds.push(c.id);
  }
  for (const r of renewals.filter((x) => OPEN_RENEWAL.has(x.status) && (fullChurn || cancelledContractIds.includes(x.contractId)))) {
    await update<Renewal>(COLLECTIONS.renewals, r.id, { status: "perdido", result: `Cancelamento registrado: ${data.reason}` });
    await closeRenewalTasks(r.id, actor, "perdido");
  }

  const clientPatch: Partial<Client> = { mrr: Math.round(newMrr * 100) / 100 };
  if (fullChurn) clientPatch.status = "cancelado";
  await update<Client>(COLLECTIONS.clients, client.id, clientPatch);

  const record = await create<ChurnRecord>(COLLECTIONS.churnRecords, {
    clientId: client.id,
    productIds: selected.map((p) => p.productId),
    lostMrr: Math.round(lostMrr * 100) / 100,
    reason: data.reason,
    reasonCategory: data.reasonCategory,
    responsibleId: responsible.id,
    date: cancelledAt,
    context: data.context,
    origin: client.origin,
    createdBy: actor.id,
  });

  if (fullChurn) {
    for (const plan of plans.filter((p) => p.status === "ativo")) await closeSuccessPlan(plan.id, "cancelado", "Cliente cancelado", actor);
  }

  const names = selected.map((p) => p.productName).join(", ");
  const event = await emitEvent({
    type: "churn.registered",
    actor,
    clientId: client.id,
    entity: { type: "churn_record", id: record.id },
    title: fullChurn ? `Cancelamento do cliente registrado (${names})` : `Cancelamento parcial registrado: ${names}`,
    description: `${CHURN_REASON_LABELS[data.reasonCategory]}: ${data.reason} · MRR perdido ${formatCurrency(lostMrr)}${fullChurn ? "" : ` · MRR restante ${formatCurrency(newMrr)}`}`,
    department: "cs",
    payload: { churnRecordId: record.id, lostMrr, newMrr, full: fullChurn, reasonCategory: data.reasonCategory, productIds: record.productIds, cancelledContracts: cancelledContractIds },
  });
  if (fullChurn) {
    await emitEvent({
      type: "client.status_changed",
      actor,
      clientId: client.id,
      entity: { type: "client", id: client.id },
      title: `Status alterado para Cancelado`,
      description: `Motivo: ${CHURN_REASON_LABELS[data.reasonCategory]} — ${data.reason}`,
      department: "cs",
      payload: { from: client.status, to: "cancelado", reason: data.reason },
    });
  }
  const manager = await csManager();
  await notify({
    userIds: [manager?.id ?? "", client.ownerSalesId ?? ""].filter((id) => id && id !== actor.id),
    kind: "atencao",
    title: `${fullChurn ? "Cliente cancelado" : "Cancelamento parcial"}: ${client.tradeName}`,
    body: `${CHURN_REASON_LABELS[data.reasonCategory]} · MRR perdido ${formatCurrency(lostMrr)}`,
    href: "/cs/churn",
    entity: { type: "client", id: client.id },
    eventId: event.id,
  });
  return { churnRecordId: record.id, lostMrr, newMrr, fullChurn, cancelledContracts: cancelledContractIds.length };
}

// ---------------------------------------------------------------------------
// Upsell / cross-sell originado pelo CS
// ---------------------------------------------------------------------------

export async function createCsUpsell(input: { clientId: string; productId: string; need?: string }, actor: UserRef): Promise<Opportunity> {
  const client = await loadClient(input.clientId);
  if (client.status === "cancelado") throw new Error("Cliente cancelado");
  const [product, owned, opportunities, catalog] = await Promise.all([
    getById<Product>(COLLECTIONS.products, input.productId),
    list<ClientProduct>(COLLECTIONS.clientProducts, { where: [["clientId", "==", client.id]] }),
    list<Opportunity>(COLLECTIONS.opportunities, { where: [["clientId", "==", client.id]] }),
    list<Product>(COLLECTIONS.products),
  ]);
  if (!product || product.active === false) throw new Error("Produto não encontrado no catálogo");
  const ownedActive = owned.filter((p) => p.status !== "cancelado");
  if (ownedActive.some((p) => p.productId === product.id)) throw new Error(`O cliente já tem ${product.name} contratado`);
  if (opportunities.some((o) => OPEN_OPPORTUNITY.has(o.stage) && o.products.some((p) => p.productId === product.id))) throw new Error(`Já existe oportunidade aberta de ${product.name} para este cliente`);

  const categoryOf = new Map(catalog.map((p) => [p.id, p.category]));
  const ownedCategories = new Set(ownedActive.map((p) => categoryOf.get(p.productId)));
  const kind: Opportunity["kind"] = ownedCategories.has(product.category) ? "upsell" : "cross_sell";
  const ownerId = client.ownerSalesId ?? (await getDepartmentManager("vendas"))?.id ?? actor.id;

  const opp = await createOpportunity(
    {
      clientId: client.id,
      title: `${kind === "upsell" ? "Upsell" : "Cross-sell"} ${product.name} — ${client.tradeName}`,
      kind,
      ownerId,
      temperature: "morno",
      products: [{ productId: product.id, productName: product.name, quantity: 1, setupValue: product.setupPrice, monthlyValue: product.monthlyPrice, hardwareValue: product.hardwarePrice }],
      need: input.need ?? `Oportunidade identificada pelo Customer Success na carteira.`,
      nextAction: "Qualificar a oportunidade com o cliente",
      nextActionAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
    },
    { ...actor, departmentId: "cs" },
  );

  const event = await emitEvent({
    type: "upsell.created",
    actor,
    clientId: client.id,
    entity: { type: "opportunity", id: opp.id },
    title: `Oportunidade de ${kind === "upsell" ? "upsell" : "cross-sell"} gerada pelo CS: ${product.name}`,
    description: [input.need, opp.monthlyTotal > 0 ? `${formatCurrency(opp.monthlyTotal)}/mês` : null, opp.setupTotal > 0 ? `adesão ${formatCurrency(opp.setupTotal)}` : null].filter(Boolean).join(" · ") || undefined,
    department: "cs",
    payload: { productId: product.id, kind, monthlyTotal: opp.monthlyTotal, setupTotal: opp.setupTotal, ownerId, originDepartment: "cs" },
  });
  if (ownerId !== actor.id) {
    await notify({
      userIds: [ownerId],
      kind: "acao",
      title: `Nova oportunidade do CS: ${product.name}`,
      body: `${client.tradeName} · indicada por ${actor.name}`,
      href: `/vendas/oportunidades?oportunidade=${opp.id}`,
      entity: { type: "opportunity", id: opp.id },
      eventId: event.id,
    });
  }
  return opp;
}
