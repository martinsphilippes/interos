"use server";
/**
 * Server Action do acesso rápido da tela de login (modo demonstração). Sem requireUser: é chamada antes do login.
 */
import { z } from "zod";
import type { ActionResult } from "@/domain/types";
import { createDemoToken } from "./demo";

const demoSignInSchema = z.object({ userId: z.string().min(1).max(128) });

export async function demoSignInAction(input: unknown): Promise<ActionResult<{ token: string }>> {
  const parsed = demoSignInSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Usuário inválido." };
  try {
    return { ok: true, data: { token: await createDemoToken(parsed.data.userId) } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível entrar." };
  }
}
