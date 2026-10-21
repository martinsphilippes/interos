"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { nowIso } from "@/server/db";
import { emitEvent } from "@/server/events";
import { COLLECTIONS, USER_PRESENCES, USER_PRESENCE_LABELS, type ActionResult, type User, type UserPresence } from "@/domain/types";

const presenceSchema = z.object({ presence: z.enum(USER_PRESENCES, { message: "Presença inválida" }), pauseReasonKey: z.string().trim().max(40).optional() });

/**
 * Atualiza a presença do próprio usuário (Online/Ausente/Ocupado) exibida na top bar das telas operacionais.
 * Não revalida rotas: o seletor já mostra o novo valor. Ao ficar online, distribui as conversas que esperam na fila da
 * Central de Atendimento (a distribuição só entrega a quem está online).
 */
export async function setPresence(input: unknown): Promise<ActionResult<{ presence: UserPresence; presenceUpdatedAt: string }>> {
  try {
    const user = await requireUser();
    const { presence, pauseReasonKey } = presenceSchema.parse(input);
    // Pausa exige um motivo cadastrado (Canais e filas › Pausas).
    let reasonLabel: string | undefined;
    if (presence === "pausa") {
      const { getPauseReasons } = await import("@/server/conversations/ops-settings");
      const reason = (await getPauseReasons()).find((r) => r.active && r.key === pauseReasonKey);
      if (!reason) return { ok: false, error: "Escolha o motivo da pausa" };
      reasonLabel = reason.label;
    }
    if (user.presence === presence && (presence !== "pausa" || user.pauseReasonKey === pauseReasonKey)) return { ok: true, data: { presence, presenceUpdatedAt: user.presenceUpdatedAt ?? nowIso() } };
    const presenceUpdatedAt = nowIso();
    const { patchFields } = await import("@/server/conversations/store");
    await patchFields<User>(COLLECTIONS.users, user.id, { presence, presenceUpdatedAt, pauseReasonKey: presence === "pausa" ? pauseReasonKey : undefined });
    await emitEvent({
      type: "user.updated",
      actor: { id: user.id, name: user.name },
      entity: { type: "user", id: user.id },
      title: `${user.name} ficou ${USER_PRESENCE_LABELS[presence].toLowerCase()}${reasonLabel ? ` (${reasonLabel.toLowerCase()})` : ""}`,
      department: user.departmentId,
      payload: { changed: ["presença"], presence, pauseReasonKey: presence === "pausa" ? pauseReasonKey : undefined },
    });
    // Ficou online: a Central de Atendimento entrega as conversas que esperam na fila (nunca falha a troca de presença).
    if (presence === "online") {
      const { distributeWaitingSafely } = await import("@/server/conversations/service");
      await distributeWaitingSafely();
    }
    return { ok: true, data: { presence, presenceUpdatedAt } };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: error.issues[0]?.message ?? "Dados inválidos" };
    unstable_rethrow(error); // redirect() de requireUser deve propagar.
    console.error("[presence] falha ao salvar presença", error);
    return { ok: false, error: "Não foi possível atualizar sua presença" };
  }
}
