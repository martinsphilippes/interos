"use server";
/** Server Action do chat do site: configuração (aparência, formulário, sites permitidos, ligar/desligar). */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failAction, requirePermission } from "@/server/auth/session";
import type { ActionResult } from "@/domain/types";
import { saveSiteChat } from "./site-chat";

const schema = z.object({
  enabled: z.boolean(),
  title: z.string().trim().min(2, "Escreva o título").max(60),
  greeting: z.string().trim().min(2, "Escreva a saudação").max(300),
  color: z.string().trim(),
  position: z.enum(["direita", "esquerda"]),
  askEmail: z.boolean(),
  askPhone: z.boolean(),
  requireContact: z.boolean(),
  allowedDomains: z.array(z.string().trim().min(1)).max(20),
  offlineMessage: z.string().trim().min(5, "Escreva a mensagem fora do horário").max(300),
  privacyNotice: z.string().trim().min(5, "Escreva o aviso de privacidade").max(300),
});

export async function saveSiteChatAction(input: unknown): Promise<ActionResult<{ publicKey: string }>> {
  try {
    const user = await requirePermission("comunicacao.canais.chat.editar");
    const data = schema.parse(input);
    if (data.requireContact && !data.askEmail && !data.askPhone) return { ok: false, error: "Para exigir contato, peça o e-mail ou o telefone" };
    const saved = await saveSiteChat(data, { id: user.id, name: user.name });
    revalidatePath("/comunicacao/canais");
    return { ok: true, data: { publicKey: saved.publicKey } };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: error.issues[0]?.message ?? "Dados inválidos" };
    return failAction(error, "Não foi possível salvar o chat do site", "comunicacao");
  }
}
