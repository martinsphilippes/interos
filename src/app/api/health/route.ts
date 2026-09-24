import { NextResponse } from "next/server";
import { isFirebaseConfigured, missingFirebaseEnvVars } from "@/lib/firebase";

/**
 * Health check usado por monitoramento e pelo checklist de setup.
 * Não expõe valores de configuração, apenas se ela está completa.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const firebaseConfigured = isFirebaseConfigured();
  return NextResponse.json(
    {
      status: "ok",
      service: "interos",
      timestamp: new Date().toISOString(),
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      firebase: {
        configured: firebaseConfigured,
        missing: firebaseConfigured ? [] : missingFirebaseEnvVars(),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
