/**
 * Auditoria de alterações (D16). Não existe coleção de auditoria: o registro é o próprio evento (`events`,
 * com actorId e occurredAt). Este helper padroniza o `payload.changes` ("campo: { from, to }") e o motivo,
 * para que toda alteração relevante (condições/itens do contrato, configurações, regras, títulos…) guarde o
 * valor anterior e o novo da mesma forma.
 *
 * Puro (sem Firestore): pode ser usado em serviços, actions e scripts.
 */

export interface FieldChange {
  from: unknown;
  to: unknown;
}

export interface AuditPayload {
  /** Só os campos que de fato mudaram. */
  changes: Record<string, FieldChange>;
  /** Motivo informado pelo usuário (quando a operação exige). */
  reason?: string;
}

/** Normaliza para comparação estável: undefined/null/"" são "sem valor"; objetos com chaves ordenadas. */
function canonical(value: unknown): string {
  if (value === undefined || value === null || value === "") return "∅";
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .sort()
          .map((k) => [k, (v as Record<string, unknown>)[k]]),
      );
    }
    return v;
  });
}

/** Valor serializável para o payload (undefined vira null: o Firestore não grava undefined). */
function plain(value: unknown): unknown {
  if (value === undefined || value === "") return null;
  return value;
}

/**
 * Compara `before` e `after` nos `fields` informados e devolve `{ changes, reason }` apenas com o que mudou.
 * `before` ausente (criação) registra todos os campos com `from: null`.
 *
 * Ex.: `auditChanges(contract, { ...contract, billingDay: 15 }, ["billingDay", "termMonths"])`
 *   → `{ changes: { billingDay: { from: 10, to: 15 } } }`
 */
export function auditChanges<T extends object>(before: Partial<T> | null | undefined, after: Partial<T>, fields: readonly (keyof T & string)[], reason?: string): AuditPayload {
  const changes: Record<string, FieldChange> = {};
  for (const field of fields) {
    const from = before ? (before as Record<string, unknown>)[field] : undefined;
    const to = (after as Record<string, unknown>)[field];
    if (canonical(from) === canonical(to)) continue;
    changes[field] = { from: plain(from), to: plain(to) };
  }
  const trimmed = reason?.trim();
  return trimmed ? { changes, reason: trimmed } : { changes };
}

/** true quando a auditoria registrou alguma mudança. */
export function hasChanges(audit: AuditPayload): boolean {
  return Object.keys(audit.changes).length > 0;
}

/** Resumo legível das mudanças ("billingDay: 10 → 15 · termMonths: 12 → 24"), com rótulos opcionais. */
export function describeChanges(audit: AuditPayload, labels: Record<string, string> = {}, format: (field: string, value: unknown) => string = defaultFormat): string {
  return Object.entries(audit.changes)
    .map(([field, c]) => `${labels[field] ?? field}: ${format(field, c.from)} → ${format(field, c.to)}`)
    .join(" · ");
}

function defaultFormat(_field: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "sim" : "não";
  if (typeof value === "object") return Array.isArray(value) ? `${value.length} item(ns)` : "alterado";
  return String(value);
}
