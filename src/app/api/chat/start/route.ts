import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { BusinessError } from "@/server/auth/error-classes";
import { activeSiteChat, startSiteChat } from "@/server/conversations/site-chat";
import { domainAllowed, normalizeDomain } from "@/domain/site-chat";
import { publicBase } from "@/server/telephony/webhook";

const schema = z.object({
  k: z.string().trim().min(8).max(40),
  name: z.string().max(200),
  email: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  message: z.string().max(5000),
  pageUrl: z.string().max(1000).optional(),
});

/**
 * Chat do site (público): primeira mensagem do visitante. Confere a chave do chat, o site de origem (lista de sites
 * permitidos), o formulário e o limite por IP; abre a conversa na Central e devolve o token do visitante.
 */
export async function POST(request: NextRequest) {
  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Dados inválidos" }, { status: 400 });
  }
  const config = await activeSiteChat(input.k);
  if (!config) return NextResponse.json({ ok: false, error: "Chat indisponível" }, { status: 404 });
  if (!domainAllowed(input.pageUrl, config.allowedDomains) && normalizeDomain(input.pageUrl ?? "") !== normalizeDomain(publicBase(request))) return NextResponse.json({ ok: false, error: "Chat indisponível neste site" }, { status: 403 });
  try {
    const r = await startSiteChat(config, { ...input, ip: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") });
    return NextResponse.json({ ok: true, token: r.token }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof BusinessError) return NextResponse.json({ ok: false, error: error.message }, { status: 422 });
    console.error("[chat] falha ao iniciar", error);
    return NextResponse.json({ ok: false, error: "Não foi possível enviar agora. Tente de novo." }, { status: 500 });
  }
}
