import { NextResponse, type NextRequest } from "next/server";
import { requireApiPermission } from "@/server/auth/session";
import { BusinessError } from "@/server/auth/error-classes";
import { META_STATE_COOKIE, completeMetaLogin } from "@/server/conversations/channel-setup";
import { publicBase } from "@/server/telephony/webhook";

/**
 * Retorno do login da Meta (Facebook Login): confere a sessão e a permissão, o «state» (cookie de 10 min) e conclui a
 * conexão (uma página: conecta; várias: a tela pede para escolher). Sempre volta para Canais e filas › Instagram e
 * Messenger com o resultado na URL (?meta=ok|escolher|erro&motivo=).
 */
export async function GET(request: NextRequest) {
  const user = await requireApiPermission("comunicacao.canais.social.editar");
  if (user instanceof Response) return user;
  const base = publicBase(request);
  const back = (params: Record<string, string>) => {
    const res = NextResponse.redirect(`${base}/comunicacao/canais?aba=social&${new URLSearchParams(params).toString()}`);
    res.cookies.delete({ name: META_STATE_COOKIE, path: "/api/integrations/meta" });
    return res;
  };
  const sp = request.nextUrl.searchParams;
  const state = sp.get("state");
  const expected = request.cookies.get(META_STATE_COOKIE)?.value;
  if (sp.get("error")) return back({ meta: "erro", motivo: sp.get("error_description") ?? "Login cancelado" });
  if (!state || !expected || state !== expected) return back({ meta: "erro", motivo: "Login expirado ou aberto em outra janela. Tente de novo." });
  const code = sp.get("code");
  if (!code) return back({ meta: "erro", motivo: "A Meta não devolveu o código do login." });
  try {
    const r = await completeMetaLogin(code, `${base}/api/integrations/meta/callback`, { id: user.id, name: user.name });
    return back({ meta: r.connected ? "ok" : "escolher" });
  } catch (error) {
    if (!(error instanceof BusinessError)) console.error("[meta] falha no retorno do login", error);
    return back({ meta: "erro", motivo: error instanceof BusinessError ? error.message : "Falha ao concluir o login da Meta." });
  }
}
