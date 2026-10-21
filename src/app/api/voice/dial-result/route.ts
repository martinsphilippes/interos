import type { NextRequest } from "next/server";
import { readVoiceRequest, twiml } from "@/server/telephony/webhook";
import { applyCallResult, getPabx } from "@/server/telephony/service";
import { hangupTwiml, voicemailTwiml } from "@/domain/telephony";

/**
 * Fim do toque/da discagem (action do <Dial>): grava o resultado. Ligação recebida que ninguém atendeu vai para o
 * correio de voz. Assinatura da Twilio conferida.
 */
export async function POST(request: NextRequest) {
  const req = await readVoiceRequest(request);
  if (!req.ok) return req.response;
  const { params, base } = req;
  const duration = Number(params.DialCallDuration ?? 0) || 0;
  const record = params.CallSid ? await applyCallResult(params.CallSid, params.DialCallStatus, duration) : null;
  if (record?.direction === "entrada" && record.callStatus === "perdida") {
    const pabx = await getPabx();
    return twiml(voicemailTwiml(pabx.noAgentMessage, pabx.voicemail, `${base}/api/voice/voicemail`, `${base}/api/voice/recording?vm=1`));
  }
  return twiml(hangupTwiml());
}
