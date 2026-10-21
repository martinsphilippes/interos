import { requireApiPermission } from "@/server/auth/session";
import { voiceAccessToken } from "@/server/integrations/twilio";

/** Token do softphone (comunicacao.ligacoes.ligar). Sem a telefonia configurada: 503 (o softphone mostra o discador). */
export async function GET() {
  const user = await requireApiPermission("comunicacao.ligacoes.ligar");
  if (user instanceof Response) return user;
  const token = voiceAccessToken(user.id);
  if (!token) return Response.json({ ok: false, error: "Telefonia não configurada" }, { status: 503 });
  return Response.json({ ok: true, identity: user.id, ...token }, { headers: { "cache-control": "no-store" } });
}
