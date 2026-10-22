import { NextResponse } from "next/server";
import { BUILD_ID } from "@/lib/version";

/**
 * Id do deploy que está no ar, sem dados nem sessão: o VersionWatcher compara com o id embutido no código da aba e avisa
 * quando saiu versão nova (ver src/lib/version.ts).
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ build: BUILD_ID }, { headers: { "Cache-Control": "no-store" } });
}
