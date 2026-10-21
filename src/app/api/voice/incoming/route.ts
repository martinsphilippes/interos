import type { NextRequest } from "next/server";
import { readVoiceRequest, twiml } from "@/server/telephony/webhook";
import { availableAgents, getPabx, queueForNumber, recordIncomingCall } from "@/server/telephony/service";
import { getRecordingPolicy } from "@/server/conversations/ops-settings";
import { businessStatus } from "@/server/conversations/auto-messages";
import { logChannelEvent } from "@/server/conversations/channel-events";
import { hangupTwiml, incomingTwiml, voicemailTwiml } from "@/domain/telephony";

/**
 * Ligação recebida (Voice URL do número na Twilio): registra a ligação, e — no horário e com alguém disponível — toca
 * em todos os ramais disponíveis da fila do número (com boas-vindas e aviso de gravação). Fora do horário ou sem
 * ninguém: correio de voz (ou só a mensagem). Assinatura da Twilio conferida.
 */
export async function POST(request: NextRequest) {
  const req = await readVoiceRequest(request);
  if (!req.ok) return req.response;
  const { params, base } = req;
  const callSid = params.CallSid;
  if (!callSid) return twiml(hangupTwiml());
  try {
    const [pabx, policy, status] = await Promise.all([getPabx(), getRecordingPolicy(), businessStatus()]);
    const queueId = await queueForNumber(params.To);
    await recordIncomingCall({ callSid, from: params.From ?? "", to: params.To ?? "", queueId });
    const vmAction = `${base}/api/voice/voicemail`;
    const recCallback = `${base}/api/voice/recording`;
    if (!status.open) {
      await logChannelEvent({ channel: "voz", kind: "mensagem_recebida", result: "processado", detail: "Ligação fora do horário: correio de voz.", externalId: callSid, contact: params.From });
      return twiml(voicemailTwiml(pabx.closedMessage, pabx.voicemail, vmAction, `${recCallback}?vm=1`));
    }
    const agents = await availableAgents(queueId);
    if (agents.length === 0) {
      await logChannelEvent({ channel: "voz", kind: "mensagem_recebida", result: "processado", detail: "Ligação sem ninguém disponível: correio de voz.", externalId: callSid, contact: params.From });
      return twiml(voicemailTwiml(pabx.noAgentMessage, pabx.voicemail, vmAction, `${recCallback}?vm=1`));
    }
    await logChannelEvent({ channel: "voz", kind: "mensagem_recebida", result: "processado", detail: `Ligação tocando em ${agents.length} ramal(is).`, externalId: callSid, contact: params.From });
    return twiml(
      incomingTwiml({
        welcome: pabx.welcome,
        recordingNotice: policy.notice,
        record: policy.enabled,
        clients: agents.map((a) => a.id),
        parentCallSid: callSid,
        from: params.From ?? "",
        ringSeconds: pabx.ringSeconds,
        dialAction: `${base}/api/voice/dial-result`,
        recordingCallback: recCallback,
      }),
    );
  } catch (error) {
    console.error("[voz] falha na ligação recebida", error);
    await logChannelEvent({ channel: "voz", kind: "mensagem_recebida", result: "falha", detail: "Falha ao atender a ligação (detalhes no log do servidor).", externalId: callSid, contact: params.From });
    return twiml(hangupTwiml("Desculpe, não foi possível completar sua ligação. Tente novamente em instantes."));
  }
}
