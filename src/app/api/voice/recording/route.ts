import type { NextRequest } from "next/server";
import { readVoiceRequest } from "@/server/telephony/webhook";
import { applyRecording } from "@/server/telephony/service";

/** Gravação concluída (recordingStatusCallback): liga a gravação à ligação. ?vm=1 = recado. Assinatura conferida. */
export async function POST(request: NextRequest) {
  const req = await readVoiceRequest(request);
  if (!req.ok) return req.response;
  const { params } = req;
  if (params.CallSid && params.RecordingSid && (params.RecordingStatus ?? "completed") === "completed") {
    await applyRecording(params.CallSid, params.RecordingSid, Number(params.RecordingDuration ?? 0) || undefined, request.nextUrl.searchParams.get("vm") === "1");
  }
  return new Response(null, { status: 204 });
}
