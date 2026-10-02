import { NextResponse } from "next/server";
import { z } from "zod";
import { clearSession, createSession } from "@/server/auth/session";
import { IdentityError, verifyAccessToken } from "@/server/auth/supabase-identity";
import { getById, list } from "@/server/db";
import { COLLECTIONS, type User } from "@/domain/types";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  /** Access token emitido pelo Supabase Auth no navegador. */
  accessToken: z.string().min(1, "accessToken ausente"),
  /** "Lembrar meu acesso": sem lembrar, o cookie dura só a sessão do navegador. */
  remember: z.boolean().optional(),
});

/** Mensagem clara quando o login do Supabase Auth não corresponde a um usuário do INTEROS. */
async function rejectionFor(uid: string, email: string | undefined, provider: string | undefined): Promise<string | null> {
  const user = await getById<User>(COLLECTIONS.users, uid);
  // Só usuário explicitamente ativo recebe sessão (documento sem `active` é tratado como desativado).
  if (user) return user.active === true ? null : "Este usuário está desativado. Fale com o administrador.";
  // O uid não existe em users: pode ser um login Microsoft com e-mail já cadastrado por outro método.
  const normalized = email?.trim().toLowerCase();
  if (normalized) {
    const candidates = new Set([normalized, email!.trim()]);
    for (const candidate of candidates) {
      const matches = await list<User>(COLLECTIONS.users, { where: [["email", "==", candidate]], limit: 1 });
      if (matches.length > 0) {
        return provider === "azure"
          ? "Conta Microsoft não vinculada; fale com o administrador."
          : "Esta conta não está vinculada ao seu usuário do INTEROS; fale com o administrador.";
      }
    }
  }
  return provider === "azure"
    ? "Seu e-mail Microsoft não tem acesso ao INTEROS. Fale com o administrador."
    : "Este usuário não tem acesso ao INTEROS. Fale com o administrador.";
}

/** Troca o access token do Supabase Auth por um cookie de sessão httpOnly (só para usuários cadastrados e ativos). */
export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "accessToken ausente" }, { status: 400 });
  }
  try {
    const identity = await verifyAccessToken(body.accessToken);
    const rejection = await rejectionFor(identity.uid, identity.email, identity.provider);
    if (rejection) return NextResponse.json({ error: rejection, code: "not_linked" }, { status: 403 });
    const { uid } = await createSession(identity.uid, { remember: body.remember });
    return NextResponse.json({ ok: true, uid });
  } catch (error) {
    if (error instanceof IdentityError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[auth] falha ao criar sessão", error);
    return NextResponse.json({ error: "Não foi possível entrar. Tente novamente." }, { status: 503 });
  }
}

export async function DELETE() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
