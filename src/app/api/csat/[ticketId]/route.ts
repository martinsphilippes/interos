import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { csatSubmitSchema } from "@/server/support/schemas";
import { SupportError, isValidCsatToken, submitCsat } from "@/server/support/service";

/**
 * Avaliação pública de CSAT (sem sessão), usada pela página /csat/<ticketId>.
 *
 * POST /api/csat/<ticketId>
 * Corpo JSON: { token: string, score: 0–10, comment?: string }
 * Respostas: 201 { id } · 400 JSON inválido · 403 token inválido · 409 já avaliado / não resolvido ·
 *            422 dados inválidos.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }
  const parsed = csatSubmitSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 422 });
  if (!isValidCsatToken(ticketId, parsed.data.token)) return NextResponse.json({ error: "Link de avaliação inválido" }, { status: 403 });

  try {
    const response = await submitCsat(ticketId, { score: parsed.data.score, comment: parsed.data.comment });
    try {
      revalidatePath("/suporte", "layout");
      revalidatePath(`/clientes/${response.clientId}`);
    } catch (error) {
      console.error("[csat] falha ao revalidar", error);
    }
    return NextResponse.json({ id: response.id }, { status: 201 });
  } catch (error) {
    if (error instanceof SupportError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("[csat] falha ao registrar avaliação", error);
    return NextResponse.json({ error: "Não foi possível registrar a avaliação" }, { status: 500 });
  }
}
