/**
 * Reajuste anual dos contratos — regras PURAS (sem banco e sem React): índices padrão e suas fontes, competências
 * (AAAA-MM), acumulado de 12 meses, datas-base (aniversário da vigência) e o cálculo do reajuste de uma data-base.
 * Usado pelo cadastro de índices (src/server/finance-registry/indices.ts), pelo reajuste automático
 * (src/server/finance/readjustments.ts), pelos aditivos e pelas telas.
 *
 * Regras:
 * - O reajuste é ANUAL, na data-base = aniversário do início da vigência (início + 12, 24, 36… meses).
 * - Índice: acumulado (composto) dos 12 meses que terminam no mês anterior ao da data-base, ou no último mês já
 *   publicado se ele ainda não saiu. Mais de 3 meses de atraso = índice desatualizado (espera).
 * - Acumulado negativo: o índice diz se mantém o valor (padrão) ou reduz.
 */
import type { Contract, ContractAmendment, ContractReadjustment, ReadjustmentGap, ReadjustmentIndex, ReadjustmentIndexMonth, ReadjustmentIndexSource, ReadjustmentQuote } from "./types";

/** Dias depois da data-base em que o reajuste ainda é aplicado sozinho; depois disso vira tarefa ao Financeiro. */
export const READJUSTMENT_GRACE_DAYS = 45;
/** Dias antes da data-base em que o Financeiro e o CS recebem a prévia do reajuste. */
export const READJUSTMENT_NOTICE_DAYS = 30;
/** Meses de atraso aceitos entre o último mês do índice e a data-base. */
export const MAX_INDEX_LAG_MONTHS = 3;
/** Acima disso (em módulo, acumulado bruto) o reajuste não entra sozinho: série errada ou índice fora do normal → Financeiro decide. */
export const MAX_AUTO_PERCENT = 25;
/**
 * Início do acompanhamento das datas-base pelo INTEROS (entrada do reajuste anual automático). Datas-base anteriores
 * a isso (ou à criação do contrato no sistema) foram tratadas fora dele: só a mais recente aparece; dali em diante
 * cada data-base é decidida na ordem — a seguinte espera a anterior.
 */
export const READJUSTMENT_TRACKING_SINCE = "2026-10-23";

export interface DefaultIndexDef {
  id: string;
  name: string;
  description: string;
  source: ReadjustmentIndexSource;
}

/** Índices que o INTEROS já traz (ids estáveis: os contratos antigos guardam "ipca", "igpm" e "inpc"). */
export const DEFAULT_READJUSTMENT_INDICES: readonly DefaultIndexDef[] = [
  { id: "ipca", name: "IPCA", description: "Índice Nacional de Preços ao Consumidor Amplo (IBGE)", source: { kind: "bcb_sgs", seriesCode: 433 } },
  { id: "igpm", name: "IGP-M", description: "Índice Geral de Preços do Mercado (FGV)", source: { kind: "bcb_sgs", seriesCode: 189 } },
  { id: "inpc", name: "INPC", description: "Índice Nacional de Preços ao Consumidor (IBGE)", source: { kind: "bcb_sgs", seriesCode: 188 } },
  { id: "igpdi", name: "IGP-DI", description: "Índice Geral de Preços – Disponibilidade Interna (FGV)", source: { kind: "bcb_sgs", seriesCode: 190 } },
  { id: "icti", name: "ICTI", description: "Índice de Custo da Tecnologia da Informação (IPEA)", source: { kind: "ipea_icti" } },
];

/** Nome dos índices padrão (quando a tela não tem o cadastro à mão). */
export const DEFAULT_INDEX_NAMES: Readonly<Record<string, string>> = Object.fromEntries(DEFAULT_READJUSTMENT_INDICES.map((d) => [d.id, d.name]));

export const INDEX_SOURCE_KIND_LABELS: Record<ReadjustmentIndexSource["kind"], string> = {
  bcb_sgs: "Banco Central (série SGS)",
  ipea_icti: "IPEA (planilha do ICTI)",
  manual: "Manual (o Financeiro lança os meses)",
};

/** Texto curto da fonte: "Banco Central · série 433", "IPEA · planilha do ICTI", "Manual". */
export function describeIndexSource(source: ReadjustmentIndexSource): string {
  if (source.kind === "bcb_sgs") return `Banco Central · série ${source.seriesCode}`;
  if (source.kind === "ipea_icti") return "IPEA · planilha do ICTI";
  return "Manual";
}

/** Meses de defasagem normal da fonte (o mês M sai no mês M + defasagem). */
export function sourceLagMonths(source: ReadjustmentIndexSource): number {
  return source.kind === "ipea_icti" ? 2 : 1;
}

/** Nome do índice para exibição (cadastro → padrões → o próprio id em maiúsculas). */
export function indexDisplayName(id: string | undefined, names?: Readonly<Record<string, string>>): string {
  if (!id) return "Índice";
  return names?.[id] ?? DEFAULT_INDEX_NAMES[id] ?? id.toUpperCase();
}

/** Opção de índice para as listas de escolha (venda, condições, renovação). */
export interface ReadjustmentIndexOption {
  id: string;
  name: string;
  /** Desativado: só aparece para o contrato que já usa. */
  archived?: boolean;
  /** "set/2026 · 12 meses: 4,85%". */
  hint?: string;
}

/**
 * Opções do campo «Índice»: os ativos do cadastro (com o último mês e o acumulado) e, se o registro já usa um índice
 * desativado ou fora da lista, ele também (marcado), para não sumir da tela.
 */
export function indexSelectOptions(indices: readonly ReadjustmentIndexOption[], current?: string): { value: string; label: string }[] {
  const out = indices.filter((i) => !i.archived || i.id === current).map((i) => ({ value: i.id, label: `${i.name}${i.archived ? " (desativado)" : ""}${i.hint ? ` · ${i.hint}` : ""}` }));
  if (current && !out.some((o) => o.value === current)) out.push({ value: current, label: `${indexDisplayName(current)} (fora do cadastro)` });
  return out;
}

// ---------------------------------------------------------------------------
// Competências (AAAA-MM)
// ---------------------------------------------------------------------------

const COMPETENCE_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function isCompetence(value: string): boolean {
  return COMPETENCE_RE.test(value);
}

/** Competência + n meses (n pode ser negativo). */
export function addCompetence(competence: string, months: number): string {
  const year = Number(competence.slice(0, 4));
  const month = Number(competence.slice(5, 7)) - 1 + months;
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  return `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}`;
}

/** "10/2026", "10-2026", "out/2026" ou "2026-10" → "2026-10" (o campo é texto: funciona em todo navegador). */
export function parseCompetenceInput(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  let m = /^(\d{4})-(\d{1,2})$/.exec(v);
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2].padStart(2, "0")}` : null;
  m = /^(\d{1,2})[/.\s-](\d{4})$/.exec(v);
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? `${m[2]}-${m[1].padStart(2, "0")}` : null;
  m = /^([a-zç]{3})[a-zç]*[/.\s-]+(\d{4})$/.exec(v);
  if (m) {
    const i = MONTH_ABBR.indexOf(m[1]);
    return i >= 0 ? `${m[2]}-${String(i + 1).padStart(2, "0")}` : null;
  }
  return null;
}

/** Meses de `b` até `a` (a − b). */
export function competenceDiff(a: string, b: string): number {
  return (Number(a.slice(0, 4)) - Number(b.slice(0, 4))) * 12 + (Number(a.slice(5, 7)) - Number(b.slice(5, 7)));
}

/** "set/2026". */
export function competenceLabel(competence: string): string {
  return `${MONTH_ABBR[Number(competence.slice(5, 7)) - 1] ?? "?"}/${competence.slice(0, 4)}`;
}

/** "4,85%" (até 2 casas; negativo com sinal). */
export function formatPct(value: number): string {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Último mês com valor. */
export function latestCompetence(values: Readonly<Record<string, ReadjustmentIndexMonth>>): string | null {
  let latest: string | null = null;
  for (const [k, v] of Object.entries(values)) if (isCompetence(k) && Number.isFinite(v?.pct) && (!latest || k > latest)) latest = k;
  return latest;
}

/** Acumulado composto (%) dos `months` meses que terminam em `to`; null se faltar algum mês. Sem arredondar. */
export function accumulatedPct(values: Readonly<Record<string, ReadjustmentIndexMonth>>, to: string, months = 12): number | null {
  let factor = 1;
  for (let i = 0; i < months; i++) {
    const v = values[addCompetence(to, -i)];
    if (!v || !Number.isFinite(v.pct)) return null;
    factor *= 1 + v.pct / 100;
  }
  return (factor - 1) * 100;
}

export interface IndexSummary {
  latest: { competence: string; pct: number } | null;
  /** Acumulado de 12 meses até o último mês (2 casas). */
  accumulated12m: { pct: number; from: string; to: string } | null;
}

export function summarizeIndex(values: Readonly<Record<string, ReadjustmentIndexMonth>>): IndexSummary {
  const latest = latestCompetence(values);
  if (!latest) return { latest: null, accumulated12m: null };
  const acc = accumulatedPct(values, latest);
  return { latest: { competence: latest, pct: values[latest].pct }, accumulated12m: acc === null ? null : { pct: round2(acc), from: addCompetence(latest, -11), to: latest } };
}

/** Linha de apoio da lista de escolha: "set/2026 · 12 meses: 4,85%". */
export function indexHint(values: Readonly<Record<string, ReadjustmentIndexMonth>>): string | undefined {
  const s = summarizeIndex(values);
  if (!s.latest) return undefined;
  return `${competenceLabel(s.latest.competence)}${s.accumulated12m ? ` · 12 meses: ${formatPct(s.accumulated12m.pct)}` : ""}`;
}

// ---------------------------------------------------------------------------
// Datas-base (AAAA-MM-DD)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Data + n meses, com o dia limitado ao fim do mês (31/01 + 1 → 28/02 ou 29/02). */
export function addMonthsClamped(dateKey: string, months: number): string {
  const comp = addCompetence(dateKey.slice(0, 7), months);
  const y = Number(comp.slice(0, 4));
  const m = Number(comp.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(Number(dateKey.slice(8, 10)), last);
  return `${comp}-${String(day).padStart(2, "0")}`;
}

/** Data AAAA-MM-DD + n dias. */
export function addDaysKey(key: string, days: number): string {
  return new Date(Date.parse(`${key.slice(0, 10)}T12:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Dias de `a` até `b` (b − a), datas AAAA-MM-DD. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00.000Z`) - Date.parse(`${a}T12:00:00.000Z`)) / DAY_MS);
}

/** k-ésima data-base (k ≥ 1) a partir do início da vigência. */
export function anniversaryOf(startKey: string, k: number): string {
  return addMonthsClamped(startKey, 12 * k);
}

export interface ReadjustmentSchedule {
  /** Data-base já chegada e ainda não decidida (a que está em foco: ver `readjustmentSchedule`). */
  due: { anniversary: string; overdueDays: number } | null;
  /** Próxima data-base (futura) ainda não decidida. */
  next: { anniversary: string; daysUntil: number } | null;
}

/** A data-base cai num período em que o contrato estava sem regra de reajuste? */
export function inReadjustmentGap(anniversary: string, gaps: readonly ReadjustmentGap[] | undefined): boolean {
  return (gaps ?? []).some((g) => (!g.from || anniversary >= g.from) && (!g.to || anniversary < g.to));
}

/**
 * Períodos sem regra depois de um aditivo: regra incluída num contrato que nunca teve → período desde o início até a
 * vigência; removida (ou cobrança que virou única) → período aberto a partir da vigência; reincluída → fecha o aberto.
 * `reincluded` = havia um período aberto (o contrato já teve regra): a data-base pendente da regra antiga, se houver,
 * fica para o Financeiro (regra trocada).
 */
export function nextReadjustmentGaps(gaps: readonly ReadjustmentGap[] | undefined, change: { hadRule: boolean; hasRule: boolean; effectiveFrom: string }): { gaps: ReadjustmentGap[]; reincluded: boolean } | null {
  const list = [...(gaps ?? [])];
  if (change.hadRule === change.hasRule) return null;
  if (change.hadRule) return { gaps: [...list, { from: change.effectiveFrom }], reincluded: false };
  const open = list.findIndex((g) => !g.to);
  if (open >= 0) {
    list[open] = { ...list[open], to: change.effectiveFrom };
    return { gaps: list, reincluded: true };
  }
  return { gaps: [...list, { to: change.effectiveFrom }], reincluded: false };
}

/** Desde quando o sistema responde pelas datas-base do contrato (o mais tardio entre o acompanhamento e a criação). */
export function readjustmentFloor(contract: Pick<Contract, "createdAt">): string {
  const created = typeof contract.createdAt === "string" ? contract.createdAt.slice(0, 10) : "";
  return created > READJUSTMENT_TRACKING_SINCE ? created : READJUSTMENT_TRACKING_SINCE;
}

/**
 * Datas-base pendentes. `covered` = datas-base já decididas (aplicadas, mantidas, dispensadas ou em aditivo aberto);
 * compara por mês. Tudo até a última decidida fica para trás. Das que chegaram sem decisão: a partir de `floor`
 * (desde quando o sistema acompanha o contrato) vale a MAIS ANTIGA — a seguinte espera, para nenhuma data-base sumir
 * sem registro; antes dele, só a mais recente (as anteriores foram tratadas fora do sistema). Datas-base dentro de
 * `gaps` (períodos sem regra de reajuste) não contam: o contrato não tinha reajuste nelas.
 */
export function readjustmentSchedule(input: { startDate: string; covered: readonly string[]; today: string; floor?: string; gaps?: readonly ReadjustmentGap[] }): ReadjustmentSchedule {
  const start = input.startDate.slice(0, 10);
  const coveredMonths = new Set(input.covered.map((c) => c.slice(0, 7)));
  const lastCovered = [...coveredMonths].sort().pop() ?? null;
  let due: ReadjustmentSchedule["due"] = null;
  let pinned = false;
  for (let k = 1; k <= 200; k++) {
    const a = anniversaryOf(start, k);
    const month = a.slice(0, 7);
    const fresh = !coveredMonths.has(month) && (!lastCovered || month > lastCovered);
    const open = fresh && !inReadjustmentGap(a, input.gaps);
    if (a <= input.today) {
      if (!pinned) {
        if (open) {
          due = { anniversary: a, overdueDays: daysBetween(a, input.today) };
          if (input.floor && a >= input.floor) pinned = true;
        } else if (fresh) due = null; // sem regra nesta: a anterior (antes do acompanhamento) também fica para trás
      }
      continue;
    }
    if (open) return { due, next: { anniversary: a, daysUntil: daysBetween(input.today, a) } };
  }
  return { due, next: null };
}

/**
 * Datas-base já decididas: registro do contrato (aplicado/mantido/dispensado), aditivos não cancelados que cobrem uma
 * data-base (inclusive em andamento — evita aplicar duas vezes) e renovações ANTIGAS aplicadas (sem `annualModel`):
 * antes do reajuste anual, o reajuste era decidido na renovação — percentual aplicado, «sem reajuste» ou índice que o
 * CS informava à mão por aditivo. Contar a renovação antiga como decidida evita reajustar de novo por cima disso.
 */
export function coveredAnniversaries(contract: Pick<Contract, "readjustmentLog">, amendments: readonly Pick<ContractAmendment, "status" | "kind" | "readjust" | "annualModel" | "effectiveFrom">[]): string[] {
  const out = (contract.readjustmentLog ?? []).map((e) => e.anniversary);
  for (const a of amendments) {
    if (a.status === "cancelado") continue;
    if (a.readjust) out.push(a.readjust.anniversary);
    else if (a.kind === "renovacao" && a.status === "aplicado" && !a.annualModel) out.push(a.effectiveFrom.slice(0, 10));
  }
  return out;
}

/** Mesma regra de reajuste? (tipo, percentual e índice; o «aguardando» não conta). */
export function sameReadjustmentRule(a: ContractReadjustment | undefined, b: ContractReadjustment | undefined): boolean {
  const norm = (r: ContractReadjustment | undefined) => (!r || r.type === "nenhum" ? "nenhum" : r.type === "percentual" ? `percentual:${Number(r.percent ?? 0)}` : `indice:${r.index ?? ""}`);
  return norm(a) === norm(b);
}

/** O contrato tem regra de reajuste que o motor sabe aplicar (percentual > 0 ou índice escolhido) e cobra recorrente. */
export function hasReadjustmentRule(contract: Pick<Contract, "readjustment" | "recurrence">): boolean {
  const r = contract.readjustment;
  if (!r || contract.recurrence === "unico") return false;
  return (r.type === "percentual" && (r.percent ?? 0) > 0) || (r.type === "indice" && Boolean(r.index));
}

// ---------------------------------------------------------------------------
// Cálculo do reajuste de uma data-base
// ---------------------------------------------------------------------------

export type QuoteResult = { ok: true; quote: ReadjustmentQuote } | { ok: false; reason: string; /** Espera o índice (some sozinho quando ele sair). */ waiting?: boolean };

type IndexForQuote = Pick<ReadjustmentIndex, "id" | "name" | "values" | "negativePolicy">;

/**
 * Reajuste da data-base `anniversary` (AAAA-MM-DD) pela regra do contrato. Índice: acumulado de 12 meses até o mês
 * anterior à data-base (ou o último publicado), no máximo 3 meses de atraso; negativo segue a regra do índice.
 */
export function quoteReadjustment(rule: ContractReadjustment | undefined, index: IndexForQuote | undefined, anniversary: string): QuoteResult {
  if (!rule || rule.type === "nenhum") return { ok: false, reason: "O contrato não tem reajuste" };
  if (rule.type === "percentual") {
    const p = Number(rule.percent);
    if (!Number.isFinite(p) || p <= 0) return { ok: false, reason: "Percentual de reajuste não informado no contrato" };
    return { ok: true, quote: { type: "percentual", percent: round2(p), rawPercent: round2(p) } };
  }
  if (!rule.index) return { ok: false, reason: "Índice de reajuste não informado no contrato" };
  const name = index?.name ?? indexDisplayName(rule.index);
  if (!index) return { ok: false, reason: `O índice ${name} não está no cadastro de índices` };
  const month = anniversary.slice(0, 7);
  const target = addCompetence(month, -1);
  const months = Object.keys(index.values)
    .filter((k) => isCompetence(k) && k <= target && Number.isFinite(index.values[k]?.pct))
    .sort();
  const to = months.pop();
  if (!to) return { ok: false, waiting: true, reason: `O ${name} ainda não tem meses publicados até ${competenceLabel(target)}` };
  if (competenceDiff(month, to) > MAX_INDEX_LAG_MONTHS) return { ok: false, waiting: true, reason: `O ${name} está desatualizado: último mês ${competenceLabel(to)} (a data-base pede até ${competenceLabel(target)})` };
  const acc = accumulatedPct(index.values, to);
  if (acc === null) return { ok: false, waiting: true, reason: `Faltam meses do ${name} para o acumulado de ${competenceLabel(addCompetence(to, -11))} a ${competenceLabel(to)}` };
  const raw = round2(acc);
  const held = raw < 0 && index.negativePolicy !== "reduzir";
  return { ok: true, quote: { type: "indice", percent: held ? 0 : raw, rawPercent: raw, indexId: index.id, indexName: index.name, from: addCompetence(to, -11), to, ...(held ? { held: true } : {}) } };
}

/** "IPCA acumulado de out/2025 a set/2026: 4,85%" / "5,00% (percentual fixo)". */
export function describeQuote(q: Pick<ReadjustmentQuote, "type" | "percent" | "rawPercent" | "indexName" | "from" | "to" | "held" | "manual">): string {
  if (q.manual) return `${formatPct(q.percent)} (informado pelo Financeiro)`;
  if (q.type === "percentual") return `${formatPct(q.percent)} (percentual fixo)`;
  const period = q.from && q.to ? ` de ${competenceLabel(q.from)} a ${competenceLabel(q.to)}` : "";
  return `${q.indexName ?? "Índice"} acumulado${period}: ${formatPct(q.rawPercent)}${q.held ? " (negativo: valor mantido)" : ""}`;
}
