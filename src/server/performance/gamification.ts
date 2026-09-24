import "server-only";
/**
 * Gamificação: pontos por evento, níveis e medalhas (achievements).
 *
 * - Pontos: cada evento pontuável (POINT_RULES) credita pontos a UM colaborador, com o valor do setting
 *   "gamificacao" (criado com os padrões na primeira leitura). Gravação idempotente em `gamification_points`
 *   com id determinístico gp_<eventId>_<userId> (reprocessar o mesmo evento não duplica).
 * - Níveis: pelo total acumulado de pontos (Bronze 0, Prata 500, Ouro 1500, Platina 3000, Diamante 6000 —
 *   configurável em setting.niveis).
 * - Medalhas: regras em ACHIEVEMENT_DEFS, avaliadas quando chega o evento relacionado; desbloqueio idempotente
 *   (id ach_<chave>[_<competência>]_<userId>), emite achievement.unlocked e notifica o colaborador.
 *
 * Chamado pelo handler src/server/events/handlers/gamification.ts.
 */
import { create, getById, list } from "@/server/db";
import { emitEvent } from "@/server/events";
import { notify } from "@/server/notifications";
import { COLLECTIONS, type Achievement, type DomainEvent, type GamificationPoints, type ImplementationProject, type Settings, type Task, type User, type UserRef } from "@/domain/types";
import { DEPARTMENT_KEYS, type DepartmentKey } from "@/domain/constants";
import { getUserScorecard, monthPeriod } from "@/server/kpis/queries";
import { localDayKey } from "@/server/kpis/period";
import { ACHIEVEMENT_DEFS, DEFAULT_GAMIFICATION, POINT_RULES, type AchievementKey, type GamificationSettings } from "./schemas";

const SYSTEM_ACTOR: UserRef = { id: "system", name: "INTEROS (gamificação)" };
const SETTING_KEY = "gamificacao";

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

function mergeSettings(value: Partial<GamificationSettings> | undefined): GamificationSettings {
  const multiplicadores = { ...DEFAULT_GAMIFICATION.multiplicadores };
  for (const dep of DEPARTMENT_KEYS) {
    const v = value?.multiplicadores?.[dep];
    if (typeof v === "number" && v > 0) multiplicadores[dep] = v;
  }
  const niveis = Array.isArray(value?.niveis) && value.niveis.length > 0 ? value.niveis.filter((n) => typeof n?.minimo === "number" && typeof n?.nome === "string") : DEFAULT_GAMIFICATION.niveis;
  return { pontos: { ...DEFAULT_GAMIFICATION.pontos, ...(value?.pontos ?? {}) }, multiplicadores, niveis };
}

/** Setting "gamificacao" (pontos, multiplicadores por departamento e níveis). Cria com os padrões se não existir. */
export async function getGamificationSettings(): Promise<GamificationSettings> {
  const docs = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", SETTING_KEY]] });
  if (docs[0]) return mergeSettings(docs[0].value as Partial<GamificationSettings>);
  await create<Settings>(
    COLLECTIONS.settings,
    { key: SETTING_KEY, value: { ...DEFAULT_GAMIFICATION } as unknown as Record<string, unknown>, description: "Pontos por evento, multiplicadores de equivalência por departamento e níveis da gamificação." },
    `setting_${SETTING_KEY}`,
  );
  return mergeSettings(undefined);
}

// ---------------------------------------------------------------------------
// Pontos por evento
// ---------------------------------------------------------------------------

export interface PointAward {
  userId: string;
  ruleKey: string;
  points: number;
  reason: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 && v !== "system" ? v : undefined);

/** Quem recebe e qual regra se aplica a um evento (null quando o evento não pontua). */
async function ruleFor(event: DomainEvent): Promise<{ userId: string; ruleKey: string } | null> {
  const p = event.payload ?? {};
  const actor = str(event.actorId);
  switch (event.type) {
    case "task.completed": {
      const userId = str(p.assigneeId) ?? str(p.completedBy) ?? actor;
      return userId ? { userId, ruleKey: p.late === true ? "tarefa_atrasada" : "tarefa_no_prazo" } : null;
    }
    case "support.ticket.resolved": {
      const userId = str(p.assigneeId) ?? actor;
      return p.withinSla === true && userId ? { userId, ruleKey: "chamado_no_sla" } : null;
    }
    case "support.csat.received": {
      const userId = str(p.attendantId);
      return Number(p.score) === 10 && userId ? { userId, ruleKey: "csat_10" } : null;
    }
    case "opportunity.won": {
      const userId = str(p.ownerId) ?? actor;
      return userId ? { userId, ruleKey: "venda_ganha" } : null;
    }
    case "proposal.sent": {
      const userId = str(p.ownerId) ?? actor;
      return userId ? { userId, ruleKey: "proposta_enviada" } : null;
    }
    case "lead.qualified": {
      const userId = str(p.leadOwnerId) ?? actor;
      return userId ? { userId, ruleKey: "lead_qualificado" } : null;
    }
    case "implementation.go_live": {
      if (p.onTime !== true) return null;
      const projectId = str(p.projectId) ?? (event.entityType === "implementation_project" || event.entityType === "project" ? event.entityId : undefined);
      const project = projectId ? await getById<ImplementationProject>(COLLECTIONS.implementationProjects, projectId) : null;
      const userId = str(project?.ownerId) ?? str(p.ownerId);
      return userId ? { userId, ruleKey: "go_live_no_prazo" } : null;
    }
    case "customer.checkpoint.completed":
      return actor ? { userId: actor, ruleKey: "checkpoint_cs" } : null;
    case "upsell.created": {
      const userId = str(p.originUserId) ?? actor;
      return userId ? { userId, ruleKey: "upsell_gerado" } : null;
    }
    default:
      return null;
  }
}

/** Pontos que o evento vale (sem gravar). */
export async function pointsForEvent(event: DomainEvent, settings?: GamificationSettings): Promise<PointAward | null> {
  const match = await ruleFor(event);
  if (!match) return null;
  const config = settings ?? (await getGamificationSettings());
  const points = Number(config.pontos[match.ruleKey] ?? 0);
  if (!Number.isFinite(points) || points <= 0) return null;
  const rule = POINT_RULES.find((r) => r.key === match.ruleKey);
  const title = event.title.length > 140 ? `${event.title.slice(0, 137)}…` : event.title;
  return { ...match, points, reason: `${rule?.label ?? match.ruleKey} · ${title}` };
}

export function pointsDocId(eventId: string, userId: string): string {
  return `gp_${eventId}_${userId}`;
}

/**
 * Credita os pontos do evento (idempotente: gp_<eventId>_<userId>) e avalia as medalhas ligadas a ele.
 * Devolve os pontos gravados agora (vazio quando o evento não pontua ou já foi processado).
 */
export async function awardPointsForEvent(event: DomainEvent): Promise<GamificationPoints[]> {
  const award = await pointsForEvent(event);
  const created: GamificationPoints[] = [];
  if (award) {
    const user = await getById<User>(COLLECTIONS.users, award.userId);
    if (user && user.active !== false) {
      const id = pointsDocId(event.id, award.userId);
      const existing = await getById<GamificationPoints>(COLLECTIONS.gamificationPoints, id);
      if (!existing) {
        created.push(
          await create<GamificationPoints>(
            COLLECTIONS.gamificationPoints,
            {
              userId: award.userId,
              points: award.points,
              reason: award.reason,
              sourceType: event.type,
              sourceId: event.entityId ?? event.id,
              period: localDayKey(event.occurredAt).slice(0, 7),
              createdAt: event.occurredAt,
            },
            id,
          ),
        );
      }
    }
  }
  await checkAchievementsForEvent(event, award);
  return created;
}

// ---------------------------------------------------------------------------
// Medalhas
// ---------------------------------------------------------------------------

function achievementId(key: AchievementKey, userId: string, suffix?: string): string {
  return suffix ? `ach_${key}_${suffix}_${userId}` : `ach_${key}_${userId}`;
}

/** Desbloqueia a medalha (idempotente). Medalhas com `suffix` (ex.: competência) podem repetir em outros períodos. */
export async function unlockAchievement(userId: string, key: AchievementKey, options: { suffix?: string; description?: string; sourceEventId?: string } = {}): Promise<Achievement | null> {
  const id = achievementId(key, userId, options.suffix);
  if (await getById<Achievement>(COLLECTIONS.achievements, id)) return null;
  if (!options.suffix) {
    const same = await list<Achievement>(COLLECTIONS.achievements, { where: [["userId", "==", userId]] });
    if (same.some((a) => a.key === key)) return null;
  }
  const def = ACHIEVEMENT_DEFS[key];
  const unlockedAt = new Date().toISOString();
  const achievement = await create<Achievement>(COLLECTIONS.achievements, { userId, key, name: def.name, description: options.description ?? def.description, icon: def.icon, unlockedAt }, id);
  const user = await getById<User>(COLLECTIONS.users, userId);
  const event = await emitEvent({
    type: "achievement.unlocked",
    actor: SYSTEM_ACTOR,
    entity: { type: "achievement", id },
    title: `Medalha desbloqueada: ${def.name}`,
    description: `${user?.name ?? "Colaborador"} · ${achievement.description ?? ""}`,
    department: user?.departmentId,
    payload: { userId, key, suffix: options.suffix, sourceEventId: options.sourceEventId },
    timeline: false,
  });
  await notify({
    userIds: [userId],
    kind: "informativa",
    title: `Nova medalha: ${def.name}`,
    body: achievement.description,
    href: "/performance",
    entity: { type: "achievement", id },
    eventId: event.id,
  });
  return achievement;
}

const DAY_MS = 86_400_000;

/** Últimos N dias úteis (seg–sex) até hoje, em chaves AAAA-MM-DD do fuso da operação. */
function lastBusinessDays(count: number, now = new Date()): string[] {
  const out: string[] = [];
  let cursor = Date.parse(`${localDayKey(now)}T12:00:00Z`);
  while (out.length < count) {
    const day = new Date(cursor).getUTCDay();
    if (day !== 0 && day !== 6) out.push(new Date(cursor).toISOString().slice(0, 10));
    cursor -= DAY_MS;
  }
  return out;
}

/** Sequência de 5 dias úteis seguidos (até hoje) com tarefa concluída e nenhuma concluída após o prazo. */
async function checkStreak(userId: string, eventId: string): Promise<void> {
  const tasks = await list<Task>(COLLECTIONS.tasks, { where: [["assigneeId", "==", userId]] });
  const done = tasks.filter((t) => t.status === "concluida" && t.completedAt);
  const days = lastBusinessDays(5);
  const ok = days.every((day) => {
    const onDay = done.filter((t) => localDayKey(t.completedAt!) === day);
    return onDay.length > 0 && onDay.every((t) => !t.dueAt || t.completedAt! <= t.dueAt);
  });
  if (ok) await unlockAchievement(userId, "sequencia_5_dias", { sourceEventId: eventId });
}

/** "Mês 100%": todas as metas do scorecard do colaborador atingidas na competência (ao menos uma com meta). */
export async function checkMonthAchievement(userId: string, periodKey: string, sourceEventId?: string): Promise<Achievement | null> {
  const period = monthPeriod(periodKey);
  const card = await getUserScorecard(userId, period, { withTrend: false, withSources: false });
  if (!card || card.withTarget === 0 || card.achieved < card.withTarget) return null;
  return unlockAchievement(userId, "mes_100", { suffix: periodKey, description: `Todas as ${card.withTarget} metas de ${period.label.toLowerCase()} atingidas.`, sourceEventId });
}

async function checkAchievementsForEvent(event: DomainEvent, award: PointAward | null): Promise<void> {
  const p = event.payload ?? {};
  switch (event.type) {
    case "opportunity.won":
      if (award) await unlockAchievement(award.userId, "primeira_venda", { sourceEventId: event.id });
      return;
    case "support.ticket.resolved": {
      if (!award) return;
      const points = await list<GamificationPoints>(COLLECTIONS.gamificationPoints, { where: [["userId", "==", award.userId]] });
      if (points.filter((x) => x.sourceType === "support.ticket.resolved").length >= 10) await unlockAchievement(award.userId, "chamados_sla_10", { sourceEventId: event.id });
      return;
    }
    case "support.csat.received":
      if (award) await unlockAchievement(award.userId, "csat_perfeito", { sourceEventId: event.id });
      return;
    case "implementation.go_live": {
      const start = str(p.startDate);
      const goLive = str(p.goLiveAt) ?? event.occurredAt;
      if (!start || Date.parse(goLive) - Date.parse(start) > 7 * DAY_MS) return;
      const projectId = str(p.projectId);
      const project = projectId ? await getById<ImplementationProject>(COLLECTIONS.implementationProjects, projectId) : null;
      if (project?.ownerId) await unlockAchievement(project.ownerId, "golive_relampago", { sourceEventId: event.id });
      return;
    }
    case "task.completed":
      if (award && award.ruleKey === "tarefa_no_prazo") await checkStreak(award.userId, event.id);
      return;
    case "goal.achieved": {
      const userId = str(p.userId);
      const periodKey = str(p.period);
      if (userId && periodKey && /^\d{4}-\d{2}$/.test(periodKey)) await checkMonthAchievement(userId, periodKey, event.id);
      return;
    }
    default:
      return;
  }
}

/** Reavalia "Mês 100%" para vários colaboradores (usado no fechamento da competência). */
export async function checkMonthAchievements(userIds: string[], periodKey: string): Promise<number> {
  let unlocked = 0;
  for (const userId of userIds) if (await checkMonthAchievement(userId, periodKey)) unlocked += 1;
  return unlocked;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** Extrato de pontos do colaborador (mais recentes primeiro). */
export async function listUserPoints(userId: string, limit = 20): Promise<GamificationPoints[]> {
  const items = await list<GamificationPoints>(COLLECTIONS.gamificationPoints, { where: [["userId", "==", userId]] });
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
}

export async function listUserAchievements(userId: string): Promise<Achievement[]> {
  const items = await list<Achievement>(COLLECTIONS.achievements, { where: [["userId", "==", userId]] });
  return items.sort((a, b) => (a.unlockedAt < b.unlockedAt ? 1 : -1));
}

/** Multiplicador de equivalência do departamento (1 quando não configurado). */
export function multiplierFor(settings: GamificationSettings, department: DepartmentKey): number {
  return settings.multiplicadores[department] ?? 1;
}
