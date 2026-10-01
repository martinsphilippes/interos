import "server-only";
/**
 * Lançamentos de caixa (etapa CP/CR 2) — gravação SEMPRE dentro da transação da baixa (título a pagar ou cobrança):
 * a baixa e o lançamento nascem e morrem juntos (desfazer pagamento / estorno apagam o lançamento na mesma transação).
 * Não há edição nem exclusão direta (regra `if false` no Firestore e nenhuma action para isso). Regras puras em
 * `src/domain/cash-entries.ts`.
 */
import type { Transaction } from "firebase-admin/firestore";
import { col, getById, list, nowIso, ORG_ID, stripUndefined, txGetOwn } from "@/server/db";
import { emitEvent } from "@/server/events";
import { BusinessError } from "@/server/auth/error-classes";
import { CASH_ENTRY_TYPE_LABELS, type CashEntryDraft } from "@/domain/cash-entries";
import { formatCurrency, formatDateKey } from "@/lib/format";
import { COLLECTIONS, type CashEntry, type FinancialAccount, type UserRef } from "@/domain/types";

/** Mensagem quando não há nenhuma conta ativa (a baixa manual exige uma). */
export const NO_ACCOUNT_MESSAGE = "Nenhuma conta financeira cadastrada: cadastre a conta em Financeiro › Cadastros financeiros (/financeiro/cadastros) antes de registrar a baixa.";
export const ACCOUNT_REQUIRED_MESSAGE = "Escolha a conta financeira da baixa (onde o dinheiro entrou ou saiu).";

export async function listCashEntries(accountId?: string): Promise<CashEntry[]> {
  return list<CashEntry>(COLLECTIONS.cashEntries, accountId ? { where: [["accountId", "==", accountId]] } : {});
}

/** Contas ativas para escolher na baixa (nome e tipo; sem saldo — não exige "Visualizar valores"). */
export async function listPaymentAccountOptions(): Promise<{ value: string; label: string }[]> {
  const accounts = await list<FinancialAccount>(COLLECTIONS.financialAccounts);
  return accounts
    .filter((a) => !a.archived)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map((a) => ({ value: a.id, label: a.name }));
}

/**
 * Baixa MANUAL (actions): a conta é obrigatória. Sem conta escolhida → mensagem clara; sem nenhuma conta ativa →
 * orienta a cadastrar em /financeiro/cadastros.
 */
export async function requireManualPaymentAccount(accountId: string | undefined): Promise<string> {
  const id = accountId?.trim();
  if (id) return id;
  const options = await listPaymentAccountOptions();
  throw new BusinessError(options.length === 0 ? NO_ACCOUNT_MESSAGE : ACCOUNT_REQUIRED_MESSAGE);
}

/**
 * Lê a conta DENTRO da transação (antes de qualquer escrita): precisa existir na organização e estar ativa. Com
 * `optional`, conta ausente/arquivada devolve null em vez de recusar (baixa automática com conta padrão inválida segue
 * sem lançamento).
 */
export async function txReadPaymentAccount(tx: Transaction, accountId: string, options: { optional?: boolean } = {}): Promise<FinancialAccount | null> {
  const snap = await txGetOwn(tx, col(COLLECTIONS.financialAccounts).doc(accountId));
  const account = snap ? ({ ...(snap.data() as Omit<FinancialAccount, "id">), id: snap.id } as FinancialAccount) : null;
  if (!account) {
    if (options.optional) return null;
    throw new BusinessError("Conta financeira não encontrada: escolha uma conta ativa em Cadastros financeiros");
  }
  if (account.archived) {
    if (options.optional) return null;
    throw new BusinessError(`A conta "${account.name}" está arquivada: escolha uma conta ativa`);
  }
  return account;
}

/** Lê o lançamento dentro da transação (para apagá-lo junto com a baixa). Fora da organização = inexistente. */
export async function txReadCashEntry(tx: Transaction, id: string): Promise<CashEntry | null> {
  const snap = await txGetOwn(tx, col(COLLECTIONS.cashEntries).doc(id));
  return snap ? ({ ...(snap.data() as Omit<CashEntry, "id">), id: snap.id } as CashEntry) : null;
}

/** Id novo de lançamento (gerado antes da transação para a baixa guardar o `transactionId`). */
export function newCashEntryId(): string {
  return col(COLLECTIONS.cashEntries).doc().id;
}

/** Grava o lançamento na transação (só escrita: as leituras já foram feitas). */
export function txCreateCashEntry(tx: Transaction, id: string, draft: CashEntryDraft, at: string = nowIso()): CashEntry {
  const entry = { ...draft, organizationId: ORG_ID, createdAt: at, updatedAt: at } as Omit<CashEntry, "id">;
  tx.set(col(COLLECTIONS.cashEntries).doc(id), stripUndefined(entry));
  return { ...entry, id } as CashEntry;
}

export function txDeleteCashEntry(tx: Transaction, id: string): void {
  tx.delete(col(COLLECTIONS.cashEntries).doc(id));
}

/**
 * Auditoria do lançamento (fora da timeline do cliente): `cash_entry.created` (— → valor, conta, tipo) e
 * `cash_entry.deleted` (valor → —, com o motivo de quem desfez/estornou).
 */
export async function emitCashEntryEvent(type: "cash_entry.created" | "cash_entry.deleted", actor: UserRef, entry: CashEntry, extra: { accountName?: string; reason?: string; clientId?: string } = {}): Promise<void> {
  const accountName = extra.accountName ?? (await getById<FinancialAccount>(COLLECTIONS.financialAccounts, entry.accountId))?.name ?? entry.accountId;
  const created = type === "cash_entry.created";
  const view = { amount: entry.amount, accountName, entryType: CASH_ENTRY_TYPE_LABELS[entry.type] };
  const changes = Object.fromEntries(Object.entries(view).map(([k, v]) => [k, created ? { from: null, to: v } : { from: v, to: null }]));
  const sign = entry.type === "despesa" ? "−" : "+";
  await emitEvent({
    type,
    actor,
    clientId: extra.clientId,
    entity: { type: "cash_entry", id: entry.id },
    title: `${created ? "Lançamento registrado" : "Lançamento apagado"}: ${CASH_ENTRY_TYPE_LABELS[entry.type].toLowerCase()} ${sign}${formatCurrency(entry.amount)} em ${accountName}`,
    description: [entry.description, formatDateKey(entry.date), entry.notes, extra.reason].filter(Boolean).join(" · "),
    department: "financeiro",
    payload: stripUndefined({ cashEntryId: entry.id, accountId: entry.accountId, amount: entry.amount, type: entry.type, origin: entry.origin, changes, reason: extra.reason }),
    timeline: false,
  });
}
