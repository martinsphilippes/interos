import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { receiveErpEvent } from "@/server/erp/inbound";

/**
 * Eventos do ERP Intercert (contrato v2, eventos de saída): licença aplicada ou recusada, mudança automática de
 * módulos, pedido de módulo, limite do contrato atingido e ERP sem licença nova.
 *
 * POST /api/webhooks/erp
 * Header X-ERP-Signature: t=<unix>,v1=<hex> = HMAC-SHA256 de `${t}.${corpo}` com ERP_INTERCERT_SEGREDO_EVENTOS (±5 min).
 * Respostas: 503 sem configuração ou evento já em processamento (o ERP tenta de novo) · 413 corpo acima de 64 KB ·
 *            401 assinatura ausente, vencida ou inválida · 400 corpo inválido · 200 recebido (inclusive repetido ou
 *            ignorado: o ERP não reenvia) · 500 falha inesperada (o ERP tenta de novo, até 12 vezes).
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  try {
    const result = await receiveErpEvent({ rawBody, signature: request.headers.get("x-erp-signature") });
    if (result.clientId) {
      try {
        revalidatePath(`/clientes/${result.clientId}`);
      } catch (error) {
        console.error("[webhook:erp] falha ao revalidar", error);
      }
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[webhook:erp] falha inesperada", error);
    return NextResponse.json({ error: "Falha ao processar o evento" }, { status: 500 });
  }
}
