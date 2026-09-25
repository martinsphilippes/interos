"use server";
/**
 * Server Action da busca global (Ctrl+K). Valida o termo e delega para a busca em memória.
 */
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import type { ActionResult } from "@/domain/types";
import { searchGlobalQuery, type SearchResponse } from "./queries";

const termSchema = z.string({ message: "Termo inválido" }).trim().min(2, "Digite pelo menos 2 caracteres").max(80, "Termo muito longo");

export async function searchGlobal(term: unknown): Promise<ActionResult<SearchResponse>> {
  const user = await requireUser();
  try {
    const value = termSchema.parse(term);
    return { ok: true, data: await searchGlobalQuery(value, { admin: user.role === "admin" }) };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: error.issues.map((i) => i.message).join(" · ") };
    console.error("[search]", error);
    return { ok: false, error: "Não foi possível buscar agora. Tente novamente." };
  }
}
