/**
 * Períodos de apuração dos indicadores (KPIs) e metas.
 *
 * Todas as fronteiras seguem o fuso da operação (America/Sao_Paulo, UTC-3 fixo desde o fim do horário
 * de verão em 2019). `start` é inclusivo e `end` é EXCLUSIVO, ambos em ISO UTC; compare datas com
 * `inPeriod(iso, period)` para não errar a borda.
 *
 * Chaves aceitas (?periodo=): "2026-09" (mês), "2026-T3" (trimestre), "2026" (ano), "30d", "90d" e
 * "2026-09-01_2026-09-15" (personalizado; também via ?de=2026-09-01&ate=2026-09-15, com `ate` inclusivo).
 *
 * Módulo puro (sem Firestore): pode ser importado por Client Components.
 */
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export type PeriodKind = "mes" | "trimestre" | "ano" | "30d" | "90d" | "custom";

export interface Period {
  key: string;
  /** Início inclusivo (ISO UTC, meia-noite de São Paulo). */
  start: string;
  /** Fim exclusivo (ISO UTC, meia-noite de São Paulo do dia seguinte ao último dia). */
  end: string;
  label: string;
  kind: PeriodKind;
}

const TZ_OFFSET_HOURS = 3;
const DAY_MS = 86_400_000;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTER_RE = /^(\d{4})-T([1-4])$/;
const YEAR_RE = /^(\d{4})$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const CUSTOM_RE = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/;

/** ISO UTC da meia-noite de São Paulo no dia informado (mês 1–12; aceita overflow de dia/mês). */
function localMidnight(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day, TZ_OFFSET_HOURS)).toISOString();
}

/** Chave AAAA-MM-DD de um instante no fuso da operação. */
export function localDayKey(value: Date | string = new Date()): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Date(d.getTime() - TZ_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}

/** Competência AAAA-MM atual (fuso da operação). */
export function currentMonthKey(now: Date = new Date()): string {
  return localDayKey(now).slice(0, 7);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return format(new Date(y, m - 1, d), "dd/MM/yyyy");
}

export function monthPeriod(key: string): Period {
  const match = MONTH_RE.exec(key);
  if (!match) throw new Error(`Competência inválida: ${key}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  return {
    key,
    start: localMidnight(year, month, 1),
    end: localMidnight(year, month + 1, 1),
    label: capitalize(format(new Date(year, month - 1, 1), "MMMM 'de' yyyy", { locale: ptBR })),
    kind: "mes",
  };
}

function quarterPeriod(year: number, quarter: number): Period {
  const firstMonth = (quarter - 1) * 3 + 1;
  return { key: `${year}-T${quarter}`, start: localMidnight(year, firstMonth, 1), end: localMidnight(year, firstMonth + 3, 1), label: `${quarter}º trimestre de ${year}`, kind: "trimestre" };
}

function yearPeriod(year: number): Period {
  return { key: String(year), start: localMidnight(year, 1, 1), end: localMidnight(year + 1, 1, 1), label: `Ano de ${year}`, kind: "ano" };
}

function lastDaysPeriod(days: 30 | 90, now: Date): Period {
  const [y, m, d] = localDayKey(now).split("-").map(Number);
  return { key: `${days}d`, start: localMidnight(y, m, d - (days - 1)), end: localMidnight(y, m, d + 1), label: `Últimos ${days} dias`, kind: days === 30 ? "30d" : "90d" };
}

function customPeriod(from: string, to: string): Period | null {
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) return null;
  const [a, b] = from <= to ? [from, to] : [to, from];
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  const start = localMidnight(y1, m1, d1);
  const end = localMidnight(y2, m2, d2 + 1);
  if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) return null;
  return { key: `${a}_${b}`, start, end, label: `${dayLabel(a)} a ${dayLabel(b)}`, kind: "custom" };
}

/** Período a partir da chave (null quando a chave não é reconhecida). */
export function periodFromKey(key: string | undefined | null, now: Date = new Date()): Period | null {
  if (!key) return null;
  if (MONTH_RE.test(key)) return monthPeriod(key);
  const q = QUARTER_RE.exec(key);
  if (q) return quarterPeriod(Number(q[1]), Number(q[2]));
  if (YEAR_RE.test(key)) return yearPeriod(Number(key));
  if (key === "30d") return lastDaysPeriod(30, now);
  if (key === "90d") return lastDaysPeriod(90, now);
  const c = CUSTOM_RE.exec(key);
  if (c) return customPeriod(c[1], c[2]);
  return null;
}

type ParamsLike = URLSearchParams | Record<string, string | string[] | undefined>;

function readParam(params: ParamsLike, name: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(name) ?? undefined;
  const value = params[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Período pedido na URL: ?periodo=<chave> ou ?de=AAAA-MM-DD&ate=AAAA-MM-DD. Sem parâmetro (ou inválido),
 * devolve o mês corrente.
 */
export function parsePeriod(params: ParamsLike = {}, now: Date = new Date()): Period {
  const from = readParam(params, "de");
  const to = readParam(params, "ate");
  if (from && to) {
    const custom = customPeriod(from, to);
    if (custom) return custom;
  }
  return periodFromKey(readParam(params, "periodo"), now) ?? monthPeriod(currentMonthKey(now));
}

/** Período imediatamente anterior, de mesma natureza (mês anterior, trimestre anterior, 30 dias antes...). */
export function previousPeriod(period: Period): Period {
  switch (period.kind) {
    case "mes": {
      const [y, m] = period.key.split("-").map(Number);
      return monthPeriod(new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7));
    }
    case "trimestre": {
      const [y, q] = period.key.split("-T").map(Number);
      return q === 1 ? quarterPeriod(y - 1, 4) : quarterPeriod(y, q - 1);
    }
    case "ano":
      return yearPeriod(Number(period.key) - 1);
    default: {
      const length = Date.parse(period.end) - Date.parse(period.start);
      const start = new Date(Date.parse(period.start) - length).toISOString();
      const lastDay = localDayKey(new Date(Date.parse(period.start) - DAY_MS));
      const firstDay = localDayKey(start);
      const custom = customPeriod(firstDay, lastDay)!;
      return { ...custom, label: period.kind === "custom" ? custom.label : `${custom.label} (anterior)` };
    }
  }
}

/** Os últimos `count` meses (do mais antigo ao mais recente), terminando no mês de `until` (padrão: mês atual). */
export function listRecentMonths(count: number, until: string | Period = currentMonthKey()): Period[] {
  const lastKey = typeof until === "string" ? until : localDayKey(new Date(Date.parse(until.end) - 1)).slice(0, 7);
  const [y, m] = lastKey.split("-").map(Number);
  const out: Period[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(monthPeriod(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7)));
  return out;
}

/** true quando o instante ISO cai dentro do período (início inclusivo, fim exclusivo). */
export function inPeriod(iso: string | undefined | null, period: Pick<Period, "start" | "end">): boolean {
  return Boolean(iso) && (iso as string) >= period.start && (iso as string) < period.end;
}

/** Instante de referência para indicadores de estado: o fim do período, ou agora se o período ainda não terminou. */
export function periodReference(period: Pick<Period, "end">, now: Date = new Date()): string {
  const nowIso = now.toISOString();
  return period.end < nowIso ? period.end : nowIso;
}

/** true quando "agora" está dentro do período (indicadores de estado atual só existem nele). */
export function isCurrentPeriod(period: Pick<Period, "start" | "end">, now: Date = new Date()): boolean {
  return inPeriod(now.toISOString(), period);
}

/** Duração do período em meses (fração para 30d/90d/personalizado), usada para escalar metas mensais de volume. */
export function periodMonths(period: Period): number {
  if (period.kind === "mes") return 1;
  if (period.kind === "trimestre") return 3;
  if (period.kind === "ano") return 12;
  return Math.max(1, Math.round((Date.parse(period.end) - Date.parse(period.start)) / DAY_MS)) / 30;
}

/** Opções do seletor de período: últimos meses, trimestres do ano, ano e janelas móveis. */
export function periodOptions(months = 12, now: Date = new Date()): { value: string; label: string; group: string }[] {
  const monthOptions = listRecentMonths(months, currentMonthKey(now))
    .reverse()
    .map((p) => ({ value: p.key, label: p.label, group: "Mês" }));
  const year = Number(currentMonthKey(now).slice(0, 4));
  const currentQuarter = Math.floor((Number(currentMonthKey(now).slice(5, 7)) - 1) / 3) + 1;
  const quarters: { value: string; label: string; group: string }[] = [];
  for (let q = currentQuarter, y = year, i = 0; i < 4; i++) {
    const p = quarterPeriod(y, q);
    quarters.push({ value: p.key, label: p.label, group: "Trimestre" });
    q -= 1;
    if (q === 0) {
      q = 4;
      y -= 1;
    }
  }
  return [
    ...monthOptions,
    ...quarters,
    { value: String(year), label: `Ano de ${year}`, group: "Ano" },
    { value: String(year - 1), label: `Ano de ${year - 1}`, group: "Ano" },
    { value: "30d", label: "Últimos 30 dias", group: "Janela móvel" },
    { value: "90d", label: "Últimos 90 dias", group: "Janela móvel" },
  ];
}
