import { create, list, update, nowIso } from "./db";
import { COLLECTIONS, type Notification } from "@/domain/types";
import type { NotificationKind } from "@/domain/constants";

export interface NotifyInput {
  userIds: string[];
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  entity?: { type: string; id: string };
  eventId?: string;
}

/** Cria uma notificação interna para cada usuário informado (ignora duplicados e vazios). */
export async function notify(input: NotifyInput): Promise<Notification[]> {
  const ids = Array.from(new Set(input.userIds.filter(Boolean)));
  const created: Notification[] = [];
  for (const userId of ids) {
    created.push(
      await create<Notification>(COLLECTIONS.notifications, {
        userId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        href: input.href,
        entityType: input.entity?.type,
        entityId: input.entity?.id,
        eventId: input.eventId,
      }),
    );
  }
  return created;
}

export async function listNotifications(userId: string, options: { unreadOnly?: boolean; limit?: number } = {}): Promise<Notification[]> {
  const items = await list<Notification>(COLLECTIONS.notifications, { where: [["userId", "==", userId]] });
  const filtered = options.unreadOnly ? items.filter((n) => !n.readAt) : items;
  filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return options.limit ? filtered.slice(0, options.limit) : filtered;
}

export async function markNotificationRead(id: string): Promise<void> {
  await update<Notification>(COLLECTIONS.notifications, id, { readAt: nowIso() });
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const unread = await listNotifications(userId, { unreadOnly: true });
  await Promise.all(unread.map((n) => markNotificationRead(n.id)));
  return unread.length;
}
