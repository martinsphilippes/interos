import "server-only";
/**
 * Gravação parcial com remoção explícita: campo `undefined` no patch é APAGADO do documento (o `update` de db.ts
 * descarta `undefined`, o que deixaria o valor antigo — ex.: tirar a regra de SLA de uma fila ou o responsável de
 * uma conversa).
 */
import { col, nowIso } from "@/server/db";
import { FieldValue } from "@/server/docdb";
import type { BaseEntity, CollectionName } from "@/domain/types";

export async function patchFields<T extends BaseEntity>(name: CollectionName, id: string, patch: Partial<Omit<T, "id">>): Promise<void> {
  const data: Record<string, unknown> = { updatedAt: nowIso() };
  for (const [key, value] of Object.entries(patch)) data[key] = value === undefined ? FieldValue.delete() : value;
  await col(name).doc(id).update(data);
}
