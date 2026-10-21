import { requireApiPermission } from "@/server/auth/session";
import { getById } from "@/server/db";
import { fetchRecording } from "@/server/integrations/twilio";
import { COLLECTIONS, type Communication, type RecordingAccessLog } from "@/domain/types";

const ACCESS_TTL_MS = 15 * 60_000;

/**
 * Áudio da gravação, servido pelo INTEROS (o provedor nunca fica exposto). O id é o do registro de acesso criado por
 * openRecordingAction (escopo, política e motivo já conferidos): só vale para quem abriu e por 15 minutos.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiPermission("comunicacao.ligacoes.gravacoes.ouvir");
  if (user instanceof Response) return user;
  const { id } = await params;
  const access = await getById<RecordingAccessLog>(COLLECTIONS.recordingAccessLogs, id);
  if (!access || access.userId !== user.id || Date.now() - new Date(access.at).getTime() > ACCESS_TTL_MS) return Response.json({ ok: false, error: "Acesso expirado: abra a gravação de novo." }, { status: 403 });
  const call = await getById<Communication>(COLLECTIONS.communications, access.communicationId);
  if (!call?.recordingSid || call.recordingDeletedAt) return Response.json({ ok: false, error: "Gravação indisponível." }, { status: 404 });
  const audio = await fetchRecording(call.recordingSid);
  if (!audio?.body) return Response.json({ ok: false, error: "Não foi possível ler a gravação no provedor." }, { status: 502 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(audio.body, {
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": "private, no-store",
      ...(download ? { "content-disposition": `attachment; filename="ligacao-${call.id}.mp3"` } : {}),
    },
  });
}
