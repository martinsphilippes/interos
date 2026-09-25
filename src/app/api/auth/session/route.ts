import { NextResponse } from "next/server";
import { z } from "zod";
import { clearSession, createSession } from "@/server/auth/session";
import { adminAuth } from "@/server/firebase-admin";
import { getById, list } from "@/server/db";
import { COLLECTIONS, type User } from "@/domain/types";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  idToken: z.string().min(1, "idToken ausente"),
  /** "Lembrar meu acesso": sem lembrar, o cookie dura só a sessão do navegador. */
  remember: z.boolean().optional(),
});

/** Mensagem clara quando a conta do Firebase Auth não corresponde a um usuário do INTEROS. */
async function rejectionFor(uid: string, email: string | undefined, provider: string | undefined): Promise<string | null> {
  const user = await getById<User>(COLLECTIONS.users, uid);
  if (user) return user.active === false ? "Este usuário está desativado. Fale com o administrador." : null;
  // O uid não existe em users: pode ser um login Microsoft com e-mail já cadastrado por outro método.
  const normalized = email?.trim().toLowerCase();
  if (normalized) {
    const candidates = new Set([normalized, email!.trim()]);
    for (const candidate of candidates) {
      const matches = await list<User>(COLLECTIONS.users, { where: [["email", "==", candidate]], limit: 1 });
      if (matches.length > 0) {
        return provider === "microsoft.com"
          ? "Conta Microsoft não vinculada; fale com o administrador."
          : "Esta conta não está vinculada ao seu usuário do INTEROS; fale com o administrador.";
      }
    }
  }
  return provider === "microsoft.com"
    ? "Seu e-mail Microsoft não tem acesso ao INTEROS. Fale com o administrador."
    : "Este usuário não tem acesso ao INTEROS. Fale com o administrador.";
}

/** Troca o ID token do Firebase Auth por um cookie de sessão httpOnly (só para usuários cadastrados e ativos). */
export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "idToken ausente" }, { status: 400 });
  }
  try {
    const decoded = await adminAuth.verifyIdToken(body.idToken);
    const rejection = await rejectionFor(decoded.uid, decoded.email, decoded.firebase?.sign_in_provider);
    if (rejection) return NextResponse.json({ error: rejection, code: "not_linked" }, { status: 403 });
    const { uid } = await createSession(body.idToken, { remember: body.remember });
    return NextResponse.json({ ok: true, uid });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao criar sessão";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function DELETE() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
