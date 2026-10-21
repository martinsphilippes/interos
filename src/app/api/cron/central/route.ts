import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runCentralSweep } from "@/server/conversations/scheduler";

/**
 * Agendador da Central de Atendimento (ver src/server/conversations/scheduler.ts). Chamado a cada 5 minutos pelo
 * pg_cron do Supabase (supabase/agendador-central.sql), porque o plano atual da Vercel só agenda uma vez por dia.
 *
 * Autenticação: header "authorization: Bearer <CRON_SECRET>" (o mesmo segredo do /api/cron/sweep). Sem CRON_SECRET,
 * só aceita chamadas locais fora de produção.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) return safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`);
  if (process.env.NODE_ENV === "production") return false;
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "");
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return LOCAL_HOSTS.has(host) && (!forwarded || LOCAL_HOSTS.has(forwarded));
}

async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  try {
    const report = await runCentralSweep();
    const failed = report.steps.filter((s) => !s.ok).length;
    return NextResponse.json({ ok: failed === 0, report }, { status: failed === 0 ? 200 : 207 });
  } catch (error) {
    console.error("[cron:central] falha", error);
    return NextResponse.json({ ok: false, error: "Falha no agendador da Central" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
