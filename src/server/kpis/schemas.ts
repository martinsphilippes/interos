/**
 * Validação (zod), rótulos e formatação compartilhados do motor de indicadores.
 * Módulo puro (sem Firestore): usado pelas Server Actions e pelos Client Components.
 */
import { z } from "zod";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import type { Kpi, KpiDirection } from "@/domain/types";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";

export type KpiScope = "empresa" | "departamento" | "usuario";
export type KpiUnit = Kpi["unit"];
export type KpiStatus = "atingida" | "atencao" | "critico";
export type KpiDepartment = DepartmentKey | "empresa";

export const KPI_SCOPES = ["empresa", "departamento", "usuario"] as const satisfies readonly KpiScope[];
export const KPI_UNITS = ["numero", "percentual", "moeda", "horas", "dias"] as const satisfies readonly KpiUnit[];
export const KPI_DIRECTIONS = ["maior_melhor", "menor_melhor", "faixa"] as const satisfies readonly KpiDirection[];
export const KPI_DEPARTMENTS = ["empresa", ...DEPARTMENT_KEYS] as const;

export const SCOPE_LABELS: Record<KpiScope, string> = { empresa: "Empresa", departamento: "Departamento", usuario: "Colaborador" };
export const UNIT_LABELS: Record<KpiUnit, string> = { numero: "Número", percentual: "Percentual", moeda: "Moeda (R$)", horas: "Horas", dias: "Dias" };
export const DIRECTION_LABELS: Record<KpiDirection, string> = { maior_melhor: "Maior é melhor", menor_melhor: "Menor é melhor", faixa: "Dentro da faixa" };
export const STATUS_LABELS: Record<KpiStatus, string> = { atingida: "Atingida", atencao: "Atenção", critico: "Crítico" };
export const STATUS_TONES: Record<KpiStatus, "success" | "warning" | "danger"> = { atingida: "success", atencao: "warning", critico: "danger" };

export function departmentLabel(dep: KpiDepartment | string | undefined): string {
  if (!dep) return "—";
  if (dep === "empresa") return "Empresa";
  return DEPARTMENT_LABELS[dep as DepartmentKey] ?? dep;
}

/** Valor do indicador formatado conforme a unidade (percentual recebe fração: 0,85 → 85%). */
export function formatKpiValue(value: number | null | undefined, unit: KpiUnit, suffix?: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  switch (unit) {
    case "moeda":
      return formatCurrency(value);
    case "percentual":
      return formatPercent(value);
    case "horas":
      return `${formatNumber(Math.round(value * 10) / 10)} h`;
    case "dias":
      return `${formatNumber(Math.round(value * 10) / 10)} ${Math.abs(value) === 1 ? "dia" : "dias"}`;
    default: {
      const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
      return `${formatNumber(rounded)}${suffix ? ` ${suffix}` : ""}`;
    }
  }
}

/** Variação entre dois valores formatada na unidade do indicador (pontos percentuais para percentuais). */
export function formatKpiDelta(delta: number | null | undefined, unit: KpiUnit, suffix?: string): string {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return "—";
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const abs = Math.abs(delta);
  if (unit === "percentual") return `${sign}${formatNumber(Math.round(abs * 1000) / 10)} p.p.`;
  return `${sign}${formatKpiValue(abs, unit, suffix)}`;
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

export function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Dados inválidos";
  const path = issue.path.filter((p) => typeof p === "string").join(".");
  return path ? `${issue.message} (${path})` : issue.message;
}

const optionalNumber = z.number("Informe um número válido").optional();

export const kpiInputSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    key: z
      .string()
      .trim()
      .min(2, "A chave precisa de pelo menos 2 caracteres")
      .max(60, "Chave muito longa (máx. 60)")
      .regex(/^[a-z0-9_]+$/, "Use apenas letras minúsculas, números e _ na chave"),
    name: z.string().trim().min(3, "Nome muito curto").max(100, "Nome muito longo (máx. 100)"),
    department: z.enum(KPI_DEPARTMENTS, { message: "Departamento inválido" }),
    description: z.string().trim().max(600, "Descrição muito longa (máx. 600)").optional(),
    formula: z.string().trim().min(1, "Escolha a fórmula"),
    unit: z.enum(KPI_UNITS, { message: "Unidade inválida" }),
    direction: z.enum(KPI_DIRECTIONS, { message: "Sentido inválido" }),
    target: optionalNumber,
    targetMin: optionalNumber,
    targetMax: optionalNumber,
    attentionPct: z.number("Informe o percentual de atenção").min(1, "Atenção deve ser entre 1 e 100%").max(100, "Atenção deve ser entre 1 e 100%"),
    weight: z.number("Informe o peso").min(0, "Peso não pode ser negativo").max(100, "Peso máximo é 100"),
    ownerId: z.string().trim().optional(),
    active: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (data.direction === "faixa") {
      if (data.targetMin === undefined || data.targetMax === undefined) ctx.addIssue({ code: "custom", message: "Informe o mínimo e o máximo da faixa", path: ["targetMin"] });
      else if (data.targetMin > data.targetMax) ctx.addIssue({ code: "custom", message: "O mínimo da faixa deve ser menor que o máximo", path: ["targetMax"] });
    }
    if (data.unit === "percentual") {
      for (const field of ["target", "targetMin", "targetMax"] as const) {
        const v = data[field];
        if (v !== undefined && (v < 0 || v > 10)) ctx.addIssue({ code: "custom", message: "Percentuais são frações (ex.: 0,9 = 90%)", path: [field] });
      }
    }
  });
export type KpiInput = z.input<typeof kpiInputSchema>;

export const toggleKpiSchema = z.object({ id: z.string().trim().min(1, "Indicador inválido"), active: z.boolean() });

const periodKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Metas são mensais: informe a competência AAAA-MM");

export const goalInputSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    kpiKey: z.string().trim().min(1, "Escolha o indicador"),
    scope: z.enum(KPI_SCOPES, { message: "Escopo inválido" }),
    scopeId: z.string().trim().optional(),
    period: periodKeySchema,
    target: z.number("Informe o alvo"),
    weight: z.number("Informe o peso").min(0, "Peso não pode ser negativo").max(100, "Peso máximo é 100"),
  })
  .superRefine((data, ctx) => {
    if (data.scope !== "empresa" && !data.scopeId) ctx.addIssue({ code: "custom", message: data.scope === "usuario" ? "Escolha o colaborador" : "Escolha o departamento", path: ["scopeId"] });
    if (data.scope === "departamento" && data.scopeId && !(DEPARTMENT_KEYS as readonly string[]).includes(data.scopeId)) ctx.addIssue({ code: "custom", message: "Departamento inválido", path: ["scopeId"] });
  });
export type GoalInput = z.input<typeof goalInputSchema>;

export const goalIdSchema = z.object({ id: z.string().trim().min(1, "Meta inválida") });
export const copyGoalsSchema = z.object({ period: periodKeySchema });

/** Id determinístico de meta: uma por indicador/escopo/competência. */
export function goalDocId(kpiKey: string, period: string, scope: KpiScope, scopeId?: string): string {
  return `goal_${kpiKey}_${period}_${scope}_${scopeId ?? "org"}`;
}

/**
 * Link do drill-down de um indicador: /gestao/indicadores/<kpiKey>?periodo=&escopo=&id=.
 * `period` aceita o objeto Period ou a chave (ex.: "2026-09").
 */
export function kpiHref(kpiKey: string, period: { key: string } | string, scope: KpiScope = "empresa", id?: string): string {
  const params = new URLSearchParams({ periodo: typeof period === "string" ? period : period.key });
  if (scope !== "empresa") params.set("escopo", scope);
  if (scope !== "empresa" && id) params.set("id", id);
  return `/gestao/indicadores/${encodeURIComponent(kpiKey)}?${params.toString()}`;
}
