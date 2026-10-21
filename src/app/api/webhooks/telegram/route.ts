import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { receiveInboundMessage } from "@/server/conversations/inbound";
import { logChannelEvent } from "@/server/conversations/channel-events";
import { extractTelegramMessage, telegramSecretValid } from "@/server/integrations/telegram";

/**
 * Webhook do Telegram: confere o segredo (X-Telegram-Bot-Api-Secret-Token, gerado ao conectar o bot e guardado
 * cifrado). Mensagem de conversa privada com o bot entra na Central; o resto é ignorado. Responde 200 mesmo com falha
 * de uma mensagem (o Telegram reenviaria).
 */
export async function POST(request: NextRequest) {
  if (!(await telegramSecretValid(request.headers.get("x-telegram-bot-api-secret-token")))) {
    await logChannelEvent({ channel: "telegram", kind: "autenticacao", result: "recusado", detail: "Aviso do Telegram sem o segredo certo (ou bot desconectado): recusado sem processar." });
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }
  const m = extractTelegramMessage(update);
  if (!m) return NextResponse.json({ processed: 0 }, { status: 200 });
  try {
    await receiveInboundMessage({ channel: "telegram", from: m.chatId, body: m.body, externalId: m.externalId, displayName: m.displayName, at: m.at });
    try {
      revalidatePath("/comunicacao");
    } catch {
      // revalidação é melhor esforço
    }
  } catch (error) {
    console.error("[webhook:telegram] falha ao processar mensagem", error);
    await logChannelEvent({ channel: "telegram", kind: "mensagem_recebida", result: "falha", detail: "Falha ao processar a mensagem (detalhes no log do servidor).", externalId: m.externalId, contact: m.chatId });
  }
  return NextResponse.json({ processed: 1 }, { status: 200 });
}
