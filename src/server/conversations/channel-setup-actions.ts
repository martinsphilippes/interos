"use server";
/**
 * Server Actions para conectar os canais da fase 5 (Canais e filas): login da Meta (Instagram/Messenger), escolha da
 * página, Telegram (token do bot) e desconectar. Padrão: requirePermission → zod → serviço.
 */
import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failAction, requirePermission } from "@/server/auth/session";
import { BusinessError } from "@/server/auth/error-classes";
import type { ActionResult, CurrentUser, UserRef } from "@/domain/types";
import { metaAppConfigured, metaLoginUrl } from "@/server/integrations/meta-social";
import { META_STATE_COOKIE, chooseMetaPage, connectTelegram, disconnectMeta, disconnectTelegram } from "./channel-setup";

const actor = (u: CurrentUser): UserRef => ({ id: u.id, name: u.name });

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof z.ZodError) return { ok: false, error: error.issues[0]?.message ?? "Dados inválidos" };
  return failAction(error, fallback, "comunicacao");
}

async function baseUrl(): Promise<string> {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? ""}`;
}

/** Começa o login da Meta: devolve o endereço do diálogo e guarda o «state» (contra falsificação) num cookie. */
export async function startMetaLoginAction(): Promise<ActionResult<{ url: string }>> {
  try {
    await requirePermission("comunicacao.canais.social.editar");
    if (!metaAppConfigured()) throw new BusinessError("App da Meta não configurado: defina META_APP_ID e META_APP_SECRET na Vercel.");
    const state = randomBytes(24).toString("base64url");
    (await cookies()).set(META_STATE_COOKIE, state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/integrations/meta", maxAge: 600 });
    return { ok: true, data: { url: metaLoginUrl(`${await baseUrl()}/api/integrations/meta/callback`, state) } };
  } catch (error) {
    return fail(error, "Não foi possível iniciar o login da Meta");
  }
}

export async function chooseMetaPageAction(input: unknown): Promise<ActionResult<{ ok: true }>> {
  try {
    const user = await requirePermission("comunicacao.canais.social.editar");
    const { pageId } = z.object({ pageId: z.string().trim().min(1).max(40) }).parse(input);
    await chooseMetaPage(pageId, actor(user));
    revalidatePath("/comunicacao/canais");
    return { ok: true, data: { ok: true } };
  } catch (error) {
    return fail(error, "Não foi possível conectar a página");
  }
}

export async function disconnectMetaAction(): Promise<ActionResult<{ ok: true }>> {
  try {
    const user = await requirePermission("comunicacao.canais.social.editar");
    await disconnectMeta(actor(user));
    revalidatePath("/comunicacao/canais");
    return { ok: true, data: { ok: true } };
  } catch (error) {
    return fail(error, "Não foi possível desconectar");
  }
}

export async function connectTelegramAction(input: unknown): Promise<ActionResult<{ botUsername: string }>> {
  try {
    const user = await requirePermission("comunicacao.canais.telegram.editar");
    const { token } = z.object({ token: z.string().trim().min(20, "Cole o token do bot").max(100) }).parse(input);
    const r = await connectTelegram(token, await baseUrl(), actor(user));
    revalidatePath("/comunicacao/canais");
    return { ok: true, data: r };
  } catch (error) {
    return fail(error, "Não foi possível conectar o Telegram");
  }
}

export async function disconnectTelegramAction(): Promise<ActionResult<{ ok: true }>> {
  try {
    const user = await requirePermission("comunicacao.canais.telegram.editar");
    await disconnectTelegram(actor(user));
    revalidatePath("/comunicacao/canais");
    return { ok: true, data: { ok: true } };
  } catch (error) {
    return fail(error, "Não foi possível desconectar o Telegram");
  }
}
