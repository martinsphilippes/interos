import "server-only";
/**
 * Ranking da gamificação.
 *
 * Pontos do período = soma de `gamification_points` cuja competência (AAAA-MM) cai no período (mês,
 * trimestre, ano); para janelas móveis/personalizadas vale a data do crédito. Escopos:
 * - individual: por padrão só pessoas comparáveis (mesmo departamento/função), ordenadas pelos pontos
 *   brutos; em "todos (normalizado)", todos os colaboradores pelos pontos × multiplicador do departamento
 *   (setting "gamificacao".multiplicadores).
 * - equipe: por gestor direto (liderados + o próprio gestor), média de pontos normalizados por pessoa.
 * - departamento: média de pontos normalizados por pessoa do departamento.
 * A Diretoria não entra no ranking (não opera metas pontuáveis). Posição anterior = mesmo cálculo no período
 * anterior (mês anterior, trimestre anterior...). Nível pelo total acumulado de pontos (todas as competências).
 */
import { list } from "@/server/db";
import { COLLECTIONS, type Achievement, type GamificationPoints, type User } from "@/domain/types";
import { DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import { inPeriod, listRecentMonths, periodMonths, previousPeriod, type Period } from "@/server/kpis/period";
import { getGamificationSettings, multiplierFor } from "./gamification";
import { levelFor, type GamificationLevel, type GamificationSettings, type RankingScope } from "./schemas";

export interface RankingMedal {
  key: string;
  name: string;
  icon?: string;
  unlockedAt: string;
}

export interface RankingRow {
  id: string;
  kind: "usuario" | "equipe" | "departamento";
  name: string;
  subtitle?: string;
  avatarUrl?: string;
  department?: DepartmentKey;
  members: number;
  /** Pontos brutos no período (soma do grupo). */
  points: number;
  /** Pontos × multiplicador (grupos: média por pessoa). */
  normalizedPoints: number;
  /** Valor usado na ordenação. */
  score: number;
  position: number;
  previousPosition: number | null;
  /** Variação de posição (positivo = subiu). */
  delta: number | null;
  /** Apenas para pessoas: total acumulado e nível. */
  totalPoints?: number;
  level?: { nome: string; next: (GamificationLevel & { missing: number }) | null; progress: number };
  medals: number;
  recentMedals: RankingMedal[];
}

export interface Ranking {
  period: Period;
  previous: Period;
  scope: RankingScope;
  /** Departamento filtrado no individual (null = todos, normalizado). */
  department: DepartmentKey | null;
  normalized: boolean;
  basis: string;
  rows: RankingRow[];
  settings: GamificationSettings;
}

export interface RankingOptions {
  /** Individual: departamento a comparar; "todos" = todos normalizados. Padrão: todos. */
  department?: DepartmentKey | "todos";
}

interface RankingData {
  /** Colaboradores ranqueáveis (ativos, fora da Diretoria). */
  users: User[];
  allUsers: User[];
  points: GamificationPoints[];
  achievements: Achievement[];
  settings: GamificationSettings;
}

async function loadRankingData(): Promise<RankingData> {
  const [users, points, achievements, settings] = await Promise.all([
    list<User>(COLLECTIONS.users),
    list<GamificationPoints>(COLLECTIONS.gamificationPoints),
    list<Achievement>(COLLECTIONS.achievements),
    getGamificationSettings(),
  ]);
  return { users: users.filter((u) => u.active !== false && u.departmentId !== "diretoria"), allUsers: users, points, achievements, settings };
}

/** Filtro "o ponto pertence ao período". */
function pointInPeriod(period: Period): (p: GamificationPoints) => boolean {
  if (period.kind === "mes" || period.kind === "trimestre" || period.kind === "ano") {
    const months = new Set(listRecentMonths(periodMonths(period), period).map((m) => m.key));
    return (p) => months.has(p.period);
  }
  return (p) => inPeriod(p.createdAt, period);
}

function pointsByUser(points: GamificationPoints[], period: Period): Map<string, number> {
  const inside = pointInPeriod(period);
  const out = new Map<string, number>();
  for (const p of points) if (inside(p)) out.set(p.userId, (out.get(p.userId) ?? 0) + (Number(p.points) || 0));
  return out;
}

/** Posição com empate (1, 1, 3...). */
function assignPositions<T extends { score: number; name: string }>(rows: T[]): (T & { position: number })[] {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "pt-BR"));
  let lastScore: number | null = null;
  let lastPosition = 0;
  return sorted.map((r, i) => {
    const position = lastScore !== null && Math.abs(r.score - lastScore) < 1e-9 ? lastPosition : i + 1;
    lastScore = r.score;
    lastPosition = position;
    return { ...r, position };
  });
}

type BaseRow = Omit<RankingRow, "position" | "previousPosition" | "delta">;

function buildRows(data: RankingData, period: Period, scope: RankingScope, department: DepartmentKey | null): BaseRow[] {
  const byUser = pointsByUser(data.points, period);
  const normalizedOf = (u: User) => (byUser.get(u.id) ?? 0) * multiplierFor(data.settings, u.departmentId);
  const medalsOf = (ids: string[]) => data.achievements.filter((a) => ids.includes(a.userId)).sort((a, b) => (a.unlockedAt < b.unlockedAt ? 1 : -1));

  if (scope === "individual") {
    const people = department ? data.users.filter((u) => u.departmentId === department) : data.users;
    const totals = new Map<string, number>();
    for (const p of data.points) totals.set(p.userId, (totals.get(p.userId) ?? 0) + (Number(p.points) || 0));
    return people.map((u) => {
      const medals = medalsOf([u.id]);
      const total = totals.get(u.id) ?? 0;
      const level = levelFor(total, data.settings.niveis);
      return {
        id: u.id,
        kind: "usuario",
        name: u.name,
        subtitle: u.jobTitle ?? DEPARTMENT_LABELS[u.departmentId],
        avatarUrl: u.avatarUrl,
        department: u.departmentId,
        members: 1,
        points: byUser.get(u.id) ?? 0,
        normalizedPoints: normalizedOf(u),
        score: department ? (byUser.get(u.id) ?? 0) : normalizedOf(u),
        totalPoints: total,
        level: { nome: level.current.nome, next: level.next, progress: level.progress },
        medals: medals.length,
        recentMedals: medals.slice(0, 3).map((a) => ({ key: a.key, name: a.name, icon: a.icon, unlockedAt: a.unlockedAt })),
      };
    });
  }

  const groups = new Map<string, { name: string; subtitle?: string; department?: DepartmentKey; members: User[] }>();
  if (scope === "equipe") {
    const allUsers = new Map(data.users.map((u) => [u.id, u]));
    for (const u of data.users) {
      if (!u.managerId) continue;
      const group = groups.get(u.managerId) ?? { name: "", members: [] };
      group.members.push(u);
      groups.set(u.managerId, group);
    }
    for (const [managerId, group] of groups) {
      const manager = allUsers.get(managerId);
      // O gestor compõe a própria equipe (quando não é da Diretoria).
      if (manager && !group.members.some((m) => m.id === managerId)) group.members.push(manager);
      group.name = `Equipe de ${manager?.name ?? "gestor"}`;
      group.subtitle = manager ? DEPARTMENT_LABELS[manager.departmentId] : "Gestor da Diretoria";
      group.department = manager?.departmentId;
    }
    // Liderados diretos da Diretoria (sem gestor no ranking) formam a equipe "da Diretoria".
    for (const [managerId, group] of groups) {
      if (!allUsers.has(managerId)) group.name = "Equipe da Diretoria";
    }
  } else {
    for (const u of data.users) {
      const group = groups.get(u.departmentId) ?? { name: DEPARTMENT_LABELS[u.departmentId], department: u.departmentId, members: [] };
      group.members.push(u);
      groups.set(u.departmentId, group);
    }
  }

  return Array.from(groups.entries()).map(([id, g]) => {
    const ids = g.members.map((m) => m.id);
    const points = g.members.reduce((s, m) => s + (byUser.get(m.id) ?? 0), 0);
    const normalized = g.members.reduce((s, m) => s + normalizedOf(m), 0) / Math.max(1, g.members.length);
    const medals = medalsOf(ids);
    return {
      id,
      kind: scope === "equipe" ? "equipe" : "departamento",
      name: g.name,
      subtitle: g.subtitle ?? `${g.members.length} pessoa(s)`,
      department: g.department,
      members: g.members.length,
      points,
      normalizedPoints: normalized,
      score: normalized,
      medals: medals.length,
      recentMedals: medals.slice(0, 3).map((a) => ({ key: a.key, name: a.name, icon: a.icon, unlockedAt: a.unlockedAt })),
    } satisfies BaseRow;
  });
}

function rank(data: RankingData, period: Period, scope: RankingScope, department: DepartmentKey | null): RankingRow[] {
  const previous = previousPeriod(period);
  const current = assignPositions(buildRows(data, period, scope, department));
  const before = new Map(assignPositions(buildRows(data, previous, scope, department)).map((r) => [r.id, r]));
  return current.map((r) => {
    const prev = before.get(r.id);
    // Sem pontos no período anterior a "posição anterior" não diz nada (estreante no ranking).
    const previousPosition = prev && prev.score > 0 ? prev.position : null;
    return { ...r, previousPosition, delta: previousPosition !== null ? previousPosition - r.position : null };
  });
}

/** Ranking do período no escopo pedido (ver regras no topo do arquivo). */
export async function getRanking(period: Period, scope: RankingScope = "individual", options: RankingOptions = {}): Promise<Ranking> {
  const data = await loadRankingData();
  const department = scope === "individual" && options.department && options.department !== "todos" ? options.department : null;
  const normalized = scope !== "individual" || department === null;
  const basis =
    scope === "individual"
      ? department
        ? `Pontos brutos no período, entre colaboradores de ${DEPARTMENT_LABELS[department]}.`
        : "Todos os colaboradores, com pontos normalizados pelo multiplicador do departamento."
      : scope === "equipe"
        ? "Média de pontos normalizados por pessoa da equipe (liderados diretos + gestor)."
        : "Média de pontos normalizados por pessoa do departamento.";
  return { period, previous: previousPeriod(period), scope, department, normalized, basis, rows: rank(data, period, scope, department), settings: data.settings };
}

export interface UserRankingSummary {
  department: DepartmentKey;
  position: number | null;
  of: number;
  delta: number | null;
  points: number;
  totalPoints: number;
  level: { nome: string; next: (GamificationLevel & { missing: number }) | null; progress: number };
  medals: RankingMedal[];
}

/** Posição do colaborador entre os colegas do mesmo departamento, pontos, nível e medalhas. */
export async function getUserRankingSummary(userId: string, period: Period): Promise<UserRankingSummary | null> {
  const data = await loadRankingData();
  const user = data.allUsers.find((u) => u.id === userId);
  if (!user) return null;
  const total = data.points.filter((p) => p.userId === userId).reduce((s, p) => s + (Number(p.points) || 0), 0);
  const level = levelFor(total, data.settings.niveis);
  const medals = data.achievements
    .filter((a) => a.userId === userId)
    .sort((a, b) => (a.unlockedAt < b.unlockedAt ? 1 : -1))
    .map((a) => ({ key: a.key, name: a.name, icon: a.icon, unlockedAt: a.unlockedAt }));
  const points = pointsByUser(data.points, period).get(userId) ?? 0;
  if (user.departmentId === "diretoria") {
    return { department: user.departmentId, position: null, of: 0, delta: null, points, totalPoints: total, level: { nome: level.current.nome, next: level.next, progress: level.progress }, medals };
  }
  const rows = rank(data, period, "individual", user.departmentId);
  const mine = rows.find((r) => r.id === userId);
  return { department: user.departmentId, position: mine?.position ?? null, of: rows.length, delta: mine?.delta ?? null, points, totalPoints: total, level: { nome: level.current.nome, next: level.next, progress: level.progress }, medals };
}
