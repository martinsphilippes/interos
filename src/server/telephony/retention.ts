import "server-only";
/** Prazo da política de gravação: apaga no provedor as gravações mais velhas que o prazo (até 100 por execução). */
import { list, nowIso, update } from "@/server/db";
import { COLLECTIONS, type Communication } from "@/domain/types";
import { deleteRecording, twilioConfigured } from "@/server/integrations/twilio";
import { getRecordingPolicy } from "@/server/conversations/ops-settings";

export async function purgeExpiredRecordings(now: Date = new Date()): Promise<number> {
  if (!twilioConfigured()) return 0;
  const policy = await getRecordingPolicy();
  const cutoff = new Date(now.getTime() - policy.retentionDays * 86_400_000).toISOString();
  const old = (await list<Communication>(COLLECTIONS.communications, { where: [["channel", "==", "voip"]] })).filter((c) => c.recordingSid && !c.recordingDeletedAt && c.createdAt < cutoff).slice(0, 100);
  let deleted = 0;
  for (const c of old) {
    const sids = [c.recordingSid!, ...(c.recordingParts ?? [])];
    const results = await Promise.all(sids.map((sid) => deleteRecording(sid)));
    if (results.every(Boolean)) {
      await update<Communication>(COLLECTIONS.communications, c.id, { recordingDeletedAt: nowIso() });
      deleted += 1;
    }
  }
  return deleted;
}
