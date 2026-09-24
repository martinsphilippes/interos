/**
 * Esquemas zod do módulo de Administração (usuários, departamentos, produtos, configurações e
 * regras de SLA). Mensagens em português porque chegam ao usuário via toast/formulário.
 *
 * As chaves e formatos das configurações (`settings`) espelham o que o seed grava em
 * scripts/seed/catalog.ts: outros módulos leem esses documentos via getSetting().
 */
import { z } from "zod";
import { DEFAULT_GAMIFICATION, DEFAULT_SALES_PRIZES } from "@/server/performance/schemas";
import { DEPARTMENT_KEYS, PRODUCT_CATEGORIES, ROLE_KEYS } from "@/domain/constants";

export function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Dados inválidos";
  const path = issue.path.filter((p) => typeof p === "string").join(".");
  return path ? `${issue.message} (${path})` : issue.message;
}

const idSchema = z.string().trim().min(1, "Identificador obrigatório");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .optional()
    .transform((v) => (v ? v : undefined));
const optionalId = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

// ---------------------------------------------------------------------------
// Usuários
// ---------------------------------------------------------------------------

const nameSchema = z.string().trim().min(2, "Informe o nome completo").max(120, "Nome muito longo (máx. 120)");
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "E-mail inválido");
const passwordSchema = z.string().min(8, "A senha deve ter pelo menos 8 caracteres").max(100, "Senha muito longa (máx. 100)");
const phoneSchema = z
  .string()
  .optional()
  .transform((v) => (v ? v.replace(/\D/g, "") : undefined))
  .refine((v) => !v || v.length === 10 || v.length === 11, "Telefone inválido (use DDD + número)");
/** Metas mensais do colaborador: pares chave/valor numérico (ex.: setup: 10000). */
const goalsSchema = z
  .record(z.string().trim().min(1, "Chave da meta vazia").max(40, "Chave da meta muito longa"), z.number("Valor da meta inválido"))
  .default({});

export const userFieldsSchema = z.object({
  name: nameSchema,
  role: z.enum(ROLE_KEYS, { message: "Papel inválido" }),
  departmentId: z.enum(DEPARTMENT_KEYS, { message: "Departamento inválido" }),
  managerId: optionalId,
  jobTitle: optionalText(80),
  phone: phoneSchema,
  monthlyGoals: goalsSchema,
  /** Salário base (R$) usado no bônus; visível só para o próprio colaborador, o gestor e o admin. */
  baseSalary: z.number("Salário inválido").min(0, "O salário não pode ser negativo").max(1_000_000, "Salário muito alto").optional(),
});

export const createUserSchema = userFieldsSchema.extend({
  email: emailSchema,
  password: passwordSchema,
});
export type CreateUserInput = z.input<typeof createUserSchema>;

export const updateUserSchema = userFieldsSchema.extend({
  id: idSchema,
  active: z.boolean(),
});
export type UpdateUserInput = z.input<typeof updateUserSchema>;

export const setUserActiveSchema = z.object({ id: idSchema, active: z.boolean() });
export const resetPasswordSchema = z.object({ id: idSchema, password: passwordSchema });
export const userIdSchema = z.object({ id: idSchema });

// ---------------------------------------------------------------------------
// Departamentos
// ---------------------------------------------------------------------------

const colorSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.toUpperCase() : undefined))
  .refine((v) => !v || /^#[0-9A-F]{6}$/.test(v), "Cor inválida (use o formato #RRGGBB)");

export const updateDepartmentSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(2, "Informe o nome do departamento").max(60, "Nome muito longo (máx. 60)"),
  managerId: optionalId,
  color: colorSchema,
  description: optionalText(200),
  order: z.number().int("Ordem deve ser um número inteiro").min(1, "Ordem mínima é 1").max(99, "Ordem máxima é 99"),
});
export type UpdateDepartmentInput = z.input<typeof updateDepartmentSchema>;

// ---------------------------------------------------------------------------
// Produtos
// ---------------------------------------------------------------------------

const money = (label: string) => z.number(`${label} inválido`).min(0, `${label} não pode ser negativo`).max(10_000_000, `${label} muito alto`);
const pct = (label: string) => z.number(`${label} inválida`).min(0, `${label} não pode ser negativa`).max(100, `${label} máxima é 100%`);

export const BILLING_TYPES = ["recorrente", "unico", "ambos"] as const;

export const productFieldsSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do produto").max(120, "Nome muito longo (máx. 120)"),
  category: z.enum(PRODUCT_CATEGORIES, { message: "Categoria inválida" }),
  description: optionalText(500),
  setupPrice: money("Valor de setup"),
  monthlyPrice: money("Valor mensal"),
  hardwarePrice: money("Valor de hardware"),
  billingType: z.enum(BILLING_TYPES, { message: "Tipo de cobrança inválido" }),
  commission: z.object({
    setupPct: pct("Comissão de setup"),
    recurringPct: pct("Comissão de recorrência"),
    hardwarePct: pct("Comissão de hardware"),
    recurringReleaseInstallment: z.number("Parcela de liberação inválida").int("Parcela deve ser inteira").min(1, "Parcela mínima é 1").max(36, "Parcela máxima é 36"),
  }),
  implementationTemplateId: optionalId,
  implementationDays: z.number("Dias de implantação inválido").int("Dias de implantação deve ser inteiro").min(0, "Dias não pode ser negativo").max(365, "Máximo de 365 dias").optional(),
  active: z.boolean().default(true),
  /** Posição no catálogo. Na criação, se omitida, vai para o fim. */
  order: z.number("Ordem inválida").int("Ordem deve ser inteira").min(1, "Ordem mínima é 1").max(999, "Ordem máxima é 999").optional(),
});

export const createProductSchema = productFieldsSchema;
export type CreateProductInput = z.input<typeof createProductSchema>;

export const updateProductSchema = productFieldsSchema.extend({ id: idSchema });
export type UpdateProductInput = z.input<typeof updateProductSchema>;

export const moveProductSchema = z.object({ id: idSchema, direction: z.enum(["up", "down"], { message: "Direção inválida" }) });
export const setProductActiveSchema = z.object({ id: idSchema, active: z.boolean() });

// ---------------------------------------------------------------------------
// Configurações do sistema (coleção settings, um documento por key)
// ---------------------------------------------------------------------------

export const SETTING_KEYS = ["horario_comercial", "feriados", "metas_referencia", "lead_scoring", "health_score", "oportunidade", "gate_financeiro", "go_live", "cs_ativacao", "gamificacao", "premios_vendas"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

const fraction = (label: string) => z.number(`${label} inválido`).min(0, `${label} não pode ser negativo`).max(1, `${label} deve ser uma fração entre 0 e 1`);
const pointsTable = z.record(z.string().trim().min(1, "Chave vazia").max(60, "Chave muito longa"), z.number("Pontuação inválida").int("Pontuação deve ser inteira").min(-100, "Pontuação mínima é -100").max(100, "Pontuação máxima é 100"));

export const horarioComercialSchema = z
  .object({
    inicio: z.number("Hora de início inválida").int().min(0, "Início mínimo é 0h").max(23, "Início máximo é 23h"),
    fim: z.number("Hora de fim inválida").int().min(1, "Fim mínimo é 1h").max(24, "Fim máximo é 24h"),
    /** Dias da semana (0 = domingo … 6 = sábado). */
    dias: z
      .array(z.number().int().min(0).max(6))
      .min(1, "Selecione pelo menos um dia da semana")
      .transform((d) => Array.from(new Set(d)).sort((a, b) => a - b)),
  })
  .refine((v) => v.inicio < v.fim, { message: "O início do expediente deve ser antes do fim", path: ["fim"] });
export type HorarioComercial = z.infer<typeof horarioComercialSchema>;

export const feriadosSchema = z.object({
  dates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use AAAA-MM-DD)"))
    .max(500, "No máximo 500 feriados")
    .transform((d) => Array.from(new Set(d)).sort()),
});
export type Feriados = z.infer<typeof feriadosSchema>;

export const metasReferenciaSchema = z.object({
  csat: z.number("CSAT inválido").min(0, "CSAT mínimo é 0").max(10, "CSAT máximo é 10"),
  churnMax: fraction("Churn máximo"),
  reincidenciaMax: fraction("Reincidência máxima"),
  slaSuporte: fraction("SLA de suporte"),
  implantacaoPrazo: fraction("Implantação no prazo"),
  ativacao7dias: fraction("Ativação em 7 dias"),
  mrrCrescimento: z.number("Crescimento de MRR inválido").min(0, "Crescimento não pode ser negativo").max(10, "Crescimento muito alto"),
  ticketMedio: z.number("Ticket médio inválido").min(0, "Ticket médio não pode ser negativo"),
});
export type MetasReferencia = z.infer<typeof metasReferenciaSchema>;

export const leadScoringSchema = z
  .object({
    origem: pointsTable,
    interesse: pointsTable,
    cidade: pointsTable,
    limiares: z.object({
      quente: z.number("Limiar quente inválido").int().min(0, "Limiar mínimo é 0").max(1000, "Limiar máximo é 1000"),
      morno: z.number("Limiar morno inválido").int().min(0, "Limiar mínimo é 0").max(1000, "Limiar máximo é 1000"),
    }),
  })
  .refine((v) => v.limiares.morno < v.limiares.quente, { message: "O limiar de lead morno deve ser menor que o de lead quente", path: ["limiares", "morno"] });
export type LeadScoring = z.infer<typeof leadScoringSchema>;

export const healthScoreSchema = z
  .object({
    pesos: z.record(z.string().trim().min(1, "Chave vazia").max(40, "Chave muito longa"), z.number("Peso inválido").min(0, "Peso mínimo é 0").max(100, "Peso máximo é 100")),
    limiares: z.object({
      saudavel: z.number("Limiar saudável inválido").min(0, "Limiar mínimo é 0").max(100, "Limiar máximo é 100"),
      atencao: z.number("Limiar de atenção inválido").min(0, "Limiar mínimo é 0").max(100, "Limiar máximo é 100"),
    }),
  })
  .refine((v) => v.limiares.atencao < v.limiares.saudavel, { message: "O limiar de atenção deve ser menor que o de saudável", path: ["limiares", "atencao"] });
export type HealthScoreConfig = z.infer<typeof healthScoreSchema>;

export const oportunidadeSchema = z.object({
  diasSemMovimentoParaParada: z.number("Dias inválido").int("Dias deve ser inteiro").min(1, "Mínimo de 1 dia").max(365, "Máximo de 365 dias"),
  horasSemInteracaoFollowup: z.number("Horas inválido").int("Horas deve ser inteiro").min(1, "Mínimo de 1 hora").max(8760, "Máximo de 8760 horas"),
});
export type OportunidadeConfig = z.infer<typeof oportunidadeSchema>;

/** Critérios do gate financeiro (lido por src/server/finance/service.ts → getGateSettings). */
export const gateFinanceiroSchema = z.object({
  exigeContratoAssinado: z.boolean("Informe se o contrato assinado é obrigatório"),
  exigePagamento: z.enum(["setup", "primeira_mensalidade", "nenhum"], { message: "Exigência de pagamento inválida" }),
  permiteExcecaoGestor: z.boolean("Informe se o gestor pode liberar por exceção"),
});
export type GateFinanceiroConfig = z.infer<typeof gateFinanceiroSchema>;

/** Aprovação do go-live (lido por src/server/implementation/service.ts → getGoLiveSettings). */
export const goLiveSchema = z.object({
  exigeAprovacaoGestor: z.boolean("Informe se o go-live exige aprovação de gestor"),
});
export type GoLiveConfig = z.infer<typeof goLiveSchema>;

/** Gate de ativação do cliente pelo CS (lido por src/server/cs/service.ts → getActivationSettings). */
export const csAtivacaoSchema = z.object({
  adocaoMinimaPct: z.number("Adoção mínima inválida").int("Use um percentual inteiro").min(0, "Mínimo 0%").max(100, "Máximo 100%"),
  exigePlano: z.boolean("Informe se o plano de sucesso é obrigatório"),
});
export type CsAtivacaoConfig = z.infer<typeof csAtivacaoSchema>;

/** Gamificação (lida por src/server/performance/gamification.ts → getGamificationSettings). */
export const gamificacaoSchema = z.object({
  pontos: z.record(z.string().trim().min(1).max(40), z.number("Pontos inválidos").int("Use pontos inteiros").min(0, "Mínimo 0").max(1000, "Máximo 1000")),
  multiplicadores: z.record(z.enum(DEPARTMENT_KEYS), z.number("Multiplicador inválido").min(0.1, "Mínimo 0,1").max(10, "Máximo 10")),
  niveis: z.array(z.object({ nome: z.string().trim().min(1).max(40), minimo: z.number().min(0) })).min(1, "Informe ao menos um nível"),
});
export type GamificacaoConfig = z.infer<typeof gamificacaoSchema>;

/** "N_salario(s)" (salários mínimos) ou valor fixo em R$. */
const prizeSpecSchema = z.union([z.string().trim().regex(/^\d+(?:[.,]\d+)?_salarios?$/, "Use N_salario (ex.: 1_salario) ou um valor em R$"), z.number().min(0, "Valor não pode ser negativo")]);
/** Prêmios de meta batida em Vendas (lido por src/server/performance/queries.ts → getSalesPrizeSettings). */
export const premiosVendasSchema = z.object({
  salarioMinimo: z.number("Salário mínimo inválido").min(0).max(100_000),
  adesao: prizeSpecSchema,
  recorrencia: prizeSpecSchema,
  hardware: prizeSpecSchema,
});
export type PremiosVendasConfig = z.infer<typeof premiosVendasSchema>;

export const SETTING_SCHEMAS = {
  horario_comercial: horarioComercialSchema,
  feriados: feriadosSchema,
  metas_referencia: metasReferenciaSchema,
  lead_scoring: leadScoringSchema,
  health_score: healthScoreSchema,
  oportunidade: oportunidadeSchema,
  gate_financeiro: gateFinanceiroSchema,
  go_live: goLiveSchema,
  cs_ativacao: csAtivacaoSchema,
  gamificacao: gamificacaoSchema,
  premios_vendas: premiosVendasSchema,
} as const;

export interface SettingValues {
  horario_comercial: HorarioComercial;
  feriados: Feriados;
  metas_referencia: MetasReferencia;
  lead_scoring: LeadScoring;
  health_score: HealthScoreConfig;
  oportunidade: OportunidadeConfig;
  gate_financeiro: GateFinanceiroConfig;
  go_live: GoLiveConfig;
  cs_ativacao: CsAtivacaoConfig;
  gamificacao: GamificacaoConfig;
  premios_vendas: PremiosVendasConfig;
}

/** Valores usados quando o documento ainda não existe no banco (iguais ao seed). */
export const SETTING_DEFAULTS: SettingValues = {
  horario_comercial: { inicio: 8, fim: 18, dias: [1, 2, 3, 4, 5] },
  feriados: { dates: [] },
  metas_referencia: { csat: 8.5, churnMax: 0.03, reincidenciaMax: 0.1, slaSuporte: 0.9, implantacaoPrazo: 0.9, ativacao7dias: 0.8, mrrCrescimento: 0.08, ticketMedio: 350 },
  lead_scoring: { origem: {}, interesse: {}, cidade: {}, limiares: { quente: 70, morno: 40 } },
  health_score: { pesos: { uso: 25, satisfacao: 20, sla: 15, suporte: 15, reincidencia: 10, financeiro: 15 }, limiares: { saudavel: 75, atencao: 50 } },
  oportunidade: { diasSemMovimentoParaParada: 7, horasSemInteracaoFollowup: 48 },
  gate_financeiro: { exigeContratoAssinado: true, exigePagamento: "setup", permiteExcecaoGestor: true },
  go_live: { exigeAprovacaoGestor: true },
  cs_ativacao: { adocaoMinimaPct: 30, exigePlano: true },
  gamificacao: { pontos: { ...DEFAULT_GAMIFICATION.pontos }, multiplicadores: { ...DEFAULT_GAMIFICATION.multiplicadores }, niveis: DEFAULT_GAMIFICATION.niveis.map((n) => ({ ...n })) },
  premios_vendas: { ...DEFAULT_SALES_PRIZES },
};

export const SETTING_DESCRIPTIONS: Record<SettingKey, string> = {
  horario_comercial: "Expediente considerado pelo SLA.",
  feriados: "Feriados nacionais considerados no cálculo de SLA em horas úteis.",
  metas_referencia: "Metas de referência da empresa.",
  lead_scoring: "Pontuação de leads por origem, interesse e cidade; limiares de temperatura.",
  health_score: "Pesos e limiares do health score de clientes.",
  oportunidade: "Parâmetros de acompanhamento de oportunidades.",
  gate_financeiro: "Critérios do gate financeiro para liberar a implantação.",
  go_live: "Regras de aprovação do go-live da implantação.",
  cs_ativacao: "Critérios do gate de ativação do cliente pelo Customer Success.",
  gamificacao: "Pontos por evento, multiplicadores de equivalência entre funções e níveis da gamificação.",
  premios_vendas: "Prêmios por meta mensal batida em Vendas (adesão, recorrência, hardware) e valor do salário mínimo de referência.",
};

export const upsertSettingSchema = z.object({
  key: z.enum(SETTING_KEYS, { message: "Configuração desconhecida" }),
  value: z.unknown(),
});
export type UpsertSettingInput = { key: SettingKey; value: unknown };

// ---------------------------------------------------------------------------
// Regras de SLA
// ---------------------------------------------------------------------------

export const SLA_APPLIES_TO = ["tarefa", "workflow", "chamado", "implantacao", "cs", "oportunidade"] as const;

export const slaRuleSchema = z
  .object({
    id: idSchema.optional(),
    key: z
      .string()
      .trim()
      .toLowerCase()
      .min(2, "Informe a chave da regra")
      .max(60, "Chave muito longa (máx. 60)")
      .regex(/^[a-z0-9][a-z0-9_.-]*$/, "Chave: letras minúsculas, números, ponto, hífen ou sublinhado (ex.: suporte.critico)"),
    name: z.string().trim().min(2, "Informe o nome da regra").max(120, "Nome muito longo (máx. 120)"),
    appliesTo: z.enum(SLA_APPLIES_TO, { message: "Informe a que a regra se aplica" }),
    department: z.enum(DEPARTMENT_KEYS, { message: "Departamento inválido" }).optional(),
    responseHours: z.number("Horas de resposta inválido").min(0, "Horas de resposta não pode ser negativo").max(8760, "Horas de resposta muito alto").optional(),
    resolutionHours: z.number("Horas de resolução inválido").positive("Horas de resolução deve ser maior que zero").max(8760, "Horas de resolução muito alto"),
    businessHoursOnly: z.boolean(),
    attentionPct: z.number("Percentual de atenção inválido").int("Percentual deve ser inteiro").min(1, "Atenção mínima é 1%").max(99, "Atenção máxima é 99%"),
    riskPct: z.number("Percentual de risco inválido").int("Percentual deve ser inteiro").min(1, "Risco mínimo é 1%").max(99, "Risco máximo é 99%"),
    active: z.boolean(),
  })
  .refine((v) => v.attentionPct < v.riskPct, { message: "O percentual de atenção deve ser menor que o de risco", path: ["riskPct"] })
  .refine((v) => v.responseHours === undefined || v.responseHours <= v.resolutionHours, { message: "A resposta não pode demorar mais que a resolução", path: ["responseHours"] });
export type SlaRuleInput = z.input<typeof slaRuleSchema>;

export const slaRuleIdSchema = z.object({ id: idSchema });
