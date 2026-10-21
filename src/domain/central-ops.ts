/**
 * Operação da Central (fases 0 e 2): motivos de pausa, estado do operador no Painel do Gerente, alertas do gerente e
 * política de gravação de ligações. Puro: sem servidor.
 */
import type { RoleKey } from "./constants";

// ---------------------------------------------------------------------------
// Pausas
// ---------------------------------------------------------------------------

export interface PauseReason {
  key: string;
  label: string;
  /** Acima disso, o gerente é avisado (alerta «pausa longa»). Ausente = sem limite. */
  maxMinutes?: number;
  active: boolean;
}

export const DEFAULT_PAUSE_REASONS: PauseReason[] = [
  { key: "almoco", label: "Almoço", maxMinutes: 60, active: true },
  { key: "cafe", label: "Café", maxMinutes: 15, active: true },
  { key: "reuniao", label: "Reunião", active: true },
  { key: "treinamento", label: "Treinamento", active: true },
  { key: "problema_tecnico", label: "Problema técnico", maxMinutes: 30, active: true },
];

export function pauseKeyOf(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

// ---------------------------------------------------------------------------
// Estado do operador (Painel do Gerente)
// ---------------------------------------------------------------------------

export type OperatorState = "disponivel" | "ocupado" | "pausa" | "ausente" | "offline";

export const OPERATOR_STATE_LABELS: Record<OperatorState, string> = { disponivel: "Disponível", ocupado: "Ocupado", pausa: "Em pausa", ausente: "Ausente", offline: "Offline" };

/**
 * Disponível = online, atende na Central e abaixo do limite; ocupado = online no limite (ou marcou «ocupado»); pausa,
 * ausente; offline = sem presença informada há mais de 12 h (ou nunca).
 */
export function operatorState(
  u: { presence?: string; presenceUpdatedAt?: string; central?: { attends?: boolean } },
  load: number,
  limit: number,
  now: number = Date.now(),
): OperatorState {
  const stale = !u.presenceUpdatedAt || now - new Date(u.presenceUpdatedAt).getTime() > 12 * 3600_000;
  if (!u.presence || (stale && u.presence !== "pausa")) return "offline";
  if (u.presence === "pausa") return "pausa";
  if (u.presence === "ausente") return "ausente";
  if (u.presence === "ocupado") return "ocupado";
  return load >= Math.max(1, limit) || u.central?.attends === false ? "ocupado" : "disponivel";
}

/** Minutos desde a última troca de presença. */
export function minutesInState(presenceUpdatedAt: string | undefined, now: number = Date.now()): number | undefined {
  if (!presenceUpdatedAt) return undefined;
  return Math.max(0, Math.floor((now - new Date(presenceUpdatedAt).getTime()) / 60_000));
}

// ---------------------------------------------------------------------------
// Alertas do gerente
// ---------------------------------------------------------------------------

export interface ManagerAlertsConfig {
  /** Fila com mais conversas esperando que isso. */
  queue: { active: boolean; maxWaiting: number };
  /** Conversa com SLA em risco (perto de estourar). */
  sla: { active: boolean };
  /** Cliente esperando resposta do operador há mais que isso (minutos). */
  idle: { active: boolean; minutes: number };
  /** Pausa acima do limite do motivo. */
  pause: { active: boolean };
  /** O mesmo alerta, no máximo uma vez a cada X minutos. */
  repeatMinutes: number;
}

export const DEFAULT_MANAGER_ALERTS: ManagerAlertsConfig = {
  queue: { active: false, maxWaiting: 5 },
  sla: { active: false },
  idle: { active: false, minutes: 10 },
  pause: { active: false },
  repeatMinutes: 30,
};

export interface AlertSnapshot {
  queues: { id: string; name: string; waiting: number; oldestWaitingSince?: string; managerIds: string[] }[];
  conversations: { id: string; number: string; queueId?: string; assigneeId?: string; awaitingReply: boolean; waitingSince?: string; slaState?: string; managerIds: string[] }[];
  operators: { id: string; name: string; presence?: string; presenceUpdatedAt?: string; pauseReasonKey?: string; managerIds: string[] }[];
  pauseReasons: PauseReason[];
}

export interface ManagerAlert {
  /** Chave estável (controle de repetição). */
  key: string;
  kind: "fila" | "sla" | "parado" | "pausa";
  userIds: string[];
  title: string;
  body?: string;
  href: string;
}

/** Alertas a disparar agora (sem o controle de repetição, que fica no servidor). */
export function evaluateAlerts(s: AlertSnapshot, c: ManagerAlertsConfig, now: number = Date.now()): ManagerAlert[] {
  const out: ManagerAlert[] = [];
  const uniq = (ids: (string | undefined)[]) => Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
  if (c.queue.active) {
    for (const q of s.queues) {
      if (q.waiting <= c.queue.maxWaiting || q.managerIds.length === 0) continue;
      const mins = q.oldestWaitingSince ? Math.floor((now - new Date(q.oldestWaitingSince).getTime()) / 60_000) : undefined;
      out.push({ key: `fila:${q.id}`, kind: "fila", userIds: q.managerIds, title: `Fila ${q.name} com ${q.waiting} esperando`, body: mins !== undefined ? `A mais antiga espera há ${mins} min.` : undefined, href: "/comunicacao/supervisao" });
    }
  }
  for (const v of s.conversations) {
    if (c.sla.active && v.slaState === "em_risco") {
      out.push({ key: `sla:${v.id}`, kind: "sla", userIds: uniq([v.assigneeId, ...v.managerIds]), title: `SLA perto de estourar: ${v.number}`, href: `/comunicacao?conversa=${v.id}` });
    }
    if (c.idle.active && v.assigneeId && v.awaitingReply && v.waitingSince) {
      const mins = Math.floor((now - new Date(v.waitingSince).getTime()) / 60_000);
      if (mins >= c.idle.minutes) out.push({ key: `parado:${v.id}`, kind: "parado", userIds: uniq([v.assigneeId, ...v.managerIds]), title: `Cliente sem resposta há ${mins} min (${v.number})`, href: `/comunicacao?conversa=${v.id}` });
    }
  }
  if (c.pause.active) {
    const reasons = new Map(s.pauseReasons.map((r) => [r.key, r]));
    for (const o of s.operators) {
      if (o.presence !== "pausa" || !o.presenceUpdatedAt || o.managerIds.length === 0) continue;
      const reason = o.pauseReasonKey ? reasons.get(o.pauseReasonKey) : undefined;
      if (!reason?.maxMinutes) continue;
      const mins = Math.floor((now - new Date(o.presenceUpdatedAt).getTime()) / 60_000);
      if (mins > reason.maxMinutes) out.push({ key: `pausa:${o.id}:${o.presenceUpdatedAt}`, kind: "pausa", userIds: o.managerIds, title: `${o.name} em pausa (${reason.label}) há ${mins} min`, body: `O limite do motivo é ${reason.maxMinutes} min.`, href: "/comunicacao/supervisao" });
    }
  }
  return out.filter((a) => a.userIds.length > 0);
}

// ---------------------------------------------------------------------------
// Política de gravação (fase 0; usada pela telefonia)
// ---------------------------------------------------------------------------

export interface RecordingPolicy {
  /** Grava as ligações. */
  enabled: boolean;
  /** Aviso tocado ao cliente no início da ligação. */
  notice: string;
  /** Dias até apagar a gravação. */
  retentionDays: number;
  /** Papéis que podem ouvir gravações (além de quem atendeu). */
  listenRoles: RoleKey[];
  /** Ouvir ou baixar exige escrever o motivo (fica no registro de acesso). */
  requireReason: boolean;
}

export const DEFAULT_RECORDING_POLICY: RecordingPolicy = {
  enabled: true,
  notice: "Esta ligação pode ser gravada para garantir a qualidade do atendimento.",
  retentionDays: 180,
  listenRoles: ["admin", "diretoria", "gestor"],
  requireReason: true,
};
