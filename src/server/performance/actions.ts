"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BusinessError, PermissionError, failAction, requirePermission } from "@/server/auth/session";
import { create, getById, getManyByIds, list, remove, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { auditChanges } from "@/server/audit";
import { notify } from "@/server/notifications";
import { COLLECTIONS, type ActionResult, type BonusRule, type CurrentUser, type GamificationCampaign, type User, type UserRef } from "@/domain/types";
import { DEPARTMENT_LABELS, type EventType } from "@/domain/constants";
import { formatCurrency } from "@/lib/format";
import { monthPeriod } from "@/server/kpis/period";
import { decideBonusBlock, describeClosing, registerBonusBlock as registerBlock, storeBonusResults } from "./bonus";
import { checkMonthAchievements } from "./gamification";
import { campaignInScope, getPerformanceAccess } from "./queries";
import { resolveDataScope } from "@/server/auth/scope";
import {
  bonusBlockDecisionSchema,
  bonusBlockInputSchema,
  bonusRuleInputSchema,
  campaignIdSchema,
  campaignInputSchema,
  closePeriodSchema,
  zodMessage,
  type BonusBlockInput,
  type BonusRuleInput,
  type CampaignInput,
} from "./schemas";

/**
 * Server Actions de Performance: bloqueios de bônus (registrar/confirmar/revogar), fechamento da
 * competência, regras de bônus versionadas e campanhas de gamificação.
 *
 * Padrão: requirePermission(chave do catálogo src/domain/permissions/performance.ts) → zod → escopo do registro
 * (colaborador dentro do escopo da tela Bônus: assertCanManage → PermissionError) → mutação → emitEvent →
 * revalidatePath. Falhas pelo tratamento único (failAction); validação com a primeira mensagem do zod.
 */

/** Erro de regra de negócio com mensagem para o usuário. */
class ActionError extends BusinessError {}

const actorOf = (user: CurrentUser): UserRef => ({ id: user.id, name: user.name });

/** Mensagens de acesso negado (a chave vem do catálogo; a mensagem mantém o texto de antes). */
const BLOCK_DENIED = "Apenas gestores, diretoria e administradores registram bloqueios";
const DECIDE_DENIED = "Apenas gestores, diretoria e administradores decidem bloqueios";
const CLOSE_DENIED = "Apenas gestores, diretoria e administradores fecham a competência";
const RULE_DENIED = "Apenas administradores alteram regras de bônus";
const CAMPAIGN_DENIED = "Apenas gestores, diretoria e administradores gerenciam campanhas";

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  return failAction(error, fallback, "performance");
}

function revalidatePerformance(): void {
  revalidatePath("/performance", "layout");
}

/** Colaborador fora do escopo de gestão da tela Bônus → acesso negado (A29). */
async function assertCanManage(user: CurrentUser, targetUserId: string): Promise<void> {
  const access = await getPerformanceAccess(user, "performance.bonus");
  if (!access.manageableIds.includes(targetUserId)) throw new PermissionError("Você não gerencia este colaborador");
}

/** Campanha fora do escopo da tela Campanhas (padrão da gestão: empresa) → acesso negado (A29). */
async function assertCampaignInScope(user: CurrentUser, campaign: GamificationCampaign): Promise<void> {
  const scope = await resolveDataScope(user, "performance.campanhas");
  if (!campaignInScope(campaign, user, scope.kind)) throw new PermissionError();
}

/** Campanha com id = edição; sem id = criação (a chave depende do argumento, antes da validação). */
function campaignIdOf(input: unknown): string | undefined {
  const id = input && typeof input === "object" ? (input as { id?: unknown }).id : undefined;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

// ---------------------------------------------------------------------------
// Bloqueios de bônus
// ---------------------------------------------------------------------------

export async function registerBonusBlock(input: BonusBlockInput): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("performance.bonus.equipe.bloquear", BLOCK_DENIED);
    const data = bonusBlockInputSchema.parse(input);
    await assertCanManage(user, data.userId);
    const block = await registerBlock(data, actorOf(user));
    revalidatePerformance();
    return { ok: true, data: { id: block.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o bloqueio");
  }
}

async function decide(user: CurrentUser, input: { id: string; note?: string }, decision: "confirmado" | "revogado"): Promise<ActionResult> {
  const data = bonusBlockDecisionSchema.parse(input);
  const block = await getById<{ id: string; organizationId: string; createdAt: string; updatedAt: string; userId: string }>(COLLECTIONS.bonusBlocks, data.id);
  if (!block) throw new ActionError("Bloqueio não encontrado");
  await assertCanManage(user, block.userId);
  await decideBonusBlock(data.id, decision, actorOf(user), data.note || undefined);
  revalidatePerformance();
  return { ok: true, data: undefined };
}

/** Confirma o bloqueio: o bônus do mês do colaborador fica zerado (emite bonus.blocked e notifica). */
export async function confirmBonusBlock(input: { id: string; note?: string }): Promise<ActionResult> {
  try {
    const user = await requirePermission("performance.bonus.equipe.aprovar", DECIDE_DENIED);
    return await decide(user, input, "confirmado");
  } catch (error) {
    return fail(error, "Não foi possível confirmar o bloqueio");
  }
}

/** Revoga o bloqueio (aberto ou confirmado): o bônus volta a ser calculado normalmente. */
export async function revokeBonusBlock(input: { id: string; note?: string }): Promise<ActionResult> {
  try {
    const user = await requirePermission("performance.bonus.equipe.cancelar", DECIDE_DENIED);
    return await decide(user, input, "revogado");
  } catch (error) {
    return fail(error, "Não foi possível revogar o bloqueio");
  }
}

// ---------------------------------------------------------------------------
// Fechamento da competência
// ---------------------------------------------------------------------------

/**
 * Fecha a competência: grava bonus_results (admin/diretoria: todos; gestor: sua equipe), reavalia a medalha
 * "Mês 100%", emite bonus.calculated e avisa cada colaborador do valor apurado.
 */
export async function closeBonusPeriod(input: { period: string }): Promise<ActionResult<{ written: number; blocked: number; total: number }>> {
  try {
    const user = await requirePermission("performance.bonus.equipe.concluir", CLOSE_DENIED);
    const data = closePeriodSchema.parse(input);
    // Escopo "empresa" (padrão: admin/diretoria) fecha todos; os demais, quem gerenciam (padrão do gestor).
    const access = await getPerformanceAccess(user, "performance.bonus");
    const companyWide = access.scopeKind === "empresa" || access.scopeKind === "unidades";
    const result = await storeBonusResults(monthPeriod(data.period), companyWide ? undefined : access.manageableIds);
    if (result.written === 0) throw new ActionError("Nenhum colaborador com regra de bônus vigente para fechar");

    const event = await emitEvent({
      type: "bonus.calculated",
      actor: actorOf(user),
      entity: { type: "bonus_period", id: data.period },
      title: `Competência ${data.period} de bônus fechada`,
      description: describeClosing(result),
      department: companyWide ? undefined : user.departmentId,
      payload: { kind: "fechamento", period: data.period, written: result.written, blocked: result.blocked, total: result.total, userIds: result.results.map((r) => r.userId) },
      timeline: false,
    });
    for (const r of result.results) {
      await notify({
        userIds: [r.userId],
        kind: r.blocked ? "atencao" : "informativa",
        title: `Bônus de ${monthPeriod(data.period).label.toLowerCase()} apurado`,
        body: r.blocked ? "O bônus do mês está bloqueado. Veja o motivo no detalhamento." : `Valor apurado: ${r.totalAmount === null ? "salário base não cadastrado" : formatCurrency(r.totalAmount)} (${r.tier?.label ?? "sem faixa"}).`,
        href: `/performance/bonus?periodo=${data.period}`,
        entity: { type: "bonus_period", id: data.period },
        eventId: event.id,
      });
    }
    await checkMonthAchievements(
      result.results.map((r) => r.userId),
      data.period,
    );
    revalidatePerformance();
    return { ok: true, data: { written: result.written, blocked: result.blocked, total: result.total } };
  } catch (error) {
    return fail(error, "Não foi possível fechar a competência");
  }
}

// ---------------------------------------------------------------------------
// Regras de bônus (admin)
// ---------------------------------------------------------------------------

/**
 * Salva uma NOVA VERSÃO da regra do departamento (version = maior versão + 1) e desativa as anteriores.
 * Não retroage: competências fechadas guardam o ruleId e a versão usada.
 */
export async function saveBonusRule(input: BonusRuleInput): Promise<ActionResult<{ id: string; version: number }>> {
  try {
    const user = await requirePermission("performance.bonus.regras.editar", RULE_DENIED);
    const data = bonusRuleInputSchema.parse(input);
    const existing = await list<BonusRule>(COLLECTIONS.bonusRules, { where: [["department", "==", data.department]] });
    const version = existing.reduce((max, r) => Math.max(max, r.version ?? 0), 0) + 1;
    const id = `bonus_rule_${data.department}_v${version}`;
    const rule = await create<BonusRule>(
      COLLECTIONS.bonusRules,
      {
        name: data.name,
        department: data.department,
        maxPctOfSalary: data.maxPctOfSalary,
        individualWeight: data.individualWeight,
        collectiveWeight: data.collectiveWeight,
        individualKpis: data.individualKpis,
        collectiveKpis: data.collectiveKpis,
        tiers: [...data.tiers].sort((a, b) => b.minAttainment - a.minAttainment),
        blockers: data.blockers,
        extras: data.extras,
        active: true,
        version,
        createdBy: user.id,
      },
      id,
    );
    for (const r of existing.filter((r) => r.active)) await update<BonusRule>(COLLECTIONS.bonusRules, r.id, { active: false });

    // Não há tipo de evento específico para regra de bônus: bonus.calculated com payload.kind = "regra".
    await emitEvent({
      type: "bonus.calculated",
      actor: actorOf(user),
      entity: { type: "bonus_rule", id: rule.id },
      title: `Regra de bônus de ${DEPARTMENT_LABELS[data.department]} publicada (versão ${version})`,
      description: `${data.name} · até ${data.maxPctOfSalary}% do salário · individual ${data.individualWeight} / coletivo ${data.collectiveWeight}`,
      department: data.department,
      payload: {
        kind: "regra",
        ruleId: rule.id,
        version,
        baseRuleId: data.baseRuleId,
        deactivated: existing.filter((r) => r.active).map((r) => r.id),
        // Auditoria (D29): o que mudou em relação à versão que estava ativa (as versões antigas ficam gravadas).
        ...auditChanges<BonusRule>(
          existing.filter((r) => r.active).sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null,
          rule,
          ["name", "maxPctOfSalary", "individualWeight", "collectiveWeight", "individualKpis", "collectiveKpis", "tiers", "blockers", "extras"],
        ),
      },
      timeline: false,
    });
    revalidatePerformance();
    return { ok: true, data: { id: rule.id, version } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a regra de bônus");
  }
}

// ---------------------------------------------------------------------------
// Campanhas de gamificação
// ---------------------------------------------------------------------------

const CAMPAIGN_EVENT: EventType = "campaign.progress";

/** Cria ou atualiza uma campanha/desafio (gestor, diretoria, admin). */
export async function upsertCampaign(input: CampaignInput): Promise<ActionResult<{ id: string }>> {
  try {
    const user = campaignIdOf(input)
      ? await requirePermission("performance.campanhas.editar", CAMPAIGN_DENIED)
      : await requirePermission("performance.campanhas.criar", CAMPAIGN_DENIED);
    const data = campaignInputSchema.parse(input);
    if (data.participantIds.length > 0) {
      const found = await getManyByIds<User>(COLLECTIONS.users, data.participantIds);
      if (found.size !== new Set(data.participantIds).size) throw new ActionError("Há participantes inexistentes na lista");
    }
    const fields: Omit<GamificationCampaign, "id" | "organizationId" | "createdAt" | "updatedAt"> = {
      name: data.name,
      description: data.description || undefined,
      // Datas em ISO: meia-noite de São Paulo (UTC-3) do dia escolhido.
      startDate: `${data.startDate}T03:00:00.000Z`,
      endDate: `${data.endDate}T03:00:00.000Z`,
      departments: data.departments,
      metric: data.metricKind === "kpi" ? { kind: "kpi", kpiKey: data.kpiKey! } : { kind: "evento", eventType: data.eventType as EventType },
      target: data.target,
      prize: data.prize || undefined,
      participantIds: Array.from(new Set(data.participantIds)),
      status: data.status,
      ownerId: user.id,
    };
    let id = data.id;
    if (id) {
      const current = await getById<GamificationCampaign>(COLLECTIONS.gamificationCampaigns, id);
      if (!current) throw new ActionError("Campanha não encontrada");
      await assertCampaignInScope(user, current);
      await update<GamificationCampaign>(COLLECTIONS.gamificationCampaigns, id, { ...fields, ownerId: current.ownerId });
    } else {
      id = (await create<GamificationCampaign>(COLLECTIONS.gamificationCampaigns, { ...fields, createdBy: user.id })).id;
    }
    await emitEvent({
      type: CAMPAIGN_EVENT,
      actor: actorOf(user),
      entity: { type: "gamification_campaign", id },
      title: `${data.id ? "Campanha atualizada" : "Campanha criada"}: ${data.name}`,
      description: `${data.startDate} a ${data.endDate} · meta ${data.target}${data.prize ? ` · prêmio: ${data.prize}` : ""}`,
      payload: { kind: data.id ? "atualizada" : "criada", status: data.status, departments: data.departments, metric: fields.metric, target: data.target },
      timeline: false,
    });
    revalidatePath("/performance/campanhas");
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar a campanha");
  }
}

export async function deleteCampaign(input: { id: string }): Promise<ActionResult> {
  try {
    const user = await requirePermission("performance.campanhas.excluir", CAMPAIGN_DENIED);
    const data = campaignIdSchema.parse(input);
    const current = await getById<GamificationCampaign>(COLLECTIONS.gamificationCampaigns, data.id);
    if (!current) throw new ActionError("Campanha não encontrada");
    await assertCampaignInScope(user, current);
    await remove(COLLECTIONS.gamificationCampaigns, data.id);
    await emitEvent({
      type: CAMPAIGN_EVENT,
      actor: actorOf(user),
      entity: { type: "gamification_campaign", id: data.id },
      title: `Campanha removida: ${current.name}`,
      payload: { kind: "removida", status: current.status },
      timeline: false,
    });
    revalidatePath("/performance/campanhas");
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error, "Não foi possível remover a campanha");
  }
}
