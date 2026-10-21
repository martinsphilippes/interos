import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { BusinessError } from "@/server/auth/error-classes";
import { activeSiteChat, sendSiteChatMessage, verifyVisitor, visitorThread } from "@/server/conversations/site-chat";

const NO_STORE = { "cache-control": "no-store" };

/** Chat do site (público, token do visitante no cabeçalho x-chat-token): mensagens das conversas DELE. */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  if (!(await activeSiteChat(sp.get("k")))) return NextResponse.json({ ok: false, error: "Chat indisponível" }, { status: 404 });
  const visitorId = verifyVisitor(request.headers.get("x-chat-token"));
  if (!visitorId) return NextResponse.json({ ok: false, error: "Sessão expirada" }, { status: 401 });
  const after = sp.get("after");
  const thread = await visitorThread(visitorId, after && /^\d{4}-\d{2}-\d{2}T/.test(after) ? after : undefined);
  return NextResponse.json({ ok: true, ...thread }, { status: 200, headers: NO_STORE });
}

const sendSchema = z.object({ k: z.string().trim().min(8).max(40), body: z.string().max(5000), id: z.string().trim().min(6).max(40) });

/** Mensagem seguinte do visitante (id gerado no navegador: reenvio não duplica). */
export async function POST(request: NextRequest) {
  let input: z.infer<typeof sendSchema>;
  try {
    input = sendSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Dados inválidos" }, { status: 400 });
  }
  if (!(await activeSiteChat(input.k))) return NextResponse.json({ ok: false, error: "Chat indisponível" }, { status: 404 });
  const visitorId = verifyVisitor(request.headers.get("x-chat-token"));
  if (!visitorId) return NextResponse.json({ ok: false, error: "Sessão expirada" }, { status: 401 });
  try {
    await sendSiteChatMessage(visitorId, input.body, input.id);
    return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE });
  } catch (error) {
    if (error instanceof BusinessError) return NextResponse.json({ ok: false, error: error.message }, { status: 422 });
    console.error("[chat] falha ao enviar", error);
    return NextResponse.json({ ok: false, error: "Não foi possível enviar agora. Tente de novo." }, { status: 500 });
  }
}
