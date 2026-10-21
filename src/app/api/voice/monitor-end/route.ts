import type { NextRequest } from "next/server";
import { readVoiceRequest, twiml } from "@/server/telephony/webhook";
import { supervisorLeft } from "@/server/telephony/monitor";
import { hangupTwiml } from "@/domain/telephony";

/** O gerente saiu da conferência da supervisão (action do <Dial> dele): fecha o registro. Assinatura conferida. */
export async function POST(request: NextRequest) {
  const req = await readVoiceRequest(request);
  if (!req.ok) return req.response;
  const id = request.nextUrl.searchParams.get("call");
  if (id) await supervisorLeft(id);
  return twiml(hangupTwiml());
}
