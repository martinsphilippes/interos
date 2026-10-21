import "server-only";
/** Canais conectados pela tela (coleção channel_connections; um documento por tipo, id = tipo). */
import { create, getById, nowIso, remove } from "@/server/db";
import { COLLECTIONS, type ChannelConnection, type UserRef } from "@/domain/types";
import { seal, unseal } from "./vault";

type Kind = ChannelConnection["kind"];

export async function getConnection(kind: Kind): Promise<ChannelConnection | null> {
  return getById<ChannelConnection>(COLLECTIONS.channelConnections, kind);
}

/** Token aberto (só no servidor). Null sem conexão ou com a chave do cofre trocada. */
export async function connectionToken(kind: Kind): Promise<{ connection: ChannelConnection; token: string } | null> {
  const c = await getConnection(kind);
  const token = unseal(c?.tokenSealed);
  return c && token ? { connection: c, token } : null;
}

export async function saveConnection(kind: Kind, data: Omit<ChannelConnection, "id" | "organizationId" | "createdAt" | "updatedAt" | "kind" | "tokenSealed" | "secretSealed" | "connectedAt" | "connectedById" | "connectedByName"> & { token: string; secret?: string }, actor: UserRef): Promise<void> {
  const { token, secret, ...rest } = data;
  const doc = { ...rest, kind, tokenSealed: seal(token), ...(secret ? { secretSealed: seal(secret) } : {}), connectedAt: nowIso(), connectedById: actor.id, connectedByName: actor.name };
  // Substitui por inteiro (nada da conexão anterior sobra, nem o segredo).
  if (await getConnection(kind)) await remove(COLLECTIONS.channelConnections, kind);
  await create<ChannelConnection>(COLLECTIONS.channelConnections, doc as Omit<ChannelConnection, "id" | "organizationId" | "createdAt" | "updatedAt">, kind);
}

export async function removeConnection(kind: Kind): Promise<void> {
  if (await getConnection(kind)) await remove(COLLECTIONS.channelConnections, kind);
}

export function connectionSecret(c: ChannelConnection | null): string | null {
  return unseal(c?.secretSealed);
}
