import type { BadgeProps } from "@/components/ui/badge";
import type {
  Billing,
  ClientProduct,
  Contract,
  ImplementationPhase,
  ImplementationStatus,
  Opportunity,
  Proposal,
  Renewal,
  SuccessPlan,
  SupportTicket,
  Training,
} from "@/domain/types";

/**
 * Rótulos em português dos status das entidades exibidas na Ficha 360º. Estes tipos são
 * uniões literais em `src/domain/types.ts` (não têm mapa de rótulo em constants.ts).
 */

type Variant = NonNullable<BadgeProps["variant"]>;

export const OPPORTUNITY_STAGE_LABELS: Record<Opportunity["stage"], string> = {
  qualificacao: "Qualificação",
  diagnostico: "Diagnóstico",
  proposta: "Proposta",
  negociacao: "Negociação",
  fechamento: "Fechamento",
  ganho: "Ganho",
  perdido: "Perdido",
};
export const OPPORTUNITY_STAGE_VARIANT: Record<Opportunity["stage"], Variant> = {
  qualificacao: "muted",
  diagnostico: "info",
  proposta: "info",
  negociacao: "warning",
  fechamento: "warning",
  ganho: "success",
  perdido: "danger",
};
export const OPPORTUNITY_KIND_LABELS: Record<Opportunity["kind"], string> = {
  nova_venda: "Nova venda",
  upsell: "Upsell",
  cross_sell: "Cross-sell",
  renovacao: "Renovação",
};
export const TEMPERATURE_LABELS: Record<Opportunity["temperature"], string> = { quente: "Quente", morno: "Morno", frio: "Frio" };

export const PROPOSAL_STATUS_LABELS: Record<Proposal["status"], string> = {
  rascunho: "Rascunho",
  enviada: "Enviada",
  visualizada: "Visualizada",
  negociacao: "Em negociação",
  aceita: "Aceita",
  recusada: "Recusada",
  vencida: "Vencida",
};
export const PROPOSAL_STATUS_VARIANT: Record<Proposal["status"], Variant> = {
  rascunho: "muted",
  enviada: "info",
  visualizada: "info",
  negociacao: "warning",
  aceita: "success",
  recusada: "danger",
  vencida: "muted",
};

export const CONTRACT_STATUS_LABELS: Record<Contract["status"], string> = {
  aguardando_contrato: "Aguardando contrato",
  aguardando_assinatura: "Aguardando assinatura",
  assinado: "Assinado",
  aguardando_pagamento: "Aguardando pagamento",
  pago: "Pago",
  pendencia: "Pendência",
  liberado: "Liberado",
  cancelado: "Cancelado",
};
export const CONTRACT_STATUS_VARIANT: Record<Contract["status"], Variant> = {
  aguardando_contrato: "muted",
  aguardando_assinatura: "info",
  assinado: "info",
  aguardando_pagamento: "warning",
  pago: "success",
  pendencia: "danger",
  liberado: "success",
  cancelado: "danger",
};

export const BILLING_STATUS_LABELS: Record<Billing["status"], string> = { aberta: "Em aberto", paga: "Paga", vencida: "Vencida", cancelada: "Cancelada" };
export const BILLING_STATUS_VARIANT: Record<Billing["status"], Variant> = { aberta: "info", paga: "success", vencida: "danger", cancelada: "muted" };
export const BILLING_TYPE_LABELS: Record<Billing["type"], string> = { setup: "Adesão", mensalidade: "Mensalidade", hardware: "Hardware", servico: "Serviço" };

export const CLIENT_PRODUCT_STATUS_LABELS: Record<ClientProduct["status"], string> = {
  ativo: "Ativo",
  em_implantacao: "Em implantação",
  suspenso: "Suspenso",
  cancelado: "Cancelado",
};
export const CLIENT_PRODUCT_STATUS_VARIANT: Record<ClientProduct["status"], Variant> = { ativo: "success", em_implantacao: "warning", suspenso: "muted", cancelado: "danger" };

export const IMPLEMENTATION_STATUS_LABELS: Record<ImplementationStatus, string> = {
  aguardando_inicio: "Aguardando início",
  em_implantacao: "Em implantação",
  aguardando_cliente: "Aguardando cliente",
  bloqueada: "Bloqueada",
  pronta_para_go_live: "Pronta para go-live",
  concluida: "Concluída",
  cancelada: "Cancelada",
};
export const IMPLEMENTATION_STATUS_VARIANT: Record<ImplementationStatus, Variant> = {
  aguardando_inicio: "muted",
  em_implantacao: "info",
  aguardando_cliente: "warning",
  bloqueada: "danger",
  pronta_para_go_live: "success",
  concluida: "success",
  cancelada: "danger",
};
export const IMPLEMENTATION_PHASE_LABELS: Record<ImplementationPhase, string> = {
  kickoff: "Kickoff",
  validacao_escopo: "Validação de escopo",
  configuracao: "Configuração",
  migracao: "Migração de dados",
  integracao: "Integração",
  treinamento: "Treinamento",
  validacao: "Validação",
  go_live: "Go-live",
};

export const TRAINING_STATUS_LABELS: Record<Training["status"], string> = { agendado: "Agendado", realizado: "Realizado", cancelado: "Cancelado" };
export const TRAINING_STATUS_VARIANT: Record<Training["status"], Variant> = { agendado: "info", realizado: "success", cancelado: "muted" };

export const SUCCESS_PLAN_STATUS_LABELS: Record<SuccessPlan["status"], string> = { ativo: "Ativo", concluido: "Concluído", cancelado: "Cancelado" };
export const RENEWAL_STATUS_LABELS: Record<Renewal["status"], string> = { aguardando: "Aguardando", em_negociacao: "Em negociação", renovado: "Renovado", perdido: "Perdido" };
export const RENEWAL_STATUS_VARIANT: Record<Renewal["status"], Variant> = { aguardando: "muted", em_negociacao: "warning", renovado: "success", perdido: "danger" };

export const TICKET_PRIORITY_LABELS: Record<SupportTicket["priority"], string> = { critico: "Crítico", alto: "Alto", medio: "Médio", baixo: "Baixo" };
export const TICKET_PRIORITY_VARIANT: Record<SupportTicket["priority"], Variant> = { critico: "danger", alto: "warning", medio: "info", baixo: "muted" };
export const TICKET_STATUS_LABELS: Record<SupportTicket["status"], string> = {
  aberto: "Aberto",
  em_atendimento: "Em atendimento",
  aguardando_cliente: "Aguardando cliente",
  resolvido: "Resolvido",
  fechado: "Fechado",
  reaberto: "Reaberto",
};
export const TICKET_STATUS_VARIANT: Record<SupportTicket["status"], Variant> = {
  aberto: "info",
  em_atendimento: "info",
  aguardando_cliente: "warning",
  resolvido: "success",
  fechado: "muted",
  reaberto: "danger",
};

export const DOCUMENT_CATEGORIES = ["Contrato", "Proposta", "Documento fiscal", "Comprovante de pagamento", "Cadastro", "Treinamento", "Evidência", "Outro"] as const;
