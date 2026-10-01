import "server-only";
/**
 * Persistência de baixo nível das comissões e títulos: ids determinísticos, numeração e transições de status em
 * transação (uma transição só acontece se o documento ainda está no status esperado — duas execuções simultâneas do
 * motor, de um handler e da varredura, nunca emitem o mesmo evento nem geram o mesmo título duas vezes).
 */
import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "@/server/firebase-admin";
import { col, nextNumber, nowIso, stripUndefined, txGetOwn, update } from "@/server/db";
import { dateKey } from "@/lib/format";
import { COLLECTIONS, type Commission, type CommissionHistoryEntry, type CommissionStatus, type Payable, type UserRef } from "@/domain/types";

export const SYSTEM_ACTOR: UserRef = { id: "system", name: "INTEROS (automação)" };

/** Id determinístico da comissão: com_<hash curto e estável da chave de idempotência>. */
export function commissionIdFor(sourceKey: string): string {
  return `com_${createHash("sha1").update(sourceKey).digest("hex").slice(0, 20)}`;
}

/** Numeração COM-AAAA-NNNNN (só chamada quando o documento acabou de ser criado). */
export async function assignCommissionCode(id: string, createdAt: string): Promise<string> {
  const code = await nextNumber("COM", { pad: 5, year: dateKey(createdAt).slice(0, 4), initFrom: { collection: COLLECTIONS.commissions, field: "code" } });
  await update<Commission>(COLLECTIONS.commissions, id, { code });
  return code;
}

/** Numeração PAG-AAAA-NNNNN (só chamada quando o título acabou de ser criado). */
export async function assignPayableCode(id: string, createdAt: string): Promise<string> {
  const code = await nextNumber("PAG", { pad: 5, year: dateKey(createdAt).slice(0, 4), initFrom: { collection: COLLECTIONS.payables, field: "code" } });
  await update<Payable>(COLLECTIONS.payables, id, { code });
  return code;
}

export function historyEntry(actor: UserRef, to: CommissionStatus, from?: CommissionStatus, note?: string, at?: string): CommissionHistoryEntry {
  return stripUndefined({ at: at ?? nowIso(), by: actor.id, byName: actor.name, from, to, note });
}

export type CommissionPatch = Partial<Record<keyof Commission, unknown>>;

/**
 * Transição transacional: lê a comissão, confere que o status atual está em `allowed`, aplica o patch (objeto ou
 * função do documento atual; função devolvendo null = desistir) e anexa `entry` ao histórico. Devolve antes/depois
 * ou null quando nada mudou (status diferente do esperado, documento inexistente ou desistência).
 */
export async function transitionCommission(
  id: string,
  allowed: readonly CommissionStatus[],
  patch: CommissionPatch | ((current: Commission) => CommissionPatch | null),
  entry?: CommissionHistoryEntry,
): Promise<{ before: Commission; after: Commission } | null> {
  const ref = col(COLLECTIONS.commissions).doc(id);
  return firestore.runTransaction(async (tx) => {
    // Comissão de outra organização = inexistente (mesmo isolamento de getById).
    const snap = await txGetOwn(tx, ref);
    if (!snap) return null;
    const before = { ...(snap.data() as Omit<Commission, "id">), id } as Commission;
    if (!allowed.includes(before.status)) return null;
    const resolved = typeof patch === "function" ? patch(before) : patch;
    if (!resolved) return null;
    const data = cleanPatch({ ...resolved, updatedAt: nowIso() });
    if (entry) data.history = [...(before.history ?? []), entry];
    tx.update(ref, data);
    const after = { ...before } as Record<string, unknown>;
    for (const [k, v] of Object.entries(data)) {
      // FieldValue.delete() remove o campo.
      if (v instanceof FieldValue) delete after[k];
      else after[k] = v;
    }
    return { before, after: after as unknown as Commission };
  });
}

/** Patch para update/transação: remove chaves undefined, limpa objetos aninhados e preserva sentinelas (FieldValue). */
export function cleanPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = v instanceof FieldValue ? v : stripUndefined(v);
  }
  return out;
}

export const deleteField = () => FieldValue.delete();
