import "server-only";
/**
 * Motor de automações: TRIGGER → CONDIÇÃO → AÇÃO.
 *
 * - Regras de evento: `handleAutomationEvent` é registrado como handler "*" (ver
 *   src/server/events/handlers/automations.ts). Para cada evento carrega (cache de 30s) as regras
 *   ativas com trigger.type "evento" e eventType igual, monta o contexto { event, payload, entity,
 *   client, cs, sla, department } e executa as ações em sequência pelo registro (actions-registry.ts).
 * - Regras agendadas que varrem registros: `runEntityScan` (chamado pelo scheduler) avalia cada
 *   registro em aberto e dispara uma vez por registro até que ele mude (updatedAt > última execução).
 *
 * Cada execução grava `automation_runs` (sucesso/erro/ignorada + detalhe) e atualiza
 * runCount/lastRunAt da regra; execuções com efeito emitem `automation.executed` (na timeline do
 * cliente quando a ação o afeta).
 *
 * Proteção contra laço: as ações rodam dentro de um AsyncLocalStorage com a cadeia de regras e a
 * profundidade. Eventos gerados nesse escopo recebem payload.__automation = ruleId (e
 * __automationDepth); a mesma regra nunca dispara de novo na própria cadeia e a profundidade máxima
 * de automações encadeadas é 3.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { FieldValue } from "firebase-admin/firestore";
import { col, create, getById, getManyByIds, list, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { COLLECTIONS, type AutomationRule, type Client, type CsAccount, type DomainEvent, type SlaInstance } from "@/domain/types";
import { DEPARTMENT_KEYS, type DepartmentKey } from "@/domain/constants";
import { describeCondition, evaluateConditions } from "./conditions";
import {
  AUTOMATION_ACTOR,
  ENTITY_COLLECTIONS,
  ENTITY_DEPARTMENT,
  departmentInfo,
  runAction,
  subjectLabel,
  type AutomationContext,
} from "./actions-registry";
import {
  CONDITION_OPERATORS,
  SCAN_ENTITIES,
  SWEEP_DEFINITIONS,
  normalizeSchedule,
  type ActionOutcome,
  type AutomationRuleRecord,
  type AutomationRunRecord,
  type ConditionResult,
  type RuleAction,
  type RuleCondition,
  type RuleTrigger,
  type ScanEntity,
} from "./schemas";

export const MAX_AUTOMATION_DEPTH = 3;
const RULE_CACHE_MS = 30_000;

interface AutomationScope {
  chain: string[];
  depth: number;
}

export const automationScope = new AsyncLocalStorage<AutomationScope>();

// ---------------------------------------------------------------------------
// Leitura e normalização das regras
// ---------------------------------------------------------------------------

/** Caminhos antigos do seed por tipo de evento → caminhos reais do contexto. */
const LEGACY_PATHS: Partial<Record<string, Record<string, string>>> = {
  // customer.health_changed traz { from, to, score }; a adoção fica na conta de CS.
  "customer.health_changed": { "payload.level": "payload.to", "payload.adoptionPct": "cs.adoptionPct" },
};

/**
 * Ajusta regras gravadas em formatos anteriores (seed): frequência em cron, regra agendada sem
 * alvo explícito (inferido pelo prefixo das condições), caminhos antigos e criar_handoff.toDepartment.
 */
export function normalizeRule(raw: AutomationRule | AutomationRuleRecord): AutomationRuleRecord {
  const src = raw as AutomationRuleRecord;
  const trigger: RuleTrigger = { ...src.trigger };
  const legacy = (trigger.eventType && LEGACY_PATHS[trigger.eventType]) || {};
  const conditions: RuleCondition[] = (src.conditions ?? [])
    .filter((c) => c && typeof c.path === "string" && (CONDITION_OPERATORS as readonly string[]).includes(c.operator))
    .map((c) => ({ ...c, path: legacy[c.path] ?? c.path }));

  if (trigger.type === "agendado") {
    trigger.schedule = normalizeSchedule(trigger.schedule);
    if (trigger.sweep && !(trigger.sweep in SWEEP_DEFINITIONS)) trigger.sweep = undefined;
    if (!trigger.sweep && !trigger.entity) {
      const prefix = conditions.map((c) => c.path.split(".")[0]).find((p) => (SCAN_ENTITIES as readonly string[]).includes(p));
      if (prefix) trigger.entity = prefix as ScanEntity;
    }
  } else {
    delete trigger.schedule;
    delete trigger.sweep;
    delete trigger.entity;
  }

  const actions: RuleAction[] = (src.actions ?? []).map((a) => {
    const params = { ...(a.params ?? {}) };
    if (a.type === "criar_handoff" && params.department === undefined && typeof params.toDepartment === "string") {
      params.department = params.toDepartment;
      delete params.toDepartment;
      delete params.stageKey;
    }
    return { type: a.type, params };
  });

  return { ...src, trigger, conditions, actions, active: src.active !== false, runCount: typeof src.runCount === "number" ? src.runCount : 0 };
}

let rulesCache: { at: number; rules: AutomationRuleRecord[] } | null = null;

export function invalidateRulesCache(): void {
  rulesCache = null;
}

/** Regras ativas (normalizadas), com cache de 30 segundos por instância do servidor. */
export async function loadActiveRules(): Promise<AutomationRuleRecord[]> {
  if (rulesCache && Date.now() - rulesCache.at < RULE_CACHE_MS) return rulesCache.rules;
  const raw = await list<AutomationRule>(COLLECTIONS.automationRules, { where: [["active", "==", true]] });
  rulesCache = { at: Date.now(), rules: raw.map(normalizeRule) };
  return rulesCache.rules;
}

// ---------------------------------------------------------------------------
// Contexto
// ---------------------------------------------------------------------------

type EntityRecord = Record<string, unknown> & { id: string };

export interface ContextPreload {
  clients?: Map<string, Client>;
  csByClient?: Map<string, CsAccount>;
}

function isDepartment(value: unknown): value is DepartmentKey {
  return typeof value === "string" && (DEPARTMENT_KEYS as readonly string[]).includes(value);
}

export async function buildContext(
  rule: Pick<AutomationRuleRecord, "id" | "name">,
  input: { event?: DomainEvent; entityType?: string; entity?: EntityRecord },
  preload: ContextPreload = {},
): Promise<AutomationContext> {
  const { event } = input;
  const payload = (event?.payload ?? {}) as Record<string, unknown>;
  const entityType = input.entityType ?? event?.entityType;
  let entity = input.entity;
  if (!entity && event?.entityType && event.entityId && ENTITY_COLLECTIONS[event.entityType]) {
    entity = (await getById<EntityRecord & { organizationId: string; createdAt: string; updatedAt: string }>(ENTITY_COLLECTIONS[event.entityType], event.entityId)) ?? undefined;
  }

  const clientId =
    event?.clientId ??
    (typeof entity?.clientId === "string" ? entity.clientId : undefined) ??
    (entityType === "client" ? entity?.id : undefined) ??
    (typeof payload.clientId === "string" ? payload.clientId : undefined);
  const client = clientId ? (preload.clients?.get(clientId) ?? (await getById<Client>(COLLECTIONS.clients, clientId)) ?? undefined) : undefined;

  let cs: CsAccount | undefined;
  if (client) {
    if (preload.csByClient) cs = preload.csByClient.get(client.id);
    else {
      const accounts = await list<CsAccount>(COLLECTIONS.csAccounts, { where: [["clientId", "==", client.id]] });
      cs = accounts.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
    }
  }

  let sla: SlaInstance | undefined;
  if (entityType === "sla_instance" && entity) sla = entity as unknown as SlaInstance;
  else if (typeof payload.slaInstanceId === "string") sla = (await getById<SlaInstance>(COLLECTIONS.slaInstances, payload.slaInstanceId)) ?? undefined;

  const deptKey = [event?.department, entity?.departmentId, entity?.department, entityType ? ENTITY_DEPARTMENT[entityType] : undefined, sla?.department].find(isDepartment);

  const ctx: AutomationContext = {
    now: nowIso(),
    rule: { id: rule.id, name: rule.name },
    event: event
      ? {
          id: event.id,
          type: event.type,
          title: event.title,
          description: event.description,
          occurredAt: event.occurredAt,
          actorId: event.actorId,
          actorName: event.actorName,
          entityType: event.entityType,
          entityId: event.entityId,
          clientId: event.clientId,
          department: event.department,
        }
      : undefined,
    payload,
    entityType,
    entity,
    client,
    cs,
    sla,
    department: deptKey ? await departmentInfo(deptKey) : undefined,
  };
  // Apelido pelo tipo (opportunity.ownerId, lead.temperature, ticket.priority...).
  if (entityType && entity && !(entityType in ctx)) ctx[entityType] = entity;
  return ctx;
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

export interface RuleExecution {
  status: AutomationRunRecord["status"];
  detail: string;
  conditions: ConditionResult[];
  actions: ActionOutcome[];
  runId?: string;
  subject: string;
  clientId?: string;
  entityType?: string;
  entityId?: string;
}

export interface ExecuteInput {
  event?: DomainEvent;
  entityType?: string;
  entity?: EntityRecord;
  trigger: "evento" | "agendado" | "manual";
}

export interface ExecuteOptions {
  simulate?: boolean;
  chain?: string[];
  depth?: number;
  /** "matched": não grava execuções ignoradas (varreduras de muitos registros). */
  record?: "all" | "matched";
  preload?: ContextPreload;
}

function formatActual(value: unknown): string {
  if (value === null || value === undefined || value === "") return "vazio";
  return Array.isArray(value) ? value.join(", ") : String(value);
}

async function recordRun(rule: AutomationRuleRecord, exec: RuleExecution, input: ExecuteInput, depth: number): Promise<string> {
  const run = await create<AutomationRunRecord>(COLLECTIONS.automationRuns, {
    ruleId: rule.id,
    ruleName: rule.name,
    eventId: input.event?.id,
    eventType: input.event?.type,
    status: exec.status,
    detail: exec.detail.slice(0, 1000),
    ranAt: nowIso(),
    trigger: input.trigger,
    entityType: exec.entityType,
    entityId: exec.entityId,
    clientId: exec.clientId,
    actions: exec.actions,
    conditions: exec.conditions,
    depth,
  });
  return run.id;
}

/** Soma uma execução na regra (incremento atômico; não passa por stripUndefined). */
export async function bumpRuleRun(ruleId: string): Promise<void> {
  const now = nowIso();
  await col(COLLECTIONS.automationRules).doc(ruleId).update({ runCount: FieldValue.increment(1), lastRunAt: now, updatedAt: now });
}

/** Grava um automation_run avulso (varreduras nativas ligadas a regras agendadas, laço bloqueado). */
export async function recordStandaloneRun(rule: Pick<AutomationRuleRecord, "id" | "name">, data: Pick<AutomationRunRecord, "status" | "detail"> & Partial<AutomationRunRecord>): Promise<string> {
  const run = await create<AutomationRunRecord>(COLLECTIONS.automationRuns, { ...data, ruleId: rule.id, ruleName: rule.name, ranAt: data.ranAt ?? nowIso(), detail: data.detail?.slice(0, 1000) });
  return run.id;
}

async function emitExecuted(rule: AutomationRuleRecord, exec: RuleExecution, ctx: AutomationContext, runId: string, depth: number, eventId?: string): Promise<void> {
  const effects = Array.from(new Set(exec.actions.filter((o) => o.status === "sucesso" || o.status === "simulada").map((o) => o.effect).filter((e): e is string => Boolean(e))));
  const affectsClient = exec.actions.some((o) => o.status === "sucesso" && o.clientId);
  const summary = effects.length > 0 ? effects.join(", ") : exec.status === "erro" ? "falha na execução" : "executada";
  await emitEvent({
    type: "automation.executed",
    actor: AUTOMATION_ACTOR,
    clientId: ctx.client?.id,
    entity: { type: "automation_rule", id: rule.id },
    title: `Automação ${rule.name}: ${summary}`,
    description: exec.detail.slice(0, 500),
    department: ctx.department?.key,
    payload: { ruleId: rule.id, runId, status: exec.status, eventId: eventId ?? null, entityType: exec.entityType ?? null, entityId: exec.entityId ?? null, __automation: rule.id, __automationDepth: depth },
    timeline: affectsClient,
  });
}

/** Avalia as condições e executa (ou simula) as ações de uma regra para um evento ou registro. */
export async function executeRule(rule: AutomationRuleRecord, input: ExecuteInput, options: ExecuteOptions = {}): Promise<RuleExecution> {
  const simulate = options.simulate === true;
  const depth = options.depth ?? 1;
  const ctx = await buildContext(rule, input, options.preload);
  const base = { subject: subjectLabel(ctx), clientId: ctx.client?.id, entityType: ctx.entityType, entityId: ctx.entity?.id };
  const { passed, results } = evaluateConditions(rule.conditions, ctx);

  if (!passed) {
    const failed = results.find((r) => !r.ok)!;
    const exec: RuleExecution = {
      ...base,
      status: "ignorada",
      detail: `Condição não atendida: ${describeCondition({ path: failed.path, operator: failed.operator, value: failed.expected })} (valor atual: ${formatActual(failed.actual)})`,
      conditions: results,
      actions: [],
    };
    if (!simulate && options.record !== "matched") exec.runId = await recordRun(rule, exec, input, depth);
    return exec;
  }

  const scope: AutomationScope = { chain: options.chain ?? [rule.id], depth };
  const outcomes: ActionOutcome[] = [];
  await automationScope.run(scope, async () => {
    for (const action of rule.actions) {
      outcomes.push(await runAction(action, ctx, { simulate, rule, actor: AUTOMATION_ACTOR, eventId: input.event?.id }));
    }
  });

  const status: RuleExecution["status"] = outcomes.some((o) => o.status === "erro")
    ? "erro"
    : outcomes.some((o) => o.status === "sucesso" || o.status === "simulada")
      ? "sucesso"
      : "ignorada";
  const exec: RuleExecution = {
    ...base,
    status,
    detail: outcomes.map((o) => o.detail).join(" · ") || "Nenhuma ação configurada",
    conditions: results,
    actions: outcomes,
  };
  if (simulate) return exec;

  exec.runId = await recordRun(rule, exec, input, depth);
  if (status !== "ignorada") {
    await bumpRuleRun(rule.id);
    await automationScope.run(scope, () => emitExecuted(rule, exec, ctx, exec.runId!, depth, input.event?.id));
  }
  return exec;
}

// ---------------------------------------------------------------------------
// Handler de eventos
// ---------------------------------------------------------------------------

/** Marca no evento persistido que ele foi gerado por uma automação (auditoria da cadeia). */
async function markEvent(event: DomainEvent, scope: AutomationScope): Promise<void> {
  if (typeof event.payload?.__automation === "string") return;
  const marker = { __automation: scope.chain[scope.chain.length - 1], __automationDepth: scope.depth };
  event.payload = { ...(event.payload ?? {}), ...marker };
  await update<DomainEvent>(COLLECTIONS.events, event.id, { payload: event.payload });
}

/** Handler "*": dispara as regras de evento ativas cujo eventType é o tipo do evento. */
export async function handleAutomationEvent(event: DomainEvent): Promise<void> {
  const scope = automationScope.getStore();
  if (scope) await markEvent(event, scope);

  const rules = (await loadActiveRules()).filter((r) => r.trigger.type === "evento" && r.trigger.eventType === event.type);
  if (rules.length === 0) return;

  const marker = typeof event.payload?.__automation === "string" ? (event.payload.__automation as string) : undefined;
  const chain = scope?.chain ?? (marker ? [marker] : []);
  const depth = scope?.depth ?? (marker ? Number(event.payload.__automationDepth ?? 1) || 1 : 0);

  for (const rule of rules) {
    // Evento gerado pela própria regra (direta ou indiretamente): ignora para não entrar em laço.
    if (chain.includes(rule.id)) continue;
    try {
      if (depth >= MAX_AUTOMATION_DEPTH) {
        await recordStandaloneRun(rule, {
          status: "ignorada",
          detail: `Limite de ${MAX_AUTOMATION_DEPTH} automações encadeadas atingido (cadeia: ${chain.join(" → ")})`,
          eventId: event.id,
          eventType: event.type,
          trigger: "evento",
          depth: depth + 1,
        });
        continue;
      }
      await executeRule(rule, { event, trigger: "evento" }, { chain: [...chain, rule.id], depth: depth + 1 });
    } catch (error) {
      console.error(`[automacoes] falha na regra ${rule.id} para ${event.type}`, error);
      await recordStandaloneRun(rule, { status: "erro", detail: error instanceof Error ? error.message : String(error), eventId: event.id, eventType: event.type, trigger: "evento" }).catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// Regras agendadas que varrem registros
// ---------------------------------------------------------------------------

const SCAN_SOURCES: Record<ScanEntity, { collection: (typeof COLLECTIONS)[keyof typeof COLLECTIONS]; open: (e: Record<string, unknown>) => boolean }> = {
  opportunity: { collection: COLLECTIONS.opportunities, open: (e) => e.stage !== "ganho" && e.stage !== "perdido" },
  lead: { collection: COLLECTIONS.leads, open: (e) => e.status === "novo" || e.status === "em_contato" || e.status === "qualificado" },
  task: { collection: COLLECTIONS.tasks, open: (e) => e.status === "aberta" || e.status === "em_andamento" || e.status === "aguardando" },
  ticket: { collection: COLLECTIONS.supportTickets, open: (e) => e.status !== "resolvido" && e.status !== "fechado" },
  project: { collection: COLLECTIONS.implementationProjects, open: (e) => e.status !== "concluida" && e.status !== "cancelada" },
  renewal: { collection: COLLECTIONS.renewals, open: (e) => e.status === "aguardando" || e.status === "em_negociacao" },
  client: { collection: COLLECTIONS.clients, open: (e) => e.status === "ativo" || e.status === "em_implantacao" },
};

export interface ScanResult {
  scanned: number;
  matched: number;
  executed: number;
  skipped: number;
  errors: number;
  samples: RuleExecution[];
}

/**
 * Avalia a regra em cada registro em aberto do tipo configurado. Em modo real, um registro só volta
 * a disparar a regra depois de alterado (updatedAt posterior à última execução com sucesso).
 */
export async function runEntityScan(rule: AutomationRuleRecord, options: { simulate?: boolean; sampleLimit?: number } = {}): Promise<ScanResult> {
  const alias = rule.trigger.entity;
  if (!alias) return { scanned: 0, matched: 0, executed: 0, skipped: 0, errors: 0, samples: [] };
  const source = SCAN_SOURCES[alias];
  const entities = (await list<EntityRecord & { organizationId: string; createdAt: string; updatedAt: string }>(source.collection)).filter(source.open);

  const clientIds = entities.map((e) => (alias === "client" ? e.id : typeof e.clientId === "string" ? e.clientId : "")).filter(Boolean);
  const [clients, accounts, runs] = await Promise.all([
    getManyByIds<Client>(COLLECTIONS.clients, clientIds),
    list<CsAccount>(COLLECTIONS.csAccounts),
    options.simulate ? Promise.resolve([] as AutomationRunRecord[]) : list<AutomationRunRecord>(COLLECTIONS.automationRuns, { where: [["ruleId", "==", rule.id]] }),
  ]);
  const csByClient = new Map<string, CsAccount>();
  for (const a of accounts.sort((x, y) => (x.updatedAt < y.updatedAt ? -1 : 1))) csByClient.set(a.clientId, a);
  const lastSuccess = new Map<string, string>();
  for (const r of runs) if (r.status === "sucesso" && r.entityId && (lastSuccess.get(r.entityId) ?? "") < r.ranAt) lastSuccess.set(r.entityId, r.ranAt);

  const result: ScanResult = { scanned: entities.length, matched: 0, executed: 0, skipped: 0, errors: 0, samples: [] };
  for (const entity of entities) {
    const last = lastSuccess.get(entity.id);
    if (last && last >= (entity.updatedAt ?? "")) {
      result.skipped += 1;
      continue;
    }
    try {
      const exec = await executeRule(rule, { entityType: alias, entity, trigger: "agendado" }, { simulate: options.simulate, record: "matched", preload: { clients, csByClient } });
      if (exec.conditions.every((c) => c.ok)) {
        result.matched += 1;
        if (exec.status === "sucesso") result.executed += 1;
        if (exec.status === "erro") result.errors += 1;
        if (result.samples.length < (options.sampleLimit ?? 10)) result.samples.push(exec);
      }
    } catch (error) {
      result.errors += 1;
      console.error(`[automacoes] regra agendada ${rule.id} falhou no registro ${entity.id}`, error);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Teste no editor
// ---------------------------------------------------------------------------

export interface SimulationResult {
  kind: "evento" | "varredura_registros" | "varredura_nativa";
  message: string;
  event?: { id: string; type: string; title: string; occurredAt: string; clientId?: string };
  execution?: RuleExecution;
  scan?: Omit<ScanResult, "samples"> & { samples: RuleExecution[] };
}

/** Roda a regra em modo simulação (sem efeitos) contra o evento mais recente do tipo ou os registros em aberto. */
export async function simulateRule(rule: AutomationRuleRecord): Promise<SimulationResult> {
  if (rule.trigger.type === "evento") {
    if (!rule.trigger.eventType) return { kind: "evento", message: "Escolha o evento que dispara a regra." };
    const events = await list<DomainEvent>(COLLECTIONS.events, { where: [["type", "==", rule.trigger.eventType]] });
    const latest = events.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))[0];
    if (!latest) return { kind: "evento", message: `Nenhum evento "${rule.trigger.eventType}" registrado ainda para testar.` };
    const execution = await executeRule(rule, { event: latest, trigger: "manual" }, { simulate: true });
    const passed = execution.conditions.every((c) => c.ok);
    return {
      kind: "evento",
      message: passed ? "As condições passam: as ações abaixo seriam executadas." : "As condições não passam para este evento: nada seria executado.",
      event: { id: latest.id, type: latest.type, title: latest.title, occurredAt: latest.occurredAt, clientId: latest.clientId },
      execution,
    };
  }
  if (rule.trigger.sweep) {
    const def = SWEEP_DEFINITIONS[rule.trigger.sweep];
    return { kind: "varredura_nativa", message: `Executaria a varredura "${def.label}" (${def.description}) na frequência escolhida. Use "Executar varreduras agora" para rodá-la de verdade.` };
  }
  const scan = await runEntityScan(rule, { simulate: true, sampleLimit: 10 });
  return {
    kind: "varredura_registros",
    message: `${scan.matched} de ${scan.scanned} registro(s) em aberto atendem às condições${scan.matched > 0 ? "; exemplos do que aconteceria abaixo" : ""}.`,
    scan,
  };
}
