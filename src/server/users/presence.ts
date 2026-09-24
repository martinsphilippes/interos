"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { COLLECTIONS, USER_PRESENCES, USER_PRESENCE_LABELS, type ActionResult, type User, type UserPresence } from "@/domain/types";

const presenceSchema = z.object({ presence: z.enum(USER_PRESENCES, { message: "Presença inválida" }) });

/**
 * Atualiza a presença do próprio usuário (Online/Ausente/Ocupado) exibida na top bar das telas operacionais.
 * Não revalida rotas: o seletor já mostra o novo valor e nenhuma outra tela depende dele por enquanto.
 */
export async function setPresence(input: unknown): Promise<ActionResult<{ presence: UserPresence; presenceUpdatedAt: string }>> {
  try {
    const user = await requireUser();
    const { presence } = presenceSchema.parse(input);
    if (user.presence === presence) return { ok: true, data: { presence, presenceUpdatedAt: user.presenceUpdatedAt ?? nowIso() } };
    const presenceUpdatedAt = nowIso();
    await update<User>(COLLECTIONS.users, user.id, { presence, presenceUpdatedAt });
    await emitEvent({
      type: "user.updated",
      actor: { id: user.id, name: user.name },
      entity: { type: "user", id: user.id },
      title: `${user.name} ficou ${USER_PRESENCE_LABELS[presence].toLowerCase()}`,
      department: user.departmentId,
      payload: { changed: ["presença"], presence },
    });
    return { ok: true, data: { presence, presenceUpdatedAt } };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: error.issues[0]?.message ?? "Dados inválidos" };
    unstable_rethrow(error); // redirect() de requireUser deve propagar.
    console.error("[presence] falha ao salvar presença", error);
    return { ok: false, error: "Não foi possível atualizar sua presença" };
  }
}
