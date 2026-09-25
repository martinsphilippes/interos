import { z } from "zod";
import type { BadgeProps } from "@/components/ui/badge";
import type { ChurnRecord, HealthScore, Renewal, SuccessPlan } from "@/domain/types";
import type { HealthLevel } from "@/domain/constants";

/**
 * Esquemas (zod), rótulos e funções puras do módulo de Customer Success. Sem dependência de servidor:
 * pode ser importado por Client Components. Mensagens em português (exibidas direto na interface).
 */

type Variant = NonNullable<BadgeProps["variant"]>;

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

export const HEALTH_LEVEL_LABELS: Record<HealthLevel, string> = { saudavel: "Saudável", atencao: "Atenção", risco: "Risco" };
export const HEALTH_LEVEL_VARIANT: Record<HealthLevel, Variant> = { saudavel: "success", atencao: "warning", risco: "danger" };
export const HEALTH_LEVEL_RANK: Record<HealthLevel, number> = { saudavel: 0, atencao: 1, risco: 2 };

/** Fatores do health score, na ordem de exibição. A chave casa com `settings.health_score.pesos`. */
export const HEALTH_FACTORS = [
  { key: "uso", label: "Utilização / adoção" },
  { key: "satisfacao", label: "Satisfação (CSAT)" },
  { key: "sla", label: "SLA dos chamados" },
  { key: "suporte", label: "Volume de chamados" },
  { key: "reincidencia", label: "Reincidência" },
  { key: "financeiro", label: "Financeiro" },
  { key: "relacionamento", label: "Relacionamento" },
] as const;
export type HealthFactorKey = (typeof HEALTH_FACTORS)[number]["key"];

export const CHECKPOINT_TYPES = ["ligacao", "reuniao", "visita", "whatsapp"] as const;
export type CheckpointType = (typeof CHECKPOINT_TYPES)[number];
export const CHECKPOINT_TYPE_LABELS: Record<CheckpointType, string> = { ligacao: "Ligação", reuniao: "Reunião", visita: "Visita", whatsapp: "WhatsApp" };

export const SUCCESS_PLAN_STATUS_LABELS: Record<SuccessPlan["status"], string> = { ativo: "Ativo", concluido: "Concluído", cancelado: "Cancelado" };
export const SUCCESS_PLAN_STATUS_VARIANT: Record<SuccessPlan["status"], Variant> = { ativo: "info", concluido: "success", cancelado: "muted" };
export const SUCCESS_PLAN_ORIGIN_LABELS: Record<SuccessPlan["origin"], string> = { manual: "Manual", automacao: "Automação" };

export const RENEWAL_STATUS_LABELS: Record<Renewal["status"], string> = { aguardando: "Aguardando", em_negociacao: "Em negociação", renovado: "Renovado", perdido: "Perdido" };
export const RENEWAL_STATUS_VARIANT: Record<Renewal["status"], Variant> = { aguardando: "muted", em_negociacao: "warning", renovado: "success", perdido: "danger" };

export const CHURN_REASON_LABELS: Record<ChurnRecord["reasonCategory"], string> = {
  preco: "Preço",
  concorrente: "Concorrente",
  uso: "Falta de uso",
  tecnico: "Problema técnico",
  financeiro: "Financeiro / inadimplência",
  fechamento: "Fechamento da empresa",
  outro: "Outro",
};
export const CHURN_REASON_KEYS = Object.keys(CHURN_REASON_LABELS) as ChurnRecord["reasonCategory"][];

// ---------------------------------------------------------------------------
// Funções puras
// ---------------------------------------------------------------------------

export function levelForScore(score: number, limiares: { saudavel: number; atencao: number }): HealthLevel {
  if (score >= limiares.saudavel) return "saudavel";
  if (score >= limiares.atencao) return "atencao";
  return "risco";
}

/** Nível de um fator isolado (0–100) para cor das barras: mesmos cortes usados nos motivos de risco. */
export function factorLevel(value: number): HealthLevel {
  return value >= 75 ? "saudavel" : value >= 50 ? "atencao" : "risco";
}

/** Pontos que o fator tira do score (peso × distância até 100). */
export function factorLoss(f: Pick<HealthScore["factors"][number], "weight" | "value">): number {
  return (f.weight * (100 - f.value)) / 100;
}

/**
 * Explicação textual do score ("por que este cliente está em risco"): os fatores que mais tiram pontos,
 * com a nota de cada um. Usada no drill-down da tela de Saúde e na ficha do cliente.
 */
export function explainHealth(health: Pick<HealthScore, "score" | "level" | "factors">): string[] {
  const weak = [...health.factors].filter((f) => f.value < 75 && f.weight > 0).sort((a, b) => factorLoss(b) - factorLoss(a));
  const lines: string[] = [];
  if (weak.length === 0) {
    lines.push(`Score ${health.score}: todos os fatores estão em nível saudável.`);
    return lines;
  }
  const lost = weak.reduce((s, f) => s + factorLoss(f), 0);
  lines.push(
    `Score ${health.score} (${HEALTH_LEVEL_LABELS[health.level].toLowerCase()}): ${weak.length === 1 ? "um fator" : `${weak.length} fatores`} abaixo do saudável tiram ${lost.toFixed(1)} ponto(s).`,
  );
  for (const f of weak.slice(0, 4)) {
    lines.push(`${f.label} em ${Math.round(f.value)}/100 (peso ${f.weight}%, −${factorLoss(f).toFixed(1)} pts)${f.note ? `: ${f.note}` : "."}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

const id = (label: string) => z.string(`${label} inválido`).trim().min(1, `${label} obrigatório`);
const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .optional()
    .transform((v) => (v ? v : undefined));
const isoDate = (label: string) => z.string(`${label} inválida`).refine((v) => !Number.isNaN(new Date(v).getTime()), `${label} inválida`);

export function zodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Dados inválidos";
}

export const clientIdSchema = z.object({ clientId: id("Cliente") });

export const checkpointSchema = z.object({
  clientId: id("Cliente"),
  type: z.enum(CHECKPOINT_TYPES, { message: "Tipo de checkpoint inválido" }),
  summary: z.string("Resumo obrigatório").trim().min(5, "Descreva o checkpoint (mínimo 5 caracteres)").max(4000, "Resumo muito longo"),
  satisfaction: z.number("Satisfação inválida").min(0, "Satisfação mínima é 0").max(10, "Satisfação máxima é 10"),
  adoptionPct: z.number("Adoção inválida").int("Adoção deve ser inteira").min(0, "Adoção mínima é 0%").max(100, "Adoção máxima é 100%"),
  risks: z.array(z.string().trim().min(1).max(200, "Risco muito longo")).max(10, "No máximo 10 riscos").default([]),
  nextSteps: z.array(z.string().trim().min(1).max(200, "Próximo passo muito longo")).max(10, "No máximo 10 próximos passos").default([]),
  createTasks: z.boolean().default(false),
  nextInDays: z.number("Prazo inválido").int("Informe dias inteiros").min(1, "Próxima interação em pelo menos 1 dia").max(365, "Máximo de 365 dias"),
});
export type CheckpointInput = z.input<typeof checkpointSchema>;

const planActionSchema = z.object({
  id: z.string().trim().optional(),
  description: z.string("Descrição obrigatória").trim().min(3, "Descreva a ação (mínimo 3 caracteres)").max(300, "Ação muito longa"),
  responsibleId: id("Responsável da ação"),
  dueAt: isoDate("Prazo da ação"),
});

export const successPlanSchema = z.object({
  id: z.string().trim().optional(),
  clientId: id("Cliente"),
  ownerId: id("Responsável"),
  objective: z.string("Objetivo obrigatório").trim().min(5, "Descreva o objetivo (mínimo 5 caracteres)").max(500, "Objetivo muito longo"),
  checkpointAt: isoDate("Data do checkpoint").optional(),
  actions: z.array(planActionSchema).min(1, "Inclua pelo menos uma ação").max(20, "No máximo 20 ações"),
});
export type SuccessPlanInput = z.input<typeof successPlanSchema>;

export const planActionToggleSchema = z.object({ planId: id("Plano"), actionId: id("Ação"), done: z.boolean() });

export const closePlanSchema = z.object({
  planId: id("Plano"),
  status: z.enum(["concluido", "cancelado"], { message: "Status inválido" }),
  result: z.string("Resultado obrigatório").trim().min(3, "Descreva o resultado (mínimo 3 caracteres)").max(2000, "Resultado muito longo"),
});

export const renewalIdSchema = z.object({ renewalId: id("Renovação") });

export const renewSchema = z.object({
  renewalId: id("Renovação"),
  termMonths: z.number("Prazo inválido").int("Prazo em meses inteiros").min(1, "Mínimo de 1 mês").max(60, "Máximo de 60 meses"),
  notes: optionalText(1000),
});

export const loseRenewalSchema = z.object({
  renewalId: id("Renovação"),
  reason: z.string("Motivo obrigatório").trim().min(5, "Descreva o motivo (mínimo 5 caracteres)").max(1000, "Motivo muito longo"),
});

export const createRenewalSchema = z.object({ contractId: id("Contrato") });

export const churnSchema = z.object({
  clientId: id("Cliente"),
  clientProductIds: z.array(z.string().trim().min(1)).min(1, "Selecione pelo menos um produto cancelado"),
  reasonCategory: z.enum(CHURN_REASON_KEYS as [ChurnRecord["reasonCategory"], ...ChurnRecord["reasonCategory"][]], { message: "Categoria de motivo inválida" }),
  reason: z.string("Motivo obrigatório").trim().min(5, "Descreva o motivo (mínimo 5 caracteres)").max(1000, "Motivo muito longo"),
  responsibleId: id("Responsável"),
  date: isoDate("Data do cancelamento"),
  context: optionalText(2000),
});
export type ChurnInput = z.input<typeof churnSchema>;

export const upsellSchema = z.object({
  clientId: id("Cliente"),
  productId: id("Produto"),
  need: optionalText(500),
});

export const escalateSchema = z.object({
  clientId: id("Cliente"),
  note: z.string("Descreva o motivo").trim().min(5, "Descreva o motivo da escalação (mínimo 5 caracteres)").max(1000, "Texto muito longo"),
});
