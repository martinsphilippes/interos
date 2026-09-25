import { create, update, nowIso } from "../db";
import { COLLECTIONS, type DomainEvent, type TimelineEvent, type UserRef } from "@/domain/types";
import type { DepartmentKey, EventType } from "@/domain/constants";

/**
 * Motor de eventos do INTEROS.
 *
 * Toda mutação relevante emite um evento. O evento é persistido em `events`, espelhado na
 * timeline do cliente (`timeline_events`) e entregue aos handlers registrados, que alimentam
 * tarefas, SLA, notificações, indicadores e automações.
 *
 * Handlers rodam em sequência, cada um isolado em try/catch: uma falha não impede os demais
 * nem a operação principal. Erros ficam gravados em `handlerErrors` no evento.
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
}

export type EventHandler = (event: DomainEvent) => Promise<void>;

const handlers = new Map<EventType | "*", EventHandler[]>();

export function registerHandler(type: EventType | "*", handler: EventHandler): void {
  const current = handlers.get(type) ?? [];
  current.push(handler);
  handlers.set(type, current);
}

export function listHandlers(type: EventType): EventHandler[] {
  return [...(handlers.get(type) ?? []), ...(handlers.get("*") ?? [])];
}

export async function emitEvent(input: EmitEventInput): Promise<DomainEvent> {
  const occurredAt = input.occurredAt ?? nowIso();
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
  });

  if (input.clientId && input.timeline !== false) {
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
    await update<DomainEvent>(COLLECTIONS.events, event.id, { handlerErrors: errors });
  }
  return event;
}
