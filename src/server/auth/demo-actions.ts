"use server";
/**
 * Server Action do acesso rápido da tela de login (modo demonstração). Sem requireUser: é chamada antes do login.
 */
import { z } from "zod";
import type { ActionResult } from "@/domain/types";
import { resolveDemoUser } from "./demo";
import { createSession } from "./session";

const demoSignInSchema = z.object({ userId: z.string().min(1).max(128) });

/** Entra como o usuário escolhido: grava o cookie de sessão (o cliente só navega em seguida). */
export async function demoSignInAction(input: unknown): Promise<ActionResult<{ uid: string }>> {
  const parsed = demoSignInSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Usuário inválido." };
  try {
    const user = await resolveDemoUser(parsed.data.userId);
    return { ok: true, data: await createSession(user.id) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível entrar." };
  }
}
