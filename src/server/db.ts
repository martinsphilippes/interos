import type { DocumentData, DocumentReference, DocumentSnapshot, Query, Transaction, WhereFilterOp } from "firebase-admin/firestore";
import { firestore } from "./firebase-admin";
import { COLLECTIONS, type BaseEntity, type CollectionName } from "@/domain/types";
import { ORGANIZATION_ID } from "@/domain/constants";
import { dateKey } from "@/lib/format";

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

/** true quando o documento pertence à organização do processo. Documento sem `organizationId` é negado. */
function belongsToOrg(entity: BaseEntity): boolean {
  return entity.organizationId === ORG_ID;
}

/** Documento pelo id, ou null se não existe, não tem `organizationId` ou é de outra organização. */
export async function getById<T extends BaseEntity>(name: CollectionName, id: string): Promise<T | null> {
  if (!id) return null;
  const snap = await col(name).doc(id).get();
  const entity = toEntity<T>(snap.id, snap.data());
  if (!entity || !belongsToOrg(entity)) return null;
  return entity;
}

/**
 * Leitura dentro de transação com o mesmo isolamento de getById: documento inexistente, sem `organizationId` ou de
 * outra organização volta como null (o chamador trata como "não encontrado").
 */
export async function txGetOwn(tx: Transaction, ref: DocumentReference): Promise<DocumentSnapshot | null> {
  const snap = await tx.get(ref);
  if (!snap.exists || snap.get("organizationId") !== ORG_ID) return null;
  return snap;
}

export async function getManyByIds<T extends BaseEntity>(name: CollectionName, ids: string[]): Promise<Map<string, T>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const result = new Map<string, T>();
  if (unique.length === 0) return result;
  const refs = unique.map((id) => col(name).doc(id));
  const snaps = await firestore.getAll(...refs);
  for (const snap of snaps) {
    const entity = toEntity<T>(snap.id, snap.data());
    // Mesma checagem de getById: fora da organização (ou sem organizationId) não entra no mapa.
    if (entity && belongsToOrg(entity)) result.set(snap.id, entity);
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

// ---------------------------------------------------------------------------
// Criação idempotente e numeração transacional
// ---------------------------------------------------------------------------

/** true quando o erro do Firestore é ALREADY_EXISTS (gRPC 6). */
export function isAlreadyExists(error: unknown): boolean {
  return (error as { code?: number | string }).code === 6 || /already exists/i.test(String((error as Error)?.message));
}

/**
 * Cria o documento `id` apenas se ele ainda não existe (atômico: `doc().create()` falha com ALREADY_EXISTS).
 * Diferente de `create`, nunca sobrescreve. Devolve `{ created, doc }`: quando já existia, `doc` é o documento
 * gravado (o primeiro a chegar vence). Use com ids determinísticos para idempotência entre execuções concorrentes.
 */
export async function createIfAbsent<T extends BaseEntity>(name: CollectionName, id: string, data: CreateInput<T>): Promise<{ created: boolean; doc: T }> {
  const ref = col(name).doc(id);
  const now = nowIso();
  const doc = {
    ...data,
    organizationId: data.organizationId ?? ORG_ID,
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now,
  } as Omit<T, "id">;
  try {
    await ref.create(stripUndefined(doc));
    return { created: true, doc: { ...doc, id } as T };
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const snap = await ref.get();
    return { created: false, doc: { ...(snap.data() as Omit<T, "id">), id } as T };
  }
}

export interface NextNumberOptions {
  /** Ano do número (AAAA). Padrão: ano corrente no fuso da operação. `null` = sem ano ("PREFIXO-NNNN"). */
  year?: string | null;
  /** Dígitos da sequência (padrão 4). */
  pad?: number;
  /**
   * Coleção (e campo, padrão "number") de onde o contador parte na primeira emissão: o maior número existente
   * com o mesmo prefixo/ano. Garante que a migração para o contador não renumere nem repita documentos antigos.
   */
  initFrom?: { collection: CollectionName; field?: string };
}

/** Id do documento do contador (organização + prefixo + ano). Exportado para o seed gravar contadores coerentes. */
export function counterId(prefix: string, year: string | null): string {
  return `counter_${ORG_ID}_${prefix}${year ? `_${year}` : ""}`;
}

/** Maior sequência já usada em `collection.field` com o cabeçalho informado (ex.: "CT-2026-"). */
async function maxExistingSequence(collection: CollectionName, field: string, head: string): Promise<number> {
  const snap = await col(collection).where("organizationId", "==", ORG_ID).select(field).get();
  let max = 0;
  for (const d of snap.docs) {
    const value = d.get(field);
    if (typeof value !== "string" || !value.startsWith(head)) continue;
    const seq = Number(value.slice(head.length));
    if (Number.isFinite(seq) && seq > max) max = seq;
  }
  return max;
}

/**
 * Próximo número "<PREFIXO>-AAAA-NNNN" (ou "<PREFIXO>-NNNN" com `year: null`) a partir de um contador
 * transacional na coleção `counters` (um documento por organização + prefixo + ano). Duas emissões
 * simultâneas nunca recebem o mesmo número. Na primeira emissão do prefixo/ano o contador parte do maior
 * número já gravado em `initFrom` (sem renumerar documentos existentes).
 */
export async function nextNumber(prefix: string, options: NextNumberOptions = {}): Promise<string> {
  const year = options.year === null ? null : (options.year ?? dateKey(new Date()).slice(0, 4));
  const pad = options.pad ?? 4;
  const head = `${prefix}-${year ? `${year}-` : ""}`;
  const ref = col(COLLECTIONS.counters).doc(counterId(prefix, year));
  // Semente (só lida quando o contador ainda não existe): maior número existente no formato.
  const exists = (await ref.get()).exists;
  const seed = !exists && options.initFrom ? await maxExistingSequence(options.initFrom.collection, options.initFrom.field ?? "number", head) : 0;
  const value = await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? Number(snap.get("value")) || 0 : seed;
    const next = current + 1;
    const now = nowIso();
    if (snap.exists) tx.update(ref, { value: next, updatedAt: now });
    else tx.set(ref, stripUndefined({ organizationId: ORG_ID, prefix, year: year ?? undefined, value: next, createdAt: now, updatedAt: now }));
    return next;
  });
  return `${head}${String(value).padStart(pad, "0")}`;
}

/** Numeração preparada fora da transação (semente lida antes) para emitir o número DENTRO de outra transação. */
export interface PreparedNumber {
  ref: DocumentReference;
  head: string;
  pad: number;
  prefix: string;
  year: string | null;
  seed: number;
}

/**
 * Prepara `txNextNumber` (mesmo formato e contador de `nextNumber`): calcula a semente quando o contador ainda não
 * existe. Use quando o número precisa nascer na MESMA transação do documento (ex.: título de resíduo criado junto com a
 * baixa — se a transação falhar, nem o título nem o número ficam gravados).
 */
export async function prepareNextNumber(prefix: string, options: NextNumberOptions = {}): Promise<PreparedNumber> {
  const year = options.year === null ? null : (options.year ?? dateKey(new Date()).slice(0, 4));
  const pad = options.pad ?? 4;
  const head = `${prefix}-${year ? `${year}-` : ""}`;
  const ref = col(COLLECTIONS.counters).doc(counterId(prefix, year));
  const exists = (await ref.get()).exists;
  const seed = !exists && options.initFrom ? await maxExistingSequence(options.initFrom.collection, options.initFrom.field ?? "number", head) : 0;
  return { ref, head, pad, prefix, year, seed };
}

/**
 * Lê o contador NA transação (fase de leituras) e devolve o número e a escrita do contador (chamar `commit` na fase de
 * escritas). Concorrência: a transação do Firestore repete quando o contador muda no meio.
 */
export async function txNextNumber(tx: Transaction, prepared: PreparedNumber): Promise<{ code: string; commit: () => void }> {
  const snap = await tx.get(prepared.ref);
  const current = snap.exists ? Number(snap.get("value")) || 0 : prepared.seed;
  const next = current + 1;
  return {
    code: `${prepared.head}${String(next).padStart(prepared.pad, "0")}`,
    commit: () => {
      const now = nowIso();
      if (snap.exists) tx.update(prepared.ref, { value: next, updatedAt: now });
      else tx.set(prepared.ref, stripUndefined({ organizationId: ORG_ID, prefix: prepared.prefix, year: prepared.year ?? undefined, value: next, createdAt: now, updatedAt: now }));
    },
  };
}
