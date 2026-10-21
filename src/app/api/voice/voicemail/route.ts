import type { NextRequest } from "next/server";
import { readVoiceRequest, twiml } from "@/server/telephony/webhook";
import { applyRecording } from "@/server/telephony/service";
import { hangupTwiml } from "@/domain/telephony";

/** Recado gravado (action do <Record>): marca o recado no correio de voz e avisa a fila. Assinatura conferida. */
export async function POST(request: NextRequest) {
  const req = await readVoiceRequest(request);
  if (!req.ok) return req.response;
  const { params } = req;
  if (params.CallSid && params.RecordingSid) await applyRecording(params.CallSid, params.RecordingSid, Number(params.RecordingDuration ?? 0) || undefined, true);
  return twiml(hangupTwiml("Recado recebido. Obrigado!"));
}
