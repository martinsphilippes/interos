import { col, create, nowIso } from "../db";
import { COLLECTIONS, type DomainEvent, type DomainEventMeta, type TimelineEvent, type UserRef } from "@/domain/types";
import type { DepartmentKey, EventType } from "@/domain/constants";
import { eventChanges } from "@/domain/audit-format";
import { currentAutomationMarker } from "@/server/automations/scope";

/**
 * Motor de eventos do INTEROS.
 *
 * Toda mutação relevante emite um evento. O evento é persistido em `events`, espelhado na
 * timeline do cliente (`timeline_events`) e entregue aos handlers registrados, que alimentam
 * tarefas, SLA, notificações, indicadores e automações.
 *
 * Handlers rodam em sequência, cada um isolado em try/catch: uma falha não impede os demais
 * nem a operação principal. Erros ficam gravados em `meta.handlerErrors` no evento.
 *
 * Auditoria (D29): o `payload` é IMUTÁVEL depois de gravado. Metadados de execução (erros de handler, cadeia de
 * automação, anotações de módulos) vivem em `meta` — o único trecho escrito depois da criação. As alterações
 * "de → para" (`payload.changes`) e o motivo (`payload.reason`) são copiados para a timeline do cliente.
 */

export interface EmitEventInput {
  type: EventType;
  actor: UserRef;
  clientId?: string;
  entity?: { type: string; id: string };
  title: string;
  description?: string;
  payload?: Record<string, unknown>;
  department?: DepartmentKey;
  /** Espelhar na timeline do cliente (padrão: true quando há clientId). */
  timeline?: boolean;
  occurredAt?: string;
  /** Metadados de execução gravados na criação (ex.: marcador de automação explícito). */
  meta?: DomainEventMeta;
}

export type EventHandler = (event: DomainEvent) => Promise<void>;

type HandlerRegistry = Map<EventType | "*", EventHandler[]>;

/**
 * Registro dos handlers guardado em `globalThis`: em desenvolvimento o HMR reavalia este módulo quando uma
 * dependência (ex.: src/domain/types.ts) muda, e um `Map` local nasceria vazio enquanto os módulos de handler
 * não reavaliados manteriam o flag "já registrado" — os eventos passariam a rodar sem parte dos handlers.
 * Em produção (processo único por instância) o comportamento é o mesmo de um Map local.
 */
const registry = globalThis as unknown as { __interosEventHandlers?: HandlerRegistry };
const handlers: HandlerRegistry = registry.__interosEventHandlers ?? (registry.__interosEventHandlers = new Map());

/** Chave de identidade do handler: nome da função (ou o código-fonte, para funções anônimas) — o HMR substitui a versão anterior em vez de duplicar. */
function handlerKey(handler: EventHandler): string {
  return handler.name || handler.toString();
}

export function registerHandler(type: EventType | "*", handler: EventHandler): void {
  const current = handlers.get(type) ?? [];
  const key = handlerKey(handler);
  const index = current.findIndex((h) => handlerKey(h) === key);
  if (index >= 0) current[index] = handler;
  else current.push(handler);
  handlers.set(type, current);
}

export function listHandlers(type: EventType): EventHandler[] {
  return [...(handlers.get(type) ?? []), ...(handlers.get("*") ?? [])];
}

/** Grava metadados de execução no evento (merge em `meta`; o payload nunca é tocado). */
export async function writeEventMeta(eventId: string, meta: DomainEventMeta): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  for (const [key, value] of Object.entries(meta)) if (value !== undefined) patch[`meta.${key}`] = value;
  await col(COLLECTIONS.events).doc(eventId).update(patch);
}

export async function emitEvent(input: EmitEventInput): Promise<DomainEvent> {
  const occurredAt = input.occurredAt ?? nowIso();
  // Evento gerado dentro de uma automação: o marcador vai para meta NA CRIAÇÃO (antes era regravado no payload).
  const automation = input.meta?.automation ?? currentAutomationMarker();
  const meta: DomainEventMeta | undefined = input.meta || automation ? { ...(input.meta ?? {}), ...(automation ? { automation } : {}) } : undefined;
  const event = await create<DomainEvent>(COLLECTIONS.events, {
    type: input.type,
    occurredAt,
    actorId: input.actor.id,
    actorName: input.actor.name,
    clientId: input.clientId,
    entityType: input.entity?.type,
    entityId: input.entity?.id,
    title: input.title,
    description: input.description,
    payload: input.payload ?? {},
    department: input.department,
    meta,
  });

  if (input.clientId && input.timeline !== false) {
    const changes = eventChanges(event.type, event.payload);
    const reason = typeof event.payload.reason === "string" && event.payload.reason.trim() ? event.payload.reason.trim() : undefined;
    await create<TimelineEvent>(COLLECTIONS.timelineEvents, {
      clientId: input.clientId,
      eventId: event.id,
      type: event.type,
      occurredAt,
      actorId: event.actorId,
      actorName: event.actorName,
      title: event.title,
      description: event.description,
      entityType: event.entityType,
      entityId: event.entityId,
      department: event.department,
      ...(changes ? { changes } : {}),
      ...(reason ? { reason } : {}),
    });
  }

  const errors: string[] = [];
  for (const handler of listHandlers(event.type)) {
    try {
      await handler(event);
    } catch (error) {
      errors.push(error instanceof Error ? `${handler.name || "handler"}: ${error.message}` : String(error));
    }
  }
  if (errors.length > 0) {
    console.error(`[events] ${event.type} handlers com erro:`, errors);
    await writeEventMeta(event.id, { handlerErrors: errors });
    event.meta = { ...(event.meta ?? {}), handlerErrors: errors };
  }
  return event;
}
