import type { NextRequest } from "next/server";
import { readVoiceRequest, twiml } from "@/server/telephony/webhook";
import { applyCallResult, getPabx } from "@/server/telephony/service";
import { handleMonitoredDialResult } from "@/server/telephony/monitor";
import { hangupTwiml, voicemailTwiml } from "@/domain/telephony";

/**
 * Fim do toque/da discagem (action do <Dial>): grava o resultado. Ligação recebida que ninguém atendeu vai para o
 * correio de voz. Ligação sob supervisão: a perna principal entra na conferência (e o fim da conferência grava o
 * resultado). Assinatura da Twilio conferida.
 */
export async function POST(request: NextRequest) {
  const req = await readVoiceRequest(request);
  if (!req.ok) return req.response;
  const { params, base } = req;
  if (params.CallSid) {
    const monitored = await handleMonitoredDialResult(params.CallSid, params, request.nextUrl.searchParams.get("fase"), base);
    if (monitored?.twiml) return twiml(monitored.twiml);
    if (monitored?.finished) return twiml(hangupTwiml());
  }
  const duration = Number(params.DialCallDuration ?? 0) || 0;
  const record = params.CallSid ? await applyCallResult(params.CallSid, params.DialCallStatus, duration) : null;
  if (record?.direction === "entrada" && record.callStatus === "perdida") {
    const pabx = await getPabx();
    return twiml(voicemailTwiml(pabx.noAgentMessage, pabx.voicemail, `${base}/api/voice/voicemail`, `${base}/api/voice/recording?vm=1`));
  }
  return twiml(hangupTwiml());
}
