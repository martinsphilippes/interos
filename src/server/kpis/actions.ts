"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { batchSet, col, create, getById, list, nowIso, remove, stripUndefined, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { COLLECTIONS, type ActionResult, type CurrentUser, type Goal, type Kpi, type Settings, type UserRef } from "@/domain/types";
import { getFormula, invalidateDataBundle } from "./formulas";
import { storeSnapshots } from "./engine";
import { monthPeriod, previousPeriod } from "./period";
import { canManageGoal, getGoalPermissions } from "./queries";
import { OPERATION_HEALTH_SETTING, PERFORMANCE_INDEX_SETTING } from "./operation-health";
import { operationHealthSchema, performanceIndexSchema, type OperationHealthInput, type PerformanceIndexInput } from "./health-schemas";
import { copyGoalsSchema, goalDocId, goalIdSchema, goalInputSchema, kpiInputSchema, toggleKpiSchema, zodMessage, type GoalInput, type KpiInput } from "./schemas";

/**
 * Server Actions do motor de indicadores: definições de KPI (admin), metas (gestor/diretoria/admin) e
 * gravação de snapshots mensais (admin).
 *
 * Padrão: requireUser() → permissão → zod → mutação via db.ts → emitEvent → revalidatePath.
 */

class ActionError extends Error {}

const actor = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  if (error instanceof ActionError) return { ok: false, error: error.message };
  console.error(`[kpis] ${fallback}`, error);
  return { ok: false, error: fallback };
}

function revalidateKpiPages(): void {
  revalidatePath("/admin/indicadores");
  revalidatePath("/performance/metas");
  revalidatePath("/performance");
  revalidatePath("/gestao", "layout");
}

// ---------------------------------------------------------------------------
// Definições (admin)
// ---------------------------------------------------------------------------

export async function upsertKpi(input: KpiInput): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    if (!user.isAdmin) throw new ActionError("Apenas administradores podem alterar indicadores");
    const data = kpiInputSchema.parse(input);
    const formula = getFormula(data.formula);
    if (!formula) throw new ActionError("Fórmula inexistente no registro de indicadores");

    const all = await list<Kpi>(COLLECTIONS.kpis, { where: [["key", "==", data.key]] });
    const clash = all.find((k) => k.id !== data.id);
    if (clash) throw new ActionError(`Já existe um indicador com a chave "${data.key}"`);

    const fields = {
      key: data.key,
      name: data.name,
      department: data.department,
      description: data.description || undefined,
      formula: data.formula,
      source: formula.source,
      period: "mensal" as const,
      unit: data.unit,
      direction: data.direction,
      target: data.target,
      targetMin: data.direction === "faixa" ? data.targetMin : undefined,
      targetMax: data.direction === "faixa" ? data.targetMax : undefined,
      attentionPct: data.attentionPct,
      weight: data.weight,
      ownerId: data.ownerId || undefined,
      active: data.active,
    };

    let id = data.id;
    if (id) {
      const current = await getById<Kpi>(COLLECTIONS.kpis, id);
      if (!current) throw new ActionError("Indicador não encontrado");
      // Substitui o documento inteiro: campos que ficaram vazios (faixa, dono, descrição) são removidos.
      const { id: _id, ...rest } = current;
      void _id;
      await batchSet([{ collection: COLLECTIONS.kpis, id, data: { ...rest, ...fields, updatedAt: nowIso() }, merge: false }]);
    } else {
      const created = await create<Kpi>(COLLECTIONS.kpis, { ...fields, createdBy: user.id }, `kpi_${data.key}`);
      id = created.id;
    }

    await emitEvent({
      type: "kpi.updated",
      actor: actor(user),
      entity: { type: "kpi", id },
      title: data.id ? `Indicador atualizado: ${data.name}` : `Indicador criado: ${data.name}`,
      payload: { kind: "definicao", kpiKey: data.key, formula: data.formula, target: data.target ?? null, direction: data.direction },
      timeline: false,
    });
    invalidateDataBundle();
    revalidateKpiPages();
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar o indicador");
  }
}

export async function toggleKpi(input: { id: string; active: boolean }): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (!user.isAdmin) throw new ActionError("Apenas administradores podem alterar indicadores");
    const data = toggleKpiSchema.parse(input);
    const kpi = await getById<Kpi>(COLLECTIONS.kpis, data.id);
    if (!kpi) throw new ActionError("Indicador não encontrado");
    await update<Kpi>(COLLECTIONS.kpis, data.id, { active: data.active });
    await emitEvent({
      type: "kpi.updated",
      actor: actor(user),
      entity: { type: "kpi", id: data.id },
      title: `${data.active ? "Indicador ativado" : "Indicador desativado"}: ${kpi.name}`,
      payload: { kind: "definicao", kpiKey: kpi.key, active: data.active },
      timeline: false,
    });
    revalidateKpiPages();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível alterar o indicador");
  }
}

/** Grava os snapshots do mês (fechamento). Também é seguro rodar no mês corrente (atualiza os do mês). */
export async function recordKpiSnapshots(input: { period: string }): Promise<ActionResult<{ written: number; skipped: number }>> {
  try {
    const user = await requireUser();
    if (!user.isAdmin) throw new ActionError("Apenas administradores podem gravar snapshots");
    const { period } = copyGoalsSchema.parse(input);
    invalidateDataBundle(period);
    const result = await storeSnapshots(monthPeriod(period));
    await emitEvent({
      type: "kpi.updated",
      actor: actor(user),
      entity: { type: "kpi_period", id: period },
      title: `Snapshots de indicadores gravados (${period})`,
      payload: { kind: "snapshot", period, ...result },
      timeline: false,
    });
    revalidateKpiPages();
    return { ok: true, data: result };
  } catch (error) {
    return fail(error, "Não foi possível gravar os snapshots");
  }
}

// ---------------------------------------------------------------------------
// Metas
// ---------------------------------------------------------------------------

export async function upsertGoal(input: GoalInput): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = goalInputSchema.parse(input);
    const scopeId = data.scope === "empresa" ? undefined : data.scopeId;
    const perms = await getGoalPermissions(user);
    if (!canManageGoal(perms, data.scope, scopeId)) throw new ActionError("Você não pode gerenciar metas deste escopo");
    if (!getFormula(data.kpiKey)) {
      const doc = (await list<Kpi>(COLLECTIONS.kpis, { where: [["key", "==", data.kpiKey]] }))[0];
      if (!doc || !getFormula(doc.formula)) throw new ActionError("Indicador inexistente");
    }

    const sameSlot = (await list<Goal>(COLLECTIONS.goals, { where: [["period", "==", data.period]] })).filter(
      (g) => g.kpiKey === data.kpiKey && g.scope === data.scope && (g.scopeId ?? "") === (scopeId ?? ""),
    );
    if (sameSlot.some((g) => g.id !== data.id)) throw new ActionError("Já existe meta deste indicador para este escopo no período");

    let id = data.id;
    if (id) {
      const current = await getById<Goal>(COLLECTIONS.goals, id);
      if (!current) throw new ActionError("Meta não encontrada");
      if (!canManageGoal(perms, current.scope, current.scopeId)) throw new ActionError("Você não pode alterar esta meta");
      await update<Goal>(COLLECTIONS.goals, id, { kpiKey: data.kpiKey, scope: data.scope, scopeId, period: data.period, target: data.target, weight: data.weight });
    } else {
      id = goalDocId(data.kpiKey, data.period, data.scope, scopeId);
      await create<Goal>(COLLECTIONS.goals, { kpiKey: data.kpiKey, scope: data.scope, scopeId, period: data.period, target: data.target, weight: data.weight, createdBy: user.id }, id);
    }

    await emitEvent({
      type: data.id ? "goal.updated" : "goal.created",
      actor: actor(user),
      entity: { type: "goal", id },
      title: `${data.id ? "Meta atualizada" : "Meta criada"}: ${data.kpiKey} (${data.period})`,
      payload: { kpiKey: data.kpiKey, scope: data.scope, scopeId: scopeId ?? null, period: data.period, target: data.target, weight: data.weight },
      timeline: false,
    });
    revalidateKpiPages();
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a meta");
  }
}

export async function deleteGoal(input: { id: string }): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const { id } = goalIdSchema.parse(input);
    const goal = await getById<Goal>(COLLECTIONS.goals, id);
    if (!goal) throw new ActionError("Meta não encontrada");
    const perms = await getGoalPermissions(user);
    if (!canManageGoal(perms, goal.scope, goal.scopeId)) throw new ActionError("Você não pode remover esta meta");
    await remove(COLLECTIONS.goals, id);
    await emitEvent({
      type: "goal.updated",
      actor: actor(user),
      entity: { type: "goal", id },
      title: `Meta removida: ${goal.kpiKey} (${goal.period})`,
      payload: { kind: "removida", kpiKey: goal.kpiKey, scope: goal.scope, scopeId: goal.scopeId ?? null, period: goal.period, target: goal.target },
      timeline: false,
    });
    revalidateKpiPages();
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível remover a meta");
  }
}

/** Copia para o período as metas do mês anterior que o usuário pode gerenciar e que ainda não existem. */
export async function copyGoalsFromPreviousMonth(input: { period: string }): Promise<ActionResult<{ copied: number }>> {
  try {
    const user = await requireUser();
    const { period } = copyGoalsSchema.parse(input);
    const previous = previousPeriod(monthPeriod(period));
    const [perms, current, prior] = await Promise.all([
      getGoalPermissions(user),
      list<Goal>(COLLECTIONS.goals, { where: [["period", "==", period]] }),
      list<Goal>(COLLECTIONS.goals, { where: [["period", "==", previous.key]] }),
    ]);
    if (!perms.canCompany && perms.departments.length === 0) throw new ActionError("Você não pode gerenciar metas");
    const existing = new Set(current.map((g) => `${g.kpiKey}|${g.scope}|${g.scopeId ?? ""}`));
    const toCopy = prior.filter((g) => !existing.has(`${g.kpiKey}|${g.scope}|${g.scopeId ?? ""}`) && canManageGoal(perms, g.scope, g.scopeId));
    if (toCopy.length === 0) throw new ActionError(`Não há metas de ${previous.label} para copiar`);
    for (const g of toCopy) {
      await create<Goal>(COLLECTIONS.goals, { kpiKey: g.kpiKey, scope: g.scope, scopeId: g.scopeId, period, target: g.target, weight: g.weight, createdBy: user.id }, goalDocId(g.kpiKey, period, g.scope, g.scopeId));
    }
    await emitEvent({
      type: "goal.created",
      actor: actor(user),
      entity: { type: "goal_period", id: period },
      title: `${toCopy.length} meta(s) copiada(s) de ${previous.label}`,
      payload: { kind: "copia", from: previous.key, period, count: toCopy.length, goalKeys: toCopy.map((g) => g.kpiKey) },
      timeline: false,
    });
    revalidateKpiPages();
    return { ok: true, data: { copied: toCopy.length } };
  } catch (error) {
    return fail(error, "Não foi possível copiar as metas");
  }
}

// ---------------------------------------------------------------------------
// Saúde da operação e Índice de desempenho (admin/diretoria)
// ---------------------------------------------------------------------------

async function saveIndexSetting(key: string, value: Record<string, unknown>, description: string, user: CurrentUser, title: string): Promise<void> {
  const existing = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", key]] });
  if (existing[0]) {
    // Substitui o valor inteiro (componentes/indicadores removidos somem de fato).
    await col(COLLECTIONS.settings).doc(existing[0].id).set(stripUndefined({ ...existing[0], id: undefined, value, updatedAt: nowIso() }));
  } else {
    await create<Settings>(COLLECTIONS.settings, { key, value, description, createdBy: user.id }, `setting_${key}`);
  }
  await emitEvent({
    type: "kpi.updated",
    actor: actor(user),
    entity: { type: "setting", id: key },
    title,
    payload: { kind: "config", setting: key },
    timeline: false,
  });
  revalidatePath("/gestao", "layout");
  revalidatePath("/performance", "layout");
  revalidatePath("/admin/configuracoes");
}

/** Salva o setting "saude_operacao" (componentes, pesos, normalização e faixas). Admin ou diretoria. */
export async function saveOperationHealthSettings(input: OperationHealthInput): Promise<ActionResult<{ key: string }>> {
  try {
    const user = await requireUser();
    if (!user.isDirector) throw new ActionError("Apenas administradores e diretoria podem configurar a Saúde da operação");
    const value = operationHealthSchema.parse(input);
    await saveIndexSetting(OPERATION_HEALTH_SETTING, value as unknown as Record<string, unknown>, "Componentes, pesos, normalização e faixas do índice de Saúde da operação.", user, "Configuração da Saúde da operação atualizada");
    return { ok: true, data: { key: OPERATION_HEALTH_SETTING } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a configuração da Saúde da operação");
  }
}

/** Salva o setting "indice_desempenho" (meta, pesos e indicadores por departamento, faixas). Admin ou diretoria. */
export async function savePerformanceIndexSettings(input: PerformanceIndexInput): Promise<ActionResult<{ key: string }>> {
  try {
    const user = await requireUser();
    if (!user.isDirector) throw new ActionError("Apenas administradores e diretoria podem configurar o Índice de desempenho");
    const value = performanceIndexSchema.parse(input);
    await saveIndexSetting(PERFORMANCE_INDEX_SETTING, value as unknown as Record<string, unknown>, "Pesos e indicadores do Índice de desempenho por departamento.", user, "Configuração do Índice de desempenho atualizada");
    return { ok: true, data: { key: PERFORMANCE_INDEX_SETTING } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a configuração do Índice de desempenho");
  }
}
