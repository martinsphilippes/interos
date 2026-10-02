/**
 * Edição e cancelamento em SÉRIE dos títulos (etapa CP/CR 5) — regras PURAS (sem Firestore, sem React), usadas pelos
 * serviços de Contas a Pagar (`updatePayableSeries`/`cancelPayableSeries`) e dos títulos a receber avulsos
 * (`updateReceivableSeries`/`cancelReceivableSeries`), pelos painéis (N calculado no servidor ao abrir) e pelos testes
 * (`tests/finance/title-series.test.ts`).
 *
 * "Futuros iguais" de um título (`findFutureTitles`):
 *  1. sem nenhuma baixa (`payments[]` vazio) e não pagos/cancelados;
 *  2. vencimento ≥ o do título editado (o vencimento ANTES da edição);
 *  3. mesma série (`seriesId`); sem série, mesma descrição ignorando maiúsculas, acentos e o sufixo de parcela
 *     (" (3/12)" e o antigo " (parcela 3/12)") entre os títulos também sem série;
 *  fora: o próprio título e os títulos de resíduo (`residualOf`, que nascem de uma baixa — não são ocorrências).
 *
 * O que vai para os futuros (`seriesEditFrom` + `applySeriesEdit`): só o que MUDOU no título editado — descrição (com o
 * sufixo de parcela de CADA futuro refeito), valor, credor/pagador, classificação (centro/categoria/subcategoria e os
 * campos antigos derivados), conta prevista e observações. Cada futuro mantém vencimento, competência, nº da parcela,
 * nº do documento e baixas; se o DIA do vencimento mudou (ex.: 10 → 5), cada futuro passa a vencer nesse dia no PRÓPRIO
 * mês (limitado ao fim do mês) e a competência acompanha o mesmo deslocamento de meses (zero: o mês não muda).
 *
 * Contas a Pagar mantém o fluxo de aprovação (decisão 1 do dono): cada futuro recebe as mudanças só se a regra atual de
 * edição permitir (`payableSeriesSkip`: valor só em título manual ainda previsto); senão fica FORA, inteiro, com o
 * motivo. Títulos de comissão/bônus/estorno e a série recorrente (título-modelo + varredura) nunca entram.
 */
import { dateKey } from "@/lib/format";
import { isCommissionLinkedPayable } from "./settlements";
import { addMonthsToCompetence, installmentSuffix, monthsBetween, stripInstallmentSuffix } from "./title-repeat";
import type { Payable } from "./types";

/** Campos mínimos de um título para a regra dos futuros (a pagar e a receber). */
export interface SeriesMember {
  id: string;
  description: string;
  /** ISO (meio-dia UTC) ou AAAA-MM-DD. */
  dueDate: string;
  /** AAAA-MM */
  competence: string;
  status: string;
  amount: number;
  seriesId?: string;
  installment?: number;
  installments?: number;
  payments?: readonly unknown[];
  residualOf?: string;
}

/** Como os futuros foram encontrados: pela série gravada ou pela descrição (títulos sem série). */
export type SeriesMatch = "serie" | "descricao";

const SUFFIX = /\s*\((?:parcela\s+)?\d{1,3}\s*\/\s*\d{1,3}\)\s*$/i;
const CLOSED = new Set(["pago", "cancelado"]);

/** Dia AAAA-MM-DD do vencimento (fuso de São Paulo para ISO; AAAA-MM-DD fica como está). */
export function dueDay(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : dateKey(value);
}

/** Descrição para comparar títulos sem série: sem sufixo de parcela, sem acentos, minúsculas e espaços simples. */
export function normalizeTitleDescription(description: string): string {
  return stripInstallmentSuffix(description ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Título fechado para a série: pago, cancelado ou com alguma baixa registrada. */
export function hasSettlement(t: Pick<SeriesMember, "status" | "payments">): boolean {
  return CLOSED.has(t.status) || (t.payments?.length ?? 0) > 0;
}

/** Futuros encontrados pela série (`seriesId`) ou, sem série, pela descrição. */
export function seriesMatchOf(edited: Pick<SeriesMember, "seriesId">): SeriesMatch {
  return edited.seriesId ? "serie" : "descricao";
}

/**
 * Futuros iguais do título editado (regra no topo do arquivo), em ordem de vencimento. O título editado que é resíduo
 * não tem futuros (a descrição "— Resíduo" não é a da série).
 */
export function findFutureTitles<T extends SeriesMember>(edited: T, all: readonly T[]): T[] {
  if (edited.residualOf) return [];
  const from = dueDay(edited.dueDate);
  const key = edited.seriesId ? "" : normalizeTitleDescription(edited.description);
  if (!edited.seriesId && !key) return [];
  return all
    .filter((t) => t.id !== edited.id && !hasSettlement(t) && !t.residualOf && dueDay(t.dueDate) >= from)
    .filter((t) => (edited.seriesId ? t.seriesId === edited.seriesId : !t.seriesId && normalizeTitleDescription(t.description) === key))
    .sort((a, b) => dueDay(a.dueDate).localeCompare(dueDay(b.dueDate)) || (a.installment ?? 0) - (b.installment ?? 0) || a.id.localeCompare(b.id));
}

/**
 * Sufixo de parcela do próprio título: com parcela gravada {n, total}, refeito no formato que ele já usa (" (3/12)" ou o
 * antigo " (parcela 3/12)"); sem parcela gravada, o sufixo que a descrição tiver (ou nenhum).
 */
export function ownInstallmentSuffix(t: Pick<SeriesMember, "description" | "installment" | "installments">): string {
  const own = (t.description ?? "").match(SUFFIX)?.[0];
  if (t.installment && t.installments) return own && /parcela/i.test(own) ? ` (parcela ${t.installment}/${t.installments})` : installmentSuffix(t.installment, t.installments);
  return own ? ` ${own.trim()}` : "";
}

/** Nova descrição do futuro: a base da descrição editada (sem sufixo) + o sufixo de parcela DELE. */
export function seriesDescriptionFor(newDescription: string, future: Pick<SeriesMember, "description" | "installment" | "installments">): string {
  return `${stripInstallmentSuffix(newDescription)}${ownInstallmentSuffix(future)}`;
}

/** AAAA-MM-DD no dia `day` do mês de `due` (limitado ao fim do mês: 31 → 30/28/29). */
export function moveToDay(due: string, day: number): string {
  const [y, m] = dueDay(due).split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(Math.max(1, day), last)).padStart(2, "0")}`;
}

/** Mudanças do título editado que vão para os futuros (só o que mudou). */
export interface SeriesEdit {
  /** Nova descrição (o sufixo de parcela de cada futuro é refeito). */
  description?: string;
  amount?: number;
  /** Novo DIA do vencimento (1–31), quando o dia mudou. */
  day?: number;
  /** Demais campos copiados como estão (null = limpar o campo no futuro). */
  fields: Record<string, unknown>;
}

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
const cents = (v: number) => Math.round(Number(v) * 100);

/**
 * O que mudou entre o título antes e depois da edição: descrição (comparando sem o sufixo de parcela — mexer só no
 * sufixo não vai para os futuros), valor (em centavos), dia do vencimento e os `fields` pedidos (credor, classificação,
 * conta prevista, observações…). Vencimento (mês), competência, nº do documento e parcela NUNCA vão.
 */
export function seriesEditFrom<T extends Pick<SeriesMember, "description" | "amount" | "dueDate">>(before: T, after: T, fields: readonly string[]): SeriesEdit {
  const edit: SeriesEdit = { fields: {} };
  if (stripInstallmentSuffix(after.description) !== stripInstallmentSuffix(before.description)) edit.description = after.description;
  if (cents(after.amount) !== cents(before.amount)) edit.amount = after.amount;
  const d0 = Number(dueDay(before.dueDate).slice(8, 10));
  const d1 = Number(dueDay(after.dueDate).slice(8, 10));
  if (d0 !== d1) edit.day = d1;
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  for (const k of fields) if (!same(b[k], a[k])) edit.fields[k] = a[k] ?? null;
  return edit;
}

/** A edição tem algo para os futuros? */
export function hasSeriesChanges(edit: SeriesEdit): boolean {
  return edit.description !== undefined || edit.amount !== undefined || edit.day !== undefined || Object.keys(edit.fields).length > 0;
}

/** Patch de um futuro: só as diferenças reais (`dueDate` em AAAA-MM-DD; null = limpar o campo). */
export type SeriesPatch = Record<string, unknown>;

/**
 * Aplica a edição a UM futuro: descrição com o sufixo dele refeito, valor, dia do vencimento no próprio mês (limitado ao
 * fim do mês, competência com o mesmo deslocamento de meses) e os demais campos. Devolve só o que muda nele (vazio =
 * já estava igual). Mantém vencimento (mês), competência, parcela, nº do documento e baixas.
 */
export function applySeriesEdit<T extends SeriesMember>(future: T, edit: SeriesEdit): SeriesPatch {
  const patch: SeriesPatch = {};
  if (edit.description !== undefined) {
    const description = seriesDescriptionFor(edit.description, future);
    if (description !== future.description) patch.description = description;
  }
  if (edit.amount !== undefined && cents(edit.amount) !== cents(future.amount)) patch.amount = cents(edit.amount) / 100;
  if (edit.day !== undefined) {
    const from = dueDay(future.dueDate);
    const to = moveToDay(from, edit.day);
    if (to !== from) {
      patch.dueDate = to;
      const competence = addMonthsToCompetence(future.competence, monthsBetween(from, to));
      if (competence !== future.competence) patch.competence = competence;
    }
  }
  const f = future as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(edit.fields)) if (!same(f[k], v)) patch[k] = v ?? null;
  return patch;
}

// ---------------------------------------------------------------------------
// Contas a Pagar: fluxo de aprovação (decisão 1) e o que nunca entra na série
// ---------------------------------------------------------------------------

/** Campos do título a pagar que vão para os futuros (além de descrição, valor e dia do vencimento). */
export const PAYABLE_SERIES_FIELDS = ["creditorType", "creditorId", "creditorName", "supplierId", "categoryId", "costCenterId", "category", "costCenter", "accountId", "notes"] as const;
/** Campos do título a receber avulso que vão para os futuros. */
export const RECEIVABLE_SERIES_FIELDS = ["clientId", "payerName", "categoryId", "costCenterId", "accountId", "notes"] as const;

export const SERIES_SKIP_AMOUNT = "o valor só muda em título manual ainda previsto (este já foi aprovado ou programado)";
export const SERIES_SKIP_COMMISSION = "título de comissão/bônus/estorno segue o motor de comissões";
export const SERIES_SKIP_SETTLED = "recebeu baixa ou mudou de situação enquanto a alteração era gravada";

type PayableLike = Pick<Payable, "id" | "origin" | "status" | "sourceIds" | "seriesId" | "recurrence">;

/** Membro da série RECORRENTE (título-modelo com `recurrence` + ocorrências da varredura): fica fora da edição em série. */
export function isRecurringSeriesMember(p: PayableLike, all: readonly PayableLike[]): boolean {
  if (p.recurrence || p.origin === "recorrencia") return true;
  return Boolean(p.seriesId && all.some((x) => x.id === p.seriesId && x.recurrence));
}

/**
 * Por que o título a pagar não oferece "este + futuros": comissão/bônus/estorno (segue o motor) ou série recorrente
 * (mantém o comportamento atual: "Repetir até" no título-modelo ou cancelar o modelo encerra a série). Null = oferece.
 */
export function payableSeriesUnavailable(p: PayableLike, all: readonly PayableLike[]): string | null {
  if (isCommissionLinkedPayable(p)) return SERIES_SKIP_COMMISSION;
  if (isRecurringSeriesMember(p, all)) return "série recorrente: as próximas ocorrências seguem o título-modelo (altere o modelo; \"Repetir até\" ou cancelar o modelo encerra a série)";
  return null;
}

/** Futuros de um título a pagar: a regra geral sem comissão/bônus/estorno e sem a série recorrente. */
export function findPayableFutures<T extends SeriesMember & PayableLike>(edited: T, all: readonly T[]): T[] {
  if (payableSeriesUnavailable(edited, all)) return [];
  return findFutureTitles(edited, all).filter((t) => !isCommissionLinkedPayable(t) && !isRecurringSeriesMember(t, all));
}

/**
 * A regra ATUAL de edição permite este patch no futuro? (mesmas regras de `updatePayable`): valor só em título manual
 * ainda previsto; comissão/bônus/estorno nunca. Devolve o motivo para ficar FORA, ou null.
 */
export function payableSeriesSkip(future: Pick<Payable, "origin" | "status" | "sourceIds" | "payments">, patch: SeriesPatch): string | null {
  if (isCommissionLinkedPayable(future)) return SERIES_SKIP_COMMISSION;
  if (hasSettlement(future)) return SERIES_SKIP_SETTLED;
  if ("amount" in patch && !(future.origin === "manual" && future.status === "previsto")) return SERIES_SKIP_AMOUNT;
  return null;
}

/** Quantos futuros ficariam fora se o valor mudar (aviso no diálogo ao abrir). */
export function payableAmountLockedCount(futures: readonly Pick<Payable, "origin" | "status">[]): number {
  return futures.filter((f) => !(f.origin === "manual" && f.status === "previsto")).length;
}

/** Resumo dos pulados por motivo: "2 — o valor só muda…". */
export function summarizeSkipped(skipped: readonly { reason: string }[]): { reason: string; count: number }[] {
  const out = new Map<string, number>();
  for (const s of skipped) out.set(s.reason, (out.get(s.reason) ?? 0) + 1);
  return Array.from(out.entries()).map(([reason, count]) => ({ reason, count }));
}

/** Lotes atômicos (uma transação Firestore por lote): o limite é 500 escritas; usamos 400 para folga. */
export const SERIES_BATCH_SIZE = 400;

export function chunk<T>(items: readonly T[], size = SERIES_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
