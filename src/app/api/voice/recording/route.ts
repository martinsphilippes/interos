import type { NextRequest } from "next/server";
import { readVoiceRequest } from "@/server/telephony/webhook";
import { applyRecording } from "@/server/telephony/service";

/**
 * Gravação concluída (recordingStatusCallback): liga a gravação à ligação. ?vm=1 = recado. ?call=<CallSid>&parte=1 =
 * gravação da conferência de supervisão (o aviso da conferência não traz a ligação). Assinatura conferida.
 */
export async function POST(request: NextRequest) {
  const req = await readVoiceRequest(request);
  if (!req.ok) return req.response;
  const { params } = req;
  const sp = request.nextUrl.searchParams;
  const part = sp.get("parte") === "1";
  const callSid = part ? sp.get("call") : params.CallSid;
  if (callSid && params.RecordingSid && (params.RecordingStatus ?? "completed") === "completed") {
    await applyRecording(callSid, params.RecordingSid, Number(params.RecordingDuration ?? 0) || undefined, sp.get("vm") === "1", part);
  }
  return new Response(null, { status: 204 });
}
