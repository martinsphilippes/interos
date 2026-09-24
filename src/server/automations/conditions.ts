/**
 * Avaliação de condições e renderização de templates do motor de automações.
 *
 * Caminhos com ponto sobre o contexto da execução ("payload.priority", "entity.status",
 * "client.healthLevel"). Campos derivados: "hoursSince<Campo>" e "daysSince<Campo>" calculam o tempo
 * desde uma data do mesmo objeto (ex.: "opportunity.hoursSinceLastActivity" usa lastActivityAt).
 * Datas ISO são comparadas como instantes; números em texto viram números.
 */
import { formatDateTime } from "@/lib/format";
import type { ConditionOperator, ConditionResult, RuleCondition } from "./schemas";

const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;

function own(obj: unknown, key: string): unknown {
  if (obj === null || typeof obj !== "object" || FORBIDDEN.has(key)) return undefined;
  if (Array.isArray(obj) && /^\d+$/.test(key)) return obj[Number(key)];
  return Object.prototype.hasOwnProperty.call(obj, key) ? (obj as Record<string, unknown>)[key] : undefined;
}

/** Tempo decorrido (horas ou dias) desde um campo de data: "hoursSinceLastActivity" → lastActivity(At). */
function derived(obj: unknown, key: string, now: number): unknown {
  const match = /^(hours|days)Since([A-Z]\w*)$/.exec(key);
  if (!match) return undefined;
  const base = match[2][0].toLowerCase() + match[2].slice(1);
  const raw = own(obj, base) ?? own(obj, `${base}At`) ?? own(obj, base.replace(/At$/, ""));
  if (typeof raw !== "string" || !ISO_DATE_RE.test(raw)) return undefined;
  const ms = now - new Date(raw).getTime();
  if (!Number.isFinite(ms)) return undefined;
  return Math.floor((ms / (match[1] === "hours" ? 3_600_000 : 86_400_000)) * 10) / 10;
}

/** Lê um caminho com ponto de forma segura (sem acesso a protótipos). */
export function getPath(ctx: unknown, path: string, now: number = Date.now()): unknown {
  let current: unknown = ctx;
  for (const segment of path.split(".")) {
    if (!segment) return undefined;
    const next = own(current, segment);
    current = next === undefined ? derived(current, segment, now) : next;
    if (current === undefined || current === null) return current;
  }
  return current;
}

type Comparable = number | string | boolean | null;

function toComparable(value: unknown): Comparable {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim();
    if (NUMBER_RE.test(v)) return Number(v);
    if (v === "true" || v === "false") return v === "true";
    if (ISO_DATE_RE.test(v)) {
      const t = new Date(v).getTime();
      if (Number.isFinite(t)) return t;
    }
    return v;
  }
  return JSON.stringify(value);
}

function equals(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) return actual.some((item) => equals(item, expected));
  const a = toComparable(actual);
  const b = toComparable(expected);
  if (a === null || b === null) return a === b || (a === null && b === "") || (b === null && a === "");
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b, "pt-BR", { sensitivity: "base" }) === 0;
  return a === b;
}

function order(actual: unknown, expected: unknown): number | null {
  const a = toComparable(actual);
  const b = toComparable(expected);
  if (a === null || b === null) return null;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b, "pt-BR");
  return null;
}

function isFilled(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function compare(actual: unknown, operator: ConditionOperator, expected: unknown, now: number = Date.now()): boolean {
  switch (operator) {
    case "==":
      return equals(actual, expected);
    case "!=":
      return !equals(actual, expected);
    case ">":
    case "<":
    case ">=":
    case "<=": {
      const diff = order(actual, expected);
      if (diff === null) return false;
      return operator === ">" ? diff > 0 : operator === "<" ? diff < 0 : operator === ">=" ? diff >= 0 : diff <= 0;
    }
    case "contains": {
      if (Array.isArray(actual)) return actual.some((item) => equals(item, expected));
      if (typeof actual !== "string") return false;
      return actual.toLocaleLowerCase("pt-BR").includes(String(expected ?? "").toLocaleLowerCase("pt-BR"));
    }
    case "exists": {
      const want = expected === false || expected === "false" ? false : true;
      return isFilled(actual) === want;
    }
    case "older_than_hours": {
      if (typeof actual !== "string" || !ISO_DATE_RE.test(actual)) return false;
      const hours = Number(expected);
      const t = new Date(actual).getTime();
      return Number.isFinite(hours) && Number.isFinite(t) && now - t > hours * 3_600_000;
    }
  }
}

/** Avalia todas as condições (E lógico). Sem condições, a regra sempre passa. */
export function evaluateConditions(conditions: RuleCondition[], ctx: unknown, now: number = Date.now()): { passed: boolean; results: ConditionResult[] } {
  const results = conditions.map((c) => {
    const actual = getPath(ctx, c.path, now);
    return { path: c.path, operator: c.operator, expected: c.value, actual: summarize(actual), ok: compare(actual, c.operator, c.value, now) };
  });
  return { passed: results.every((r) => r.ok), results };
}

/** Valor compacto e serializável para gravar no automation_run. */
function summarize(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.slice(0, 10).map((v) => (typeof v === "object" ? "[objeto]" : v));
  if (value && typeof value === "object") return "[objeto]";
  return value;
}

/** Texto de uma condição para listas e relatórios. */
export function describeCondition(c: Pick<RuleCondition, "path" | "operator" | "value">): string {
  const labels: Record<ConditionOperator, string> = {
    "==": "=",
    "!=": "≠",
    ">": ">",
    "<": "<",
    ">=": "≥",
    "<=": "≤",
    contains: "contém",
    exists: "preenchido",
    older_than_hours: "há mais de",
  };
  if (c.operator === "exists") return `${c.path} ${c.value === false || c.value === "false" ? "vazio" : "preenchido"}`;
  if (c.operator === "older_than_hours") return `${c.path} há mais de ${String(c.value)}h`;
  return `${c.path} ${labels[c.operator]} ${String(c.value ?? "")}`;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return ISO_DATE_RE.test(value) && value.includes("T") ? formatDateTime(value) : value;
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  if (typeof value === "boolean") return value ? "sim" : "não";
  if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join(", ");
  return "";
}

const TEMPLATE_RE = /\{\{\s*([A-Za-z_][\w]*(?:\.[\w]+)*)\s*\}\}/g;

/** Substitui {{caminho}} pelo valor do contexto (sem expressões; caminho ausente vira texto vazio). */
export function renderTemplate(template: string, ctx: unknown, now: number = Date.now()): string {
  return template.replace(TEMPLATE_RE, (_, path: string) => formatValue(getPath(ctx, path, now))).replace(/[ \t]{2,}/g, " ").trim();
}

export function hasTemplate(value: string | undefined): boolean {
  return Boolean(value && /\{\{[^}]+\}\}/.test(value));
}
