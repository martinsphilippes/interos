import { NextResponse } from "next/server";
import { clearSession, createSession } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/** Troca o ID token do Firebase Auth por um cookie de sessão httpOnly. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { idToken?: string };
    if (!body.idToken) return NextResponse.json({ error: "idToken ausente" }, { status: 400 });
    const { uid } = await createSession(body.idToken);
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
