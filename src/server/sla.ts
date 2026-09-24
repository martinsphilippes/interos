import { create, getById, list, update, nowIso } from "./db";
import { COLLECTIONS, type SlaInstance, type SlaRule, type SlaView } from "@/domain/types";
import type { DepartmentKey, SlaState } from "@/domain/constants";

/**
 * Motor de SLA reutilizável (tarefas, workflow, chamados, implantação, CS, oportunidades).
 *
 * O estado é calculado na leitura (`computeSlaState`), sem cron. Instâncias pausadas acumulam o tempo
 * pausado em `pausedTotalMs`, e o prazo (`dueAt`) é deslocado ao retomar.
 *
 * Horário comercial: segunda a sexta, 08:00–18:00 (fuso America/Sao_Paulo, aproximado por UTC-3),
 * feriados em `settings/feriados` (value.dates: string[] AAAA-MM-DD).
 */

const BUSINESS_START_HOUR = 8;
const BUSINESS_END_HOUR = 18;
const BUSINESS_HOURS_PER_DAY = BUSINESS_END_HOUR - BUSINESS_START_HOUR;
const TZ_OFFSET_MS = -3 * 60 * 60 * 1000; // America/Sao_Paulo sem horário de verão

let holidayCache: { loadedAt: number; dates: Set<string> } | null = null;

export async function getHolidays(): Promise<Set<string>> {
  if (holidayCache && Date.now() - holidayCache.loadedAt < 5 * 60 * 1000) return holidayCache.dates;
  const settings = await list<{ id: string; organizationId: string; createdAt: string; updatedAt: string; key: string; value: { dates?: string[] } }>(
    COLLECTIONS.settings,
    { where: [["key", "==", "feriados"]] },
  );
  const dates = new Set<string>(settings[0]?.value?.dates ?? []);
  holidayCache = { loadedAt: Date.now(), dates };
  return dates;
}

function toLocal(date: Date): Date {
  return new Date(date.getTime() + TZ_OFFSET_MS);
}
function fromLocal(local: Date): Date {
  return new Date(local.getTime() - TZ_OFFSET_MS);
}
function localDateKey(local: Date): string {
  return local.toISOString().slice(0, 10);
}
function isBusinessDay(local: Date, holidays: Set<string>): boolean {
  const day = local.getUTCDay();
  return day !== 0 && day !== 6 && !holidays.has(localDateKey(local));
}

/** Soma horas úteis a uma data, respeitando expediente, fins de semana e feriados. */
export function addBusinessHours(start: Date, hours: number, holidays: Set<string> = new Set()): Date {
  let remainingMs = hours * 60 * 60 * 1000;
  let cursor = toLocal(start);
  // Avança para dentro do expediente.
  const normalize = () => {
    while (true) {
      if (!isBusinessDay(cursor, holidays)) {
        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1, BUSINESS_START_HOUR));
        continue;
      }
      const h = cursor.getUTCHours() + cursor.getUTCMinutes() / 60;
      if (h < BUSINESS_START_HOUR) {
        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), BUSINESS_START_HOUR));
        return;
      }
      if (h >= BUSINESS_END_HOUR) {
        cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1, BUSINESS_START_HOUR));
        continue;
      }
      return;
    }
  };
  normalize();
  while (remainingMs > 0) {
    const endOfDay = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), BUSINESS_END_HOUR));
    const available = endOfDay.getTime() - cursor.getTime();
    if (remainingMs <= available) {
      cursor = new Date(cursor.getTime() + remainingMs);
      remainingMs = 0;
    } else {
      remainingMs -= available;
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1, BUSINESS_START_HOUR));
      normalize();
    }
  }
  return fromLocal(cursor);
}

/** Converte dias úteis em horas úteis. */
export function businessDaysToHours(days: number): number {
  return days * BUSINESS_HOURS_PER_DAY;
}

export async function getSlaRule(key: string): Promise<SlaRule | null> {
  const rules = await list<SlaRule>(COLLECTIONS.slaRules, { where: [["key", "==", key]] });
  return rules[0] ?? null;
}

export interface StartSlaInput {
  ruleKey: string;
  entityType: SlaInstance["entityType"];
  entityId: string;
  clientId?: string;
  ownerId?: string;
  department?: DepartmentKey;
  startedAt?: string;
  /** Sobrescreve as horas da regra (ex.: slaHours de uma etapa de workflow). */
  resolutionHours?: number;
  responseHours?: number;
  businessHoursOnly?: boolean;
}

/** Inicia uma instância de SLA a partir de uma regra (ou de horas informadas). */
export async function startSla(input: StartSlaInput): Promise<SlaInstance> {
  const rule = await getSlaRule(input.ruleKey);
  const resolutionHours = input.resolutionHours ?? rule?.resolutionHours ?? 24;
  const responseHours = input.responseHours ?? rule?.responseHours;
  const businessHoursOnly = input.businessHoursOnly ?? rule?.businessHoursOnly ?? true;
  const startedAt = input.startedAt ?? nowIso();
  const start = new Date(startedAt);
  const holidays = businessHoursOnly ? await getHolidays() : new Set<string>();
  const dueAt = businessHoursOnly
    ? addBusinessHours(start, resolutionHours, holidays)
    : new Date(start.getTime() + resolutionHours * 3600_000);
  const responseDueAt =
    responseHours === undefined
      ? undefined
      : businessHoursOnly
        ? addBusinessHours(start, responseHours, holidays)
        : new Date(start.getTime() + responseHours * 3600_000);

  return create<SlaInstance>(COLLECTIONS.slaInstances, {
    ruleKey: input.ruleKey,
    ruleName: rule?.name ?? input.ruleKey,
    entityType: input.entityType,
    entityId: input.entityId,
    clientId: input.clientId,
    ownerId: input.ownerId,
    department: input.department ?? rule?.department,
    startedAt,
    dueAt: dueAt.toISOString(),
    responseDueAt: responseDueAt?.toISOString(),
    status: "em_andamento",
    pausedTotalMs: 0,
    attentionPct: rule?.attentionPct ?? 50,
    riskPct: rule?.riskPct ?? 80,
  });
}

export async function pauseSla(id: string, reason: string): Promise<void> {
  const sla = await getById<SlaInstance>(COLLECTIONS.slaInstances, id);
  if (!sla || sla.status !== "em_andamento") return;
  await update<SlaInstance>(COLLECTIONS.slaInstances, id, { status: "pausado", pausedAt: nowIso(), pauseReason: reason });
}

export async function resumeSla(id: string): Promise<void> {
  const sla = await getById<SlaInstance>(COLLECTIONS.slaInstances, id);
  if (!sla || sla.status !== "pausado" || !sla.pausedAt) return;
  const pausedMs = Date.now() - new Date(sla.pausedAt).getTime();
  await update<SlaInstance>(COLLECTIONS.slaInstances, id, {
    status: "em_andamento",
    pausedAt: undefined,
    pauseReason: undefined,
    pausedTotalMs: sla.pausedTotalMs + pausedMs,
    dueAt: new Date(new Date(sla.dueAt).getTime() + pausedMs).toISOString(),
    responseDueAt: sla.responseDueAt ? new Date(new Date(sla.responseDueAt).getTime() + pausedMs).toISOString() : undefined,
  });
}

export async function markSlaResponded(id: string): Promise<void> {
  await update<SlaInstance>(COLLECTIONS.slaInstances, id, { respondedAt: nowIso() });
}

export async function completeSla(id: string): Promise<SlaInstance | null> {
  const sla = await getById<SlaInstance>(COLLECTIONS.slaInstances, id);
  if (!sla || sla.status === "concluido") return sla;
  const completedAt = nowIso();
  const breached = completedAt > sla.dueAt;
  await update<SlaInstance>(COLLECTIONS.slaInstances, id, {
    status: "concluido",
    completedAt,
    breachedAt: breached ? sla.dueAt : sla.breachedAt,
  });
  return { ...sla, status: "concluido", completedAt };
}

/** Estado do SLA na leitura. */
export function computeSlaState(sla: Pick<SlaInstance, "startedAt" | "dueAt" | "status" | "pausedAt" | "attentionPct" | "riskPct" | "completedAt">, now: Date = new Date()): SlaView {
  const start = new Date(sla.startedAt).getTime();
  const due = new Date(sla.dueAt).getTime();
  const reference = sla.status === "concluido" && sla.completedAt ? new Date(sla.completedAt).getTime() : sla.status === "pausado" && sla.pausedAt ? new Date(sla.pausedAt).getTime() : now.getTime();
  const total = Math.max(due - start, 1);
  const consumedPct = Math.max(0, ((reference - start) / total) * 100);
  const remainingMs = due - reference;
  let state: SlaState;
  if (sla.status === "concluido") state = remainingMs < 0 ? "violado" : "concluido";
  else if (sla.status === "pausado") state = "pausado";
  else if (remainingMs < 0) state = "violado";
  else if (consumedPct >= sla.riskPct) state = "em_risco";
  else if (consumedPct >= sla.attentionPct) state = "em_atencao";
  else state = "dentro_do_prazo";
  return { state, dueAt: sla.dueAt, remainingMs, consumedPct: Math.min(consumedPct, 999) };
}

export async function listSlaByEntity(entityType: SlaInstance["entityType"], entityId: string): Promise<SlaInstance[]> {
  return list<SlaInstance>(COLLECTIONS.slaInstances, { where: [["entityType", "==", entityType], ["entityId", "==", entityId]] });
}

/** SLAs ativos (em andamento ou pausados) de um responsável, com estado calculado. */
export async function listActiveSlasForOwner(ownerId: string): Promise<(SlaInstance & { view: SlaView })[]> {
  const items = await list<SlaInstance>(COLLECTIONS.slaInstances, { where: [["ownerId", "==", ownerId]] });
  return items.filter((s) => s.status === "em_andamento" || s.status === "pausado").map((s) => ({ ...s, view: computeSlaState(s) }));
}

/** Formata tempo restante como "2h 15m", "3d 4h" ou "-1h 20m". */
export function formatRemaining(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  if (days > 0) return `${sign}${days}d ${hours}h`;
  if (hours > 0) return `${sign}${hours}h ${minutes}m`;
  return `${sign}${minutes}m`;
}
