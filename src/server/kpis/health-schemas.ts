/**
 * Saúde da operação e Índice de desempenho: configuração (settings "saude_operacao" e "indice_desempenho"),
 * valores padrão, validação (zod), normalização de indicadores para a escala 0–100 e faixas.
 *
 * Módulo puro (sem Firestore): usado pelo cálculo no servidor (operation-health.ts), pelas Server Actions e
 * pelos editores de configuração no navegador, para que a explicação exibida seja a mesma regra do cálculo.
 */
import { z } from "zod";
import { DEPARTMENT_KEYS, type DepartmentKey } from "@/domain/constants";
import type { Tone } from "@/components/ui/tone";

// ---------------------------------------------------------------------------
// Normalização: indicador → nota 0–100
// ---------------------------------------------------------------------------

export const NORMALIZATION_KINDS = ["fracao", "fracao_invertida", "escala", "atingimento", "proporcao_inversa", "metas_periodo"] as const;
export type NormalizationKind = (typeof NORMALIZATION_KINDS)[number];

export const NORMALIZATION_LABELS: Record<NormalizationKind, string> = {
  fracao: "Percentual direto (92% → 92)",
  fracao_invertida: "Percentual invertido (10% → 90)",
  escala: "Escala mín–máx (ex.: CSAT 0–10)",
  atingimento: "Atingimento da meta do indicador (limitado a 100)",
  proporcao_inversa: "Proporção inversa sobre outro indicador (base ÷ (valor + base))",
  metas_periodo: "Atingimento médio das metas do período",
};

export interface NormalizationSpec {
  tipo: NormalizationKind;
  /** Escala: valor que vale 0 e valor que vale 100 (min > max inverte a escala). */
  min?: number;
  max?: number;
  /** Proporção inversa: indicador de base (ex.: tarefas concluídas para tarefas atrasadas). */
  baseKpi?: string;
}

/** Entrada de um componente: um indicador do motor (ou "metas" para o atingimento das metas) com peso e normalização. */
export interface HealthKpiEntry {
  kpiKey: string;
  peso: number;
  normalizacao: NormalizationSpec;
}

export interface HealthComponentConfig {
  key: string;
  label: string;
  peso: number;
  /** O que o componente mede (texto do "ver detalhes"). */
  descricao?: string;
  kpis: HealthKpiEntry[];
}

export interface HealthBand {
  label: string;
  /** Nota mínima (0–100) para a faixa. */
  min: number;
}

export interface OperationHealthConfig {
  componentes: HealthComponentConfig[];
  faixas: HealthBand[];
}

/** Chave especial de entrada que representa "atingimento médio das metas do período" (não é indicador do registro). */
export const GOALS_ENTRY_KEY = "metas";

export const DEFAULT_OPERATION_HEALTH: OperationHealthConfig = {
  componentes: [
    {
      key: "produtividade",
      label: "Produtividade",
      peso: 20,
      descricao: "Entregas no prazo: das tarefas com prazo concluídas no período, a fração concluída até o prazo.",
      kpis: [{ kpiKey: "tarefas_no_prazo_pct", peso: 1, normalizacao: { tipo: "fracao" } }],
    },
    {
      key: "sla",
      label: "SLA",
      peso: 20,
      descricao: "Cumprimento de prazos do workflow (etapas no prazo) e de solução de chamados.",
      kpis: [
        { kpiKey: "sla_workflow_cumprido", peso: 1, normalizacao: { tipo: "fracao" } },
        { kpiKey: "sla_solucao", peso: 1, normalizacao: { tipo: "fracao" } },
      ],
    },
    {
      key: "qualidade",
      label: "Qualidade",
      peso: 20,
      descricao: "CSAT dos atendimentos (0–10 vira 0–100) e reincidência de chamados invertida (10% reabertos → 90).",
      kpis: [
        { kpiKey: "csat", peso: 2, normalizacao: { tipo: "escala", min: 0, max: 10 } },
        { kpiKey: "reincidencia", peso: 1, normalizacao: { tipo: "fracao_invertida" } },
      ],
    },
    {
      key: "atrasos",
      label: "Atrasos e backlog",
      peso: 15,
      descricao: "Quanto do volume não está atrasado: concluídas ÷ (atrasadas + concluídas) para tarefas e resolvidos ÷ (backlog + resolvidos) para chamados.",
      kpis: [
        { kpiKey: "tarefas_atrasadas", peso: 1, normalizacao: { tipo: "proporcao_inversa", baseKpi: "tarefas_concluidas" } },
        { kpiKey: "backlog_suporte", peso: 1, normalizacao: { tipo: "proporcao_inversa", baseKpi: "chamados_resolvidos" } },
      ],
    },
    {
      key: "satisfacao",
      label: "Satisfação",
      peso: 15,
      descricao: "Saúde média da carteira de clientes (health score 0–100).",
      kpis: [{ kpiKey: "saude_cliente", peso: 1, normalizacao: { tipo: "escala", min: 0, max: 100 } }],
    },
    {
      key: "metas",
      label: "Metas",
      peso: 10,
      descricao: "Atingimento médio (ponderado pelo peso, cada meta limitada a 100%) das metas cadastradas para o período.",
      kpis: [{ kpiKey: GOALS_ENTRY_KEY, peso: 1, normalizacao: { tipo: "metas_periodo" } }],
    },
  ],
  faixas: [
    { label: "Excelente", min: 90 },
    { label: "Muito boa", min: 75 },
    { label: "Boa", min: 60 },
    { label: "Atenção", min: 40 },
    { label: "Crítica", min: 0 },
  ],
};

/** Índice de desempenho individual: dimensões Eficiência, Entrega e Qualidade. */
export const PERFORMANCE_DIMENSIONS = ["eficiencia", "entrega", "qualidade"] as const;
export type PerformanceDimension = (typeof PERFORMANCE_DIMENSIONS)[number];
export const PERFORMANCE_DIMENSION_LABELS: Record<PerformanceDimension, string> = { eficiencia: "Eficiência", entrega: "Entrega", qualidade: "Qualidade" };

export interface PerformanceIndexDepartment {
  pesos: Record<PerformanceDimension, number>;
  /** Indicadores do scorecard da função que compõem cada dimensão. */
  indicadores: Record<PerformanceDimension, string[]>;
}

export interface PerformanceIndexConfig {
  /** Meta do índice (0–100), linha tracejada da evolução mensal. */
  meta: number;
  departamentos: Record<DepartmentKey, PerformanceIndexDepartment>;
  faixas: HealthBand[];
}

const W = (eficiencia: number, entrega: number, qualidade: number) => ({ eficiencia, entrega, qualidade });

export const DEFAULT_PERFORMANCE_INDEX: PerformanceIndexConfig = {
  meta: 80,
  departamentos: {
    marketing: { pesos: W(30, 40, 30), indicadores: { eficiencia: ["cpl"], entrega: ["leads_captados", "mqls"], qualidade: ["conversao_mql"] } },
    vendas: { pesos: W(30, 50, 20), indicadores: { eficiencia: ["conversao_funil", "ticket_medio"], entrega: ["novas_vendas", "receita_vendida", "setup_vendido", "recorrencia_vendida", "hardware_vendido"], qualidade: ["followups_atrasados"] } },
    financeiro: { pesos: W(30, 40, 30), indicadores: { eficiencia: ["tempo_liberacao_dias"], entrega: ["faturamento", "recebido", "mrr"], qualidade: ["inadimplencia"] } },
    implantacao: { pesos: W(30, 40, 30), indicadores: { eficiencia: ["tempo_medio_implantacao", "produtividade"], entrega: ["entregas_prazo", "implantacoes_concluidas", "ativacao_7_dias"], qualidade: ["chamados_30_dias"] } },
    cs: { pesos: W(30, 30, 40), indicadores: { eficiencia: ["adocao_media", "upsell_gerado"], entrega: ["taxa_renovacao"], qualidade: ["saude_cliente", "churn", "clientes_risco"] } },
    suporte: { pesos: W(30, 30, 40), indicadores: { eficiencia: ["sla_resposta", "chamados_resolvidos"], entrega: ["sla_solucao"], qualidade: ["csat", "reincidencia"] } },
    administrativo: { pesos: W(30, 40, 30), indicadores: { eficiencia: ["tarefas_concluidas"], entrega: ["tarefas_no_prazo_pct"], qualidade: ["tarefas_atrasadas"] } },
    diretoria: { pesos: W(30, 40, 30), indicadores: { eficiencia: ["sla_solucao"], entrega: ["entregas_prazo", "receita_vendida", "mrr"], qualidade: ["saude_cliente", "churn"] } },
  },
  faixas: [
    { label: "Excelente", min: 90 },
    { label: "Muito bom", min: 75 },
    { label: "Bom", min: 60 },
    { label: "Atenção", min: 40 },
    { label: "Crítico", min: 0 },
  ],
};

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

const keySchema = z
  .string()
  .trim()
  .min(2, "Chave muito curta")
  .max(40, "Chave muito longa (máx. 40)")
  .regex(/^[a-z0-9_]+$/, "Use apenas letras minúsculas, números e _ na chave");

const bandsSchema = z
  .array(z.object({ label: z.string().trim().min(1, "Informe o nome da faixa").max(40, "Nome muito longo"), min: z.number("Informe a nota mínima").min(0, "Mínimo 0").max(100, "Máximo 100") }))
  .min(2, "Cadastre ao menos duas faixas")
  .max(8, "Máximo de 8 faixas")
  .superRefine((bands, ctx) => {
    const mins = bands.map((b) => b.min);
    if (new Set(mins).size !== mins.length) ctx.addIssue({ code: "custom", message: "Duas faixas com a mesma nota mínima" });
    if (!mins.includes(0)) ctx.addIssue({ code: "custom", message: "Uma faixa precisa começar em 0" });
  });

const normalizationSchema = z
  .object({
    tipo: z.enum(NORMALIZATION_KINDS, { message: "Normalização inválida" }),
    min: z.number().optional(),
    max: z.number().optional(),
    baseKpi: z.string().trim().optional(),
  })
  .superRefine((n, ctx) => {
    if (n.tipo === "escala" && (n.min === undefined || n.max === undefined || n.min === n.max)) ctx.addIssue({ code: "custom", message: "Informe mínimo e máximo diferentes para a escala" });
    if (n.tipo === "proporcao_inversa" && !n.baseKpi) ctx.addIssue({ code: "custom", message: "Informe o indicador de base da proporção" });
  });

export const operationHealthSchema = z.object({
  componentes: z
    .array(
      z.object({
        key: keySchema,
        label: z.string().trim().min(2, "Nome muito curto").max(40, "Nome muito longo"),
        peso: z.number("Informe o peso").min(0, "Peso não pode ser negativo").max(100, "Peso máximo é 100"),
        descricao: z.string().trim().max(400, "Descrição muito longa").optional(),
        kpis: z
          .array(z.object({ kpiKey: z.string().trim().min(1, "Escolha o indicador"), peso: z.number("Informe o peso").positive("O peso deve ser maior que zero").max(100), normalizacao: normalizationSchema }))
          .min(1, "Cada componente precisa de ao menos um indicador")
          .max(8, "Máximo de 8 indicadores por componente"),
      }),
    )
    .min(1, "Cadastre ao menos um componente")
    .max(10, "Máximo de 10 componentes")
    .superRefine((items, ctx) => {
      const keys = items.map((c) => c.key);
      if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Chave de componente repetida" });
      if (items.reduce((s, c) => s + c.peso, 0) <= 0) ctx.addIssue({ code: "custom", message: "A soma dos pesos deve ser maior que zero" });
    }),
  faixas: bandsSchema,
});
export type OperationHealthInput = z.input<typeof operationHealthSchema>;

const dimensionWeights = z.object({
  eficiencia: z.number().min(0, "Peso inválido").max(100),
  entrega: z.number().min(0, "Peso inválido").max(100),
  qualidade: z.number().min(0, "Peso inválido").max(100),
});

const indexDepartmentSchema = z.object({
  pesos: dimensionWeights.refine((w) => w.eficiencia + w.entrega + w.qualidade > 0, "A soma dos pesos deve ser maior que zero"),
  indicadores: z.object({ eficiencia: z.array(z.string().trim().min(1)).max(10), entrega: z.array(z.string().trim().min(1)).max(10), qualidade: z.array(z.string().trim().min(1)).max(10) }),
});

export const performanceIndexSchema = z.object({
  meta: z.number("Informe a meta do índice").min(0, "Mínimo 0").max(100, "Máximo 100"),
  departamentos: z.partialRecord(z.enum(DEPARTMENT_KEYS), indexDepartmentSchema),
  faixas: bandsSchema,
});
export type PerformanceIndexInput = z.input<typeof performanceIndexSchema>;

// ---------------------------------------------------------------------------
// Mescla com os padrões (documento parcial ou antigo nunca quebra o cálculo)
// ---------------------------------------------------------------------------

export function mergeOperationHealth(value: unknown): OperationHealthConfig {
  const parsed = operationHealthSchema.safeParse(value);
  if (parsed.success) return parsed.data as OperationHealthConfig;
  return DEFAULT_OPERATION_HEALTH;
}

export function mergePerformanceIndex(value: unknown): PerformanceIndexConfig {
  const v = (value ?? {}) as Partial<PerformanceIndexConfig>;
  const departamentos = { ...DEFAULT_PERFORMANCE_INDEX.departamentos };
  for (const dep of DEPARTMENT_KEYS) {
    const custom = v.departamentos?.[dep];
    if (!custom) continue;
    const parsed = indexDepartmentSchema.safeParse(custom);
    if (parsed.success) departamentos[dep] = parsed.data;
  }
  const faixas = bandsSchema.safeParse(v.faixas);
  const meta = typeof v.meta === "number" && v.meta >= 0 && v.meta <= 100 ? v.meta : DEFAULT_PERFORMANCE_INDEX.meta;
  return { meta, departamentos, faixas: faixas.success ? faixas.data : DEFAULT_PERFORMANCE_INDEX.faixas };
}

// ---------------------------------------------------------------------------
// Faixas e tons
// ---------------------------------------------------------------------------

/** Faixa de uma nota 0–100 (a de maior mínimo que a nota alcança). */
export function bandFor(score: number | null, bands: HealthBand[]): HealthBand | null {
  if (score === null) return null;
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  return sorted.find((b) => score >= b.min) ?? sorted[sorted.length - 1] ?? null;
}

/** Tom da faixa pela posição: as duas melhores verdes, a do meio âmbar, as piores vermelhas. */
export function bandTone(band: HealthBand | null, bands: HealthBand[]): Tone {
  if (!band) return "neutral";
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  const index = sorted.findIndex((b) => b.min === band.min);
  const fromBottom = sorted.length - 1 - index;
  if (index <= Math.max(0, Math.floor(sorted.length / 2) - 1)) return "success";
  if (fromBottom === 0) return "danger";
  return "warning";
}

/** Nota 0–100 de um valor segundo a normalização (null quando não há base). */
export function normalizeValue(spec: NormalizationSpec, value: number | null, extra: { attainment?: number | null; base?: number | null } = {}): number | null {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  switch (spec.tipo) {
    case "fracao":
      return value === null ? null : clamp(value * 100);
    case "fracao_invertida":
      return value === null ? null : clamp((1 - value) * 100);
    case "escala": {
      if (value === null || spec.min === undefined || spec.max === undefined || spec.min === spec.max) return null;
      return clamp(((value - spec.min) / (spec.max - spec.min)) * 100);
    }
    case "atingimento":
    case "metas_periodo":
      return extra.attainment === null || extra.attainment === undefined ? null : clamp(extra.attainment * 100);
    case "proporcao_inversa": {
      const base = extra.base ?? null;
      if (value === null || base === null) return null;
      if (value + base <= 0) return null;
      return clamp((base / (value + base)) * 100);
    }
    default:
      return null;
  }
}

/** Explicação curta da normalização para a tela de detalhes. */
export function describeNormalization(spec: NormalizationSpec, baseName?: string): string {
  switch (spec.tipo) {
    case "fracao":
      return "percentual direto";
    case "fracao_invertida":
      return "100 − percentual";
    case "escala":
      return `escala ${spec.min} → 0 e ${spec.max} → 100`;
    case "atingimento":
      return "atingimento da meta (máx. 100)";
    case "proporcao_inversa":
      return `${baseName ?? spec.baseKpi} ÷ (valor + ${baseName ?? spec.baseKpi})`;
    case "metas_periodo":
      return "média ponderada do atingimento das metas";
    default:
      return "";
  }
}
