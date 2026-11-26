"use server";
/** Server Actions da Remuneração variável (Financeiro › Remuneração variável). */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failAction, requirePermission } from "@/server/auth/session";
import type { ActionResult } from "@/domain/types";
import { closeVariablePay } from "./service";

const closeSchema = z.object({
  competence: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Competência inválida (AAAA-MM)"),
  notes: z.string().trim().max(500, "Observação muito longa").optional(),
});

export async function closeVariablePayAction(input: unknown): Promise<ActionResult<{ version: number; total: number }>> {
  try {
    const user = await requirePermission("financeiro.remuneracao-variavel.fechar");
    const data = closeSchema.parse(input);
    const closing = await closeVariablePay(data.competence, { id: user.id, name: user.name }, data.notes || undefined);
    revalidatePath("/financeiro/remuneracao-variavel");
    return { ok: true, data: { version: closing.version, total: closing.total } };
  } catch (error) {
    return failAction(error, "Não foi possível fechar a competência");
  }
}
