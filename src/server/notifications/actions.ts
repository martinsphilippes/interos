"use server";
/**
 * Server Actions da central de notificações. As leituras ficam em src/server/notifications.ts.
 * Chaves: inicio.notificacoes.editar (marcar como lida) e inicio.notificacoes.excluir. Escopo fixo "meus": toda
 * ação confere que a notificação pertence ao usuário da sessão.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BusinessError, failAction, requirePermission } from "@/server/auth/session";
import { getById, remove } from "@/server/db";
import { markAllNotificationsRead, markNotificationRead } from "@/server/notifications";
import { COLLECTIONS, type ActionResult, type Notification } from "@/domain/types";

const idSchema = z.string({ message: "Identificador inválido" }).trim().min(1, "Identificador obrigatório");

function fail(error: unknown): { ok: false; error: string } {
  return failAction(error, "Não foi possível concluir a operação. Tente novamente.", "notifications");
}

function revalidate(): void {
  revalidatePath("/notificacoes");
  revalidatePath("/meu-dia");
}

async function loadOwn(id: string, userId: string): Promise<Notification> {
  const notification = await getById<Notification>(COLLECTIONS.notifications, id);
  if (!notification || notification.userId !== userId) throw new BusinessError("Notificação não encontrada");
  return notification;
}

export async function markRead(id: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("inicio.notificacoes.editar");
    const notificationId = idSchema.parse(id);
    const notification = await loadOwn(notificationId, user.id);
    if (!notification.readAt) await markNotificationRead(notificationId);
    revalidate();
    return { ok: true, data: { id: notificationId } };
  } catch (error) {
    return fail(error);
  }
}

export async function markAllRead(): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requirePermission("inicio.notificacoes.editar");
    const count = await markAllNotificationsRead(user.id);
    revalidate();
    return { ok: true, data: { count } };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteNotification(id: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("inicio.notificacoes.excluir");
    const notificationId = idSchema.parse(id);
    await loadOwn(notificationId, user.id);
    await remove(COLLECTIONS.notifications, notificationId);
    revalidate();
    return { ok: true, data: { id: notificationId } };
  } catch (error) {
    return fail(error);
  }
}
