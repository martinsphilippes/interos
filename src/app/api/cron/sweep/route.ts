import { NextResponse, type NextRequest } from "next/server";
import { runSweeps } from "@/server/automations/scheduler";

/**
 * Varreduras agendadas do INTEROS (Vercel Cron: ver vercel.json, 1x por dia no plano Hobby).
 *
 * Autenticação: header "authorization: Bearer <CRON_SECRET>" (a Vercel envia automaticamente quando
 * a env CRON_SECRET existe). Sem CRON_SECRET, só aceita chamadas locais fora de produção.
 * Parâmetros opcionais: ?force=1 (ignora a frequência) e ?only=sla_alerts,renovacoes (chaves de
 * varredura ou IDs de regra agendada).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) return request.headers.get("authorization") === `Bearer ${secret}`;
  if (process.env.NODE_ENV === "production") return false;
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "");
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return LOCAL_HOSTS.has(host) && (!forwarded || LOCAL_HOSTS.has(forwarded));
}

async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const force = params.get("force") === "1" || params.get("force") === "true";
  const only = params.get("only")?.split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const report = await runSweeps({ force, only });
    const errors = report.items.filter((i) => i.status === "erro").length;
    return NextResponse.json({ ok: errors === 0, report }, { status: errors === 0 ? 200 : 207 });
  } catch (error) {
    console.error("[cron] falha nas varreduras", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Falha nas varreduras" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
