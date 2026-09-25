import type { DocumentData, Query, WhereFilterOp } from "firebase-admin/firestore";
import { firestore } from "./firebase-admin";
import type { BaseEntity, CollectionName } from "@/domain/types";
import { ORGANIZATION_ID } from "@/domain/constants";

/**
 * Camada de acesso ao Firestore.
 *
 * Regras:
 * - Só filtros de igualdade (==, in, array-contains). Ordene e filtre em memória.
 * - Todo documento recebe organizationId, createdAt e updatedAt.
 * - Datas em ISO 8601.
 */

export const ORG_ID = process.env.INTEROS_ORGANIZATION_ID ?? ORGANIZATION_ID;

export type EqualityOp = Extract<WhereFilterOp, "==" | "in" | "array-contains" | "!=" | "array-contains-any">;
export type WhereClause = [field: string, op: EqualityOp, value: unknown];

export interface ListOptions {
  where?: WhereClause[];
  limit?: number;
  /** Só use orderBy sem `where` (ou apenas com organizationId) para não exigir índice composto. */
  orderBy?: [field: string, direction: "asc" | "desc"];
  /** Por padrão toda consulta é filtrada pela organização. Desative apenas em casos especiais. */
  scopeToOrg?: boolean;
}

export const nowIso = () => new Date().toISOString();

export function col(name: CollectionName) {
  return firestore.collection(name);
}

export function newId(name: CollectionName): string {
  return col(name).doc().id;
}

function toEntity<T extends BaseEntity>(id: string, data: DocumentData | undefined): T | null {
  if (!data) return null;
  return { ...(data as Omit<T, "id">), id } as T;
}

export async function getById<T extends BaseEntity>(name: CollectionName, id: string): Promise<T | null> {
  if (!id) return null;
  const snap = await col(name).doc(id).get();
  const entity = toEntity<T>(snap.id, snap.data());
  if (entity && entity.organizationId && entity.organizationId !== ORG_ID) return null;
  return entity;
}

export async function getManyByIds<T extends BaseEntity>(name: CollectionName, ids: string[]): Promise<Map<string, T>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const result = new Map<string, T>();
  if (unique.length === 0) return result;
  const refs = unique.map((id) => col(name).doc(id));
  const snaps = await firestore.getAll(...refs);
  for (const snap of snaps) {
    const entity = toEntity<T>(snap.id, snap.data());
    if (entity) result.set(snap.id, entity);
  }
  return result;
}

export async function list<T extends BaseEntity>(name: CollectionName, options: ListOptions = {}): Promise<T[]> {
  const where = options.where ?? [];
  // Firestore limita `in` a 30 valores: divide em lotes e concatena.
  const big = where.find(([, op, value]) => op === "in" && Array.isArray(value) && value.length > 30);
  if (big) {
    const [field, , value] = big;
    const values = value as unknown[];
    const out: T[] = [];
    for (let i = 0; i < values.length; i += 30) {
      const chunk = values.slice(i, i + 30);
      const rest = where.filter((w) => w !== big);
      out.push(...(await list<T>(name, { ...options, where: [...rest, [field, "in", chunk]] })));
    }
    return out;
  }
  if (where.some(([, op, value]) => op === "in" && Array.isArray(value) && value.length === 0)) return [];

  let query: Query = col(name);
  if (options.scopeToOrg !== false) query = query.where("organizationId", "==", ORG_ID);
  for (const [field, op, value] of where) query = query.where(field, op, value);
  if (options.orderBy && where.length === 0) query = query.orderBy(options.orderBy[0], options.orderBy[1]);
  if (options.limit && !(options.orderBy && where.length > 0)) query = query.limit(options.limit);
  const snap = await query.get();
  let items = snap.docs.map((d) => toEntity<T>(d.id, d.data())).filter((x): x is T => x !== null);
  if (options.orderBy && where.length > 0) {
    const [field, dir] = options.orderBy;
    items.sort((a, b) => compareField(a, b, field, dir));
    if (options.limit) items = items.slice(0, options.limit);
  }
  return items;
}

export function compareField<T>(a: T, b: T, field: string, dir: "asc" | "desc" = "asc"): number {
  const av = (a as Record<string, unknown>)[field];
  const bv = (b as Record<string, unknown>)[field];
  if (av === bv) return 0;
  if (av === undefined || av === null) return 1;
  if (bv === undefined || bv === null) return -1;
  const result = av < bv ? -1 : 1;
  return dir === "asc" ? result : -result;
}

export type CreateInput<T extends BaseEntity> = Omit<T, "id" | "organizationId" | "createdAt" | "updatedAt"> &
  Partial<Pick<T, "organizationId" | "createdAt" | "updatedAt">>;

export async function create<T extends BaseEntity>(name: CollectionName, data: CreateInput<T>, id?: string): Promise<T> {
  const ref = id ? col(name).doc(id) : col(name).doc();
  const now = nowIso();
  const doc = {
    ...data,
    organizationId: data.organizationId ?? ORG_ID,
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now,
  } as Omit<T, "id">;
  await ref.set(stripUndefined(doc));
  return { ...doc, id: ref.id } as T;
}

export async function update<T extends BaseEntity>(name: CollectionName, id: string, data: Partial<Omit<T, "id">>): Promise<void> {
  await col(name)
    .doc(id)
    .set(stripUndefined({ ...data, updatedAt: nowIso() }), { merge: true });
}

export async function remove(name: CollectionName, id: string): Promise<void> {
  await col(name).doc(id).delete();
}

/** Escreve vários documentos em lote (máx. 500 por lote; divide automaticamente). */
export async function batchSet(
  writes: { collection: CollectionName; id: string; data: Record<string, unknown>; merge?: boolean }[],
): Promise<void> {
  for (let i = 0; i < writes.length; i += 450) {
    const batch = firestore.batch();
    for (const w of writes.slice(i, i + 450)) {
      batch.set(col(w.collection).doc(w.id), stripUndefined(w.data), { merge: w.merge ?? false });
    }
    await batch.commit();
  }
}

/** Remove chaves com `undefined` (o Firestore rejeita undefined sem ignoreUndefinedProperties em objetos aninhados). */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

/** Deleta todos os documentos de uma coleção da organização (usado pelo seed). */
export async function clearCollection(name: CollectionName): Promise<number> {
  const snap = await col(name).where("organizationId", "==", ORG_ID).get();
  let count = 0;
  for (let i = 0; i < snap.docs.length; i += 450) {
    const batch = firestore.batch();
    for (const d of snap.docs.slice(i, i + 450)) {
      batch.delete(d.ref);
      count++;
    }
    await batch.commit();
  }
  return count;
}
