import { NextResponse, type NextRequest } from "next/server";

/**
 * Proteção leve de rotas: só verifica a presença do cookie de sessão.
 * A verificação real (assinatura, expiração, usuário ativo) acontece no servidor em requireUser().
 */
const SESSION_COOKIE = "interos_session";
// "/portal": Portal do Cliente (D31), público por token na URL (somente leitura; ver src/app/portal/[token]).
// "/redefinir-senha": link do e-mail de definição de senha (Supabase Auth); "/login/microsoft": retorno do OAuth.
const PUBLIC_PATHS = ["/login", "/ativar-conta", "/redefinir-senha", "/privacidade", "/termos", "/offline", "/csat", "/portal"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (pathname === "/login" && hasSession) {
    // Sessão recusada pelo servidor (requireUser → /login?sessao=expirada): apaga o cookie e mostra o login,
    // em vez de mandar de volta para /meu-dia (laço de redirecionamento).
    if (request.nextUrl.searchParams.get("sessao") === "expirada") {
      const response = NextResponse.next();
      response.cookies.delete(SESSION_COOKIE);
      return response;
    }
    return NextResponse.redirect(new URL("/meu-dia", request.url));
  }
  if (!isPublic && !hasSession) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Tudo exceto API, internos do Next, ícones, service worker, manifest e arquivos estáticos.
    "/((?!api|_next/static|_next/image|icons|sw\\.js|manifest.*|favicon\\.ico|.*\\.[a-zA-Z0-9]+$).*)",
  ],
};
