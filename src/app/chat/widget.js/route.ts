import type { NextRequest } from "next/server";
import { activeSiteChat } from "@/server/conversations/site-chat";
import { chatWidgetJs } from "@/server/conversations/site-chat-page";
import { publicBase } from "@/server/telephony/webhook";

export const dynamic = "force-dynamic";

/** Script do chat para o site da empresa: <script src="https://<INTEROS>/chat/widget.js?k=<chave>" async></script>. */
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("k") ?? "";
  const config = await activeSiteChat(key);
  const headers = { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" };
  // Chat desligado ou chave errada: script vazio (o site não quebra).
  if (!config) return new Response("/* chat do INTEROS indisponível */", { status: 200, headers });
  return new Response(chatWidgetJs(config, publicBase(request), key), { status: 200, headers });
}
