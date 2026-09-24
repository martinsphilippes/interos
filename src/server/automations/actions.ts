"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { col, create, getById, nowIso, remove, stripUndefined } from "@/server/db";
import { emitEvent } from "@/server/events";
import { COLLECTIONS, type ActionResult, type AutomationRule, type CurrentUser } from "@/domain/types";
import { AGENT_KINDS, type AgentRun } from "@/server/ai/types";
import { runAgent } from "@/server/ai/agents";
import { invalidateRulesCache, normalizeRule, simulateRule, type SimulationResult } from "./engine";
import { runSweeps, type SweepReport } from "./scheduler";
import { getPathSuggestions } from "./queries";
import {
  ACTION_PARAM_SCHEMAS,
  ruleIdSchema,
  ruleInputSchema,
  runSweepsSchema,
  toggleRuleSchema,
  zodMessage,
  type AutomationRuleRecord,
  type RuleAction,
  type RuleCondition,
} from "./schemas";

/**
 * Server Actions das automações (/admin/automacoes). Escrita só para administradores.
 * Padrão: requireUser → validação zod → mutação → emitEvent → revalidatePath.
 * `getAgentSuggestions` é aberta a qualquer usuário com acesso ao módulo do agente.
 */

class ActionError extends Error {}

async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isAdmin) throw new ActionError("Apenas administradores podem alterar automações");
  return user;
}

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  if (error instanceof ActionError) return { ok: false, error: error.message };
  console.error(`[automacoes] ${fallback}`, error);
  return { ok: false, error: error instanceof Error && error.message ? `${fallback}: ${error.message}` : fallback };
}

function revalidate(id?: string) {
  revalidatePath("/admin/automacoes");
  if (id) revalidatePath(`/admin/automacoes/${id}`);
}

/** Remove parâmetros vazios vindos do formulário antes de validar. */
function cleanParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === "" || v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      const items = v.filter((i) => i !== "" && i !== null && i !== undefined);
      if (items.length > 0) out[k] = items;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** Valor da condição com tipo: números e booleanos em texto viram número/booleano. */
function typedValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const v = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v === "true" || v === "false") return v === "true";
  return v;
}

function parseRule(input: unknown) {
  const raw = (input ?? {}) as { actions?: { type?: string; params?: Record<string, unknown> }[] };
  const cleaned = { ...raw, actions: (raw.actions ?? []).map((a) => ({ ...a, params: cleanParams(a.params ?? {}) })) };
  const data = ruleInputSchema.parse(cleaned);
  const conditions: RuleCondition[] = data.conditions.map((c) => stripUndefined({ path: c.path, operator: c.operator, value: c.operator === "exists" && (c.value === undefined || c.value === "") ? undefined : typedValue(c.value) }));
  const actions: RuleAction[] = data.actions.map((a) => ({ type: a.type, params: stripUndefined(ACTION_PARAM_SCHEMAS[a.type].parse(a.params) as Record<string, unknown>) }));
  const trigger =
    data.trigger.type === "evento"
      ? { type: "evento" as const, eventType: data.trigger.eventType }
      : stripUndefined({ type: "agendado" as const, schedule: data.trigger.schedule, sweep: data.trigger.sweep, entity: data.trigger.entity });
  return { id: data.id, name: data.name, description: data.description || undefined, active: data.active, trigger, conditions, actions };
}

export async function saveAutomationRule(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireAdmin();
    const rule = parseRule(input);
    const actor = { id: user.id, name: user.name };
    let id = rule.id;
    if (id) {
      const existing = await getById<AutomationRule>(COLLECTIONS.automationRules, id);
      if (!existing) throw new ActionError("Regra não encontrada");
      // update() substitui os campos inteiros (trigger/conditions/actions), sem mesclar chaves antigas.
      await col(COLLECTIONS.automationRules)
        .doc(id)
        .update(stripUndefined({ name: rule.name, description: rule.description ?? null, active: rule.active, trigger: rule.trigger, conditions: rule.conditions, actions: rule.actions, updatedAt: nowIso() }));
    } else {
      const created = await create<AutomationRuleRecord>(COLLECTIONS.automationRules, {
        name: rule.name,
        description: rule.description,
        active: rule.active,
        trigger: rule.trigger,
        conditions: rule.conditions,
        actions: rule.actions,
        runCount: 0,
        createdBy: user.id,
      });
      id = created.id;
    }
    invalidateRulesCache();
    await emitEvent({
      type: "automation.rule_updated",
      actor,
      entity: { type: "automation_rule", id },
      title: `${rule.id ? "Automação alterada" : "Automação criada"}: ${rule.name}`,
      description: `${rule.active ? "Ativa" : "Inativa"} · ${rule.conditions.length} condição(ões) · ${rule.actions.length} ação(ões)`,
      payload: { ruleId: id, created: !rule.id, active: rule.active, trigger: rule.trigger },
    });
    revalidate(id);
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a automação");
  }
}

export async function setAutomationRuleActive(input: unknown): Promise<ActionResult<{ active: boolean }>> {
  try {
    const user = await requireAdmin();
    const { id, active } = toggleRuleSchema.parse(input);
    const rule = await getById<AutomationRule>(COLLECTIONS.automationRules, id);
    if (!rule) throw new ActionError("Regra não encontrada");
    await col(COLLECTIONS.automationRules).doc(id).update({ active, updatedAt: nowIso() });
    invalidateRulesCache();
    await emitEvent({
      type: "automation.rule_updated",
      actor: { id: user.id, name: user.name },
      entity: { type: "automation_rule", id },
      title: `Automação ${active ? "ativada" : "desativada"}: ${rule.name}`,
      payload: { ruleId: id, active },
    });
    revalidate(id);
    return { ok: true, data: { active } };
  } catch (error) {
    return fail(error, "Não foi possível alterar a automação");
  }
}

export async function deleteAutomationRule(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const user = await requireAdmin();
    const { id } = ruleIdSchema.parse(input);
    const rule = await getById<AutomationRule>(COLLECTIONS.automationRules, id);
    if (!rule) throw new ActionError("Regra não encontrada");
    await remove(COLLECTIONS.automationRules, id);
    invalidateRulesCache();
    await emitEvent({
      type: "automation.rule_updated",
      actor: { id: user.id, name: user.name },
      entity: { type: "automation_rule", id },
      title: `Automação excluída: ${rule.name}`,
      payload: { ruleId: id, deleted: true },
    });
    revalidate();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível excluir a automação");
  }
}

/** "Testar com último evento": simula a regra (como está no formulário) sem nenhum efeito. */
export async function testAutomationRule(input: unknown): Promise<ActionResult<SimulationResult>> {
  try {
    await requireAdmin();
    const rule = parseRule(input);
    const record = normalizeRule({
      id: rule.id ?? "rascunho",
      organizationId: "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      name: rule.name,
      description: rule.description,
      active: rule.active,
      trigger: rule.trigger,
      conditions: rule.conditions,
      actions: rule.actions,
      runCount: 0,
    } as AutomationRuleRecord);
    return { ok: true, data: await simulateRule(record) };
  } catch (error) {
    return fail(error, "Não foi possível testar a automação");
  }
}

/** Botão "Executar varreduras agora" (força todas, ou só as informadas). */
export async function runSweepsNow(input: unknown): Promise<ActionResult<SweepReport>> {
  try {
    await requireAdmin();
    const { only, force } = runSweepsSchema.parse(input ?? {});
    const report = await runSweeps({ only, force });
    revalidate();
    revalidatePath("/meu-dia");
    revalidatePath("/tarefas");
    return { ok: true, data: report };
  } catch (error) {
    return fail(error, "Não foi possível executar as varreduras");
  }
}

export async function getPathSuggestionsAction(input: unknown): Promise<ActionResult<string[]>> {
  try {
    await requireAdmin();
    const { eventType, entity } = z.object({ eventType: z.string().optional(), entity: z.string().optional() }).parse(input ?? {});
    return { ok: true, data: await getPathSuggestions(eventType, entity) };
  } catch (error) {
    return fail(error, "Não foi possível carregar as sugestões");
  }
}

const AGENT_MODULE: Record<(typeof AGENT_KINDS)[number], string> = { comercial: "vendas", implantacao: "implantacao", suporte: "suporte", cs: "cs", executivo: "gestao" };

/**
 * Sugestões do assistente (regras determinísticas + IA quando configurada).
 * subjectId: comercial → ID do usuário; implantacao → ID do projeto; suporte → ID do chamado;
 * cs → ID do cliente; executivo → competência AAAA-MM.
 */
export async function getAgentSuggestions(kind: unknown, subjectId: unknown): Promise<ActionResult<AgentRun>> {
  try {
    const user = await requireUser();
    const k = z.enum(AGENT_KINDS, { error: "Assistente desconhecido" }).parse(kind);
    const subject = z.string().trim().min(1, "Informe o registro").max(200).parse(subjectId);
    if (!canAccessModule(user, AGENT_MODULE[k])) throw new ActionError("Seu perfil não tem acesso a este assistente");
    if (k === "comercial" && subject !== user.id && !user.isManager) throw new ActionError("Você só pode ver as sugestões da sua própria carteira");
    const run = await runAgent(k, subject, { actor: { id: user.id, name: user.name } });
    if (!run) throw new ActionError("Registro não encontrado para o assistente");
    return { ok: true, data: run };
  } catch (error) {
    return fail(error, "Não foi possível gerar as sugestões");
  }
}
