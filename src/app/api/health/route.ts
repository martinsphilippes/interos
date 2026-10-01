import { NextResponse } from "next/server";
import { isSupabaseConfigured, missingSupabaseEnvVars } from "@/lib/supabase";
import { isDemoMode } from "@/lib/demo-mode";

/**
 * Health check usado por monitoramento e pelo checklist de setup.
 * Não expõe valores de configuração, apenas se ela está completa.
 * `demoMode` indica se o acesso rápido (NEXT_PUBLIC_DEMO_MODE) está ligado — deve ser false em produção real.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const supabaseConfigured = isSupabaseConfigured();
  return NextResponse.json(
    {
      status: "ok",
      service: "interos",
      timestamp: new Date().toISOString(),
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      demoMode: isDemoMode(),
      supabase: {
        configured: supabaseConfigured,
        missing: supabaseConfigured ? [] : missingSupabaseEnvVars(),
      },
      database: { configured: Boolean(process.env.DATABASE_URL) },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
