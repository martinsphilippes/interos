import type { NextRequest } from "next/server";
import { readVoiceRequest, twiml } from "@/server/telephony/webhook";
import { getPabx, recordOutgoingCall } from "@/server/telephony/service";
import { getRecordingPolicy } from "@/server/conversations/ops-settings";
import { defaultCallerId } from "@/server/integrations/twilio";
import { getById } from "@/server/db";
import { COLLECTIONS, type User } from "@/domain/types";
import { hangupTwiml, outgoingTwiml, toE164 } from "@/domain/telephony";

/**
 * Ligação feita pelo softphone (Voice URL do TwiML App): From = "client:<id do usuário>", To = número. Liga com a bina
 * do PABX e grava pela política. Assinatura da Twilio conferida; usuário inativo ou sem ramal não liga.
 */
export async function POST(request: NextRequest) {
  const req = await readVoiceRequest(request);
  if (!req.ok) return req.response;
  const { params, base } = req;
  const userId = (params.From ?? "").replace(/^client:/, "");
  const to = toE164(params.To);
  const user = userId ? await getById<User>(COLLECTIONS.users, userId) : null;
  if (!params.CallSid || !to || !user || user.active === false) return twiml(hangupTwiml(to ? undefined : "Número inválido."));
  const [pabx, policy] = await Promise.all([getPabx(), getRecordingPolicy()]);
  const callerId = pabx.numbers.find((n) => n.active)?.number ?? defaultCallerId();
  if (!callerId) return twiml(hangupTwiml("O PABX ainda não tem número para ligar."));
  await recordOutgoingCall({ callSid: params.CallSid, userId: user.id, to, from: callerId });
  return twiml(outgoingTwiml({ to, callerId, record: policy.enabled, dialAction: `${base}/api/voice/dial-result`, recordingCallback: `${base}/api/voice/recording` }));
}
