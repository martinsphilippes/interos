/**
 * Suporte: enums, rótulos e validação (zod) das Server Actions e da avaliação pública de CSAT.
 * Sem dependências de servidor: também é importado por Client Components (rótulos e opções).
 */
import { z } from "zod";
import type { SupportTicket, TicketInteraction } from "@/domain/types";

// ---------------------------------------------------------------------------
// Enums e rótulos
// ---------------------------------------------------------------------------

export const TICKET_PRIORITIES = ["critico", "alto", "medio", "baixo"] as const satisfies readonly SupportTicket["priority"][];
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = { critico: "Crítico", alto: "Alto", medio: "Médio", baixo: "Baixo" };

/** Definição oficial de cada criticidade (matriz de SLA do suporte). */
export const TICKET_PRIORITY_DEFINITIONS: Record<TicketPriority, string> = {
  critico: "Sistema parado",
  alto: "Impacto direto na operação",
  medio: "Dificuldade operacional",
  baixo: "Dúvida ou ajuste simples",
};

export const TICKET_STATUSES = ["aberto", "em_atendimento", "aguardando_cliente", "resolvido", "fechado", "reaberto"] as const satisfies readonly SupportTicket["status"][];
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  aberto: "Aberto",
  em_atendimento: "Em atendimento",
  aguardando_cliente: "Aguardando cliente",
  resolvido: "Resolvido",
  fechado: "Fechado",
  reaberto: "Reaberto",
};

/** Chamados que ainda exigem ação do suporte. */
export const OPEN_TICKET_STATUSES: readonly TicketStatus[] = ["aberto", "em_atendimento", "aguardando_cliente", "reaberto"];

export const TICKET_CHANNELS = ["whatsapp", "telefone", "email", "portal", "interno"] as const satisfies readonly SupportTicket["channel"][];
export type TicketChannel = (typeof TICKET_CHANNELS)[number];
export const TICKET_CHANNEL_LABELS: Record<TicketChannel, string> = { whatsapp: "WhatsApp", telefone: "Telefone", email: "E-mail", portal: "Portal", interno: "Interno" };

/** Canais pelos quais o atendente responde (o telefone é registrado como ligação). */
export const REPLY_CHANNELS = ["whatsapp", "email", "portal"] as const;
export type ReplyChannel = (typeof REPLY_CHANNELS)[number];

export const TICKET_QUEUES = ["n1", "n2"] as const;
export type TicketQueue = (typeof TICKET_QUEUES)[number];
export const TICKET_QUEUE_LABELS: Record<TicketQueue, string> = { n1: "N1 · primeiro nível", n2: "N2 · especialista" };

/** Causas raiz aceitas ao resolver. As chaves antigas do seed continuam com rótulo (ver ROOT_CAUSE_LABELS). */
export const ROOT_CAUSES = ["configuracao", "treinamento", "bug", "infraestrutura", "terceiros", "duvida", "outro"] as const;
export type RootCause = (typeof ROOT_CAUSES)[number];
export const ROOT_CAUSE_LABELS: Record<string, string> = {
  configuracao: "Configuração",
  treinamento: "Treinamento",
  bug: "Bug",
  infraestrutura: "Infraestrutura",
  terceiros: "Terceiros",
  duvida: "Dúvida",
  outro: "Outro",
  // Valores históricos (dados demonstrativos).
  bug_software: "Bug",
  duvida_uso: "Dúvida",
  erro_operacional: "Erro operacional",
  hardware: "Hardware",
};

export const INTERACTION_KIND_LABELS: Record<TicketInteraction["kind"], string> = {
  mensagem: "Mensagem",
  nota_interna: "Nota interna",
  ligacao: "Ligação",
  whatsapp: "WhatsApp",
  email: "E-mail",
  status: "Status",
};

/** Categorias sugeridas no formulário (texto livre também é aceito). */
export const TICKET_CATEGORY_SUGGESTIONS = ["PDV", "Fiscal", "Financeiro", "Estoque", "TEF", "Hardware", "Desempenho", "Omnichannel", "Telefonia", "Ponto", "Cadastro", "Dúvida", "Outro"];

export function canOperateSupport(user: { isAdmin: boolean; isManager: boolean; role: string; departmentId: string }): boolean {
  return user.isAdmin || user.isManager || user.role === "suporte" || user.departmentId === "suporte" || user.role === "implantacao";
}

export function canEditArticles(user: { isAdmin: boolean; isManager: boolean; role: string; departmentId: string }): boolean {
  return user.isAdmin || user.isManager || user.role === "suporte" || user.departmentId === "suporte";
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

const id = z.string().trim().min(1, "Identificador obrigatório");
const optionalText = z
  .string()
  .trim()
  .max(4000)
  .optional()
  .transform((v) => (v ? v : undefined));

export const createTicketSchema = z.object({
  clientId: z.string().trim().min(1, "Selecione o cliente"),
  contactId: optionalText,
  productId: optionalText,
  subject: z.string().trim().min(3, "Informe o assunto (mínimo de 3 caracteres)").max(160, "Assunto muito longo"),
  description: z.string().trim().min(3, "Descreva o problema").max(4000, "Descrição muito longa"),
  channel: z.enum(TICKET_CHANNELS, { message: "Canal inválido" }),
  priority: z.enum(TICKET_PRIORITIES, { message: "Selecione a criticidade" }),
  queue: z.enum(TICKET_QUEUES, { message: "Selecione a fila" }),
  category: optionalText,
  assigneeId: optionalText,
});
export type CreateTicketData = z.infer<typeof createTicketSchema>;

export const ticketIdSchema = z.object({ ticketId: id });

export const assignSchema = z.object({ ticketId: id, assigneeId: z.string().trim().min(1, "Selecione o atendente") });

export const replySchema = z.object({
  ticketId: id,
  channel: z.enum(REPLY_CHANNELS, { message: "Canal inválido" }),
  body: z.string().trim().min(1, "Escreva a resposta").max(4000, "Resposta muito longa"),
});

export const noteSchema = z.object({ ticketId: id, body: z.string().trim().min(1, "Escreva a nota").max(4000, "Nota muito longa") });

export const callSchema = z.object({
  ticketId: id,
  direction: z.enum(["saida", "entrada"]).default("saida"),
  durationMinutes: z.coerce.number({ message: "Informe a duração" }).min(1, "Duração mínima de 1 minuto").max(600, "Duração acima de 10 horas"),
  summary: z.string().trim().min(3, "Resuma a ligação").max(4000, "Resumo muito longo"),
});

export const classifySchema = z.object({
  ticketId: id,
  productId: optionalText,
  category: optionalText,
  priority: z.enum(TICKET_PRIORITIES, { message: "Criticidade inválida" }),
  queue: z.enum(TICKET_QUEUES, { message: "Fila inválida" }),
});

export const waitingSchema = z.object({ ticketId: id, reason: z.string().trim().min(3, "Informe o motivo da pausa").max(500, "Motivo muito longo") });

export const resolveSchema = z.object({
  ticketId: id,
  solution: z.string().trim().min(10, "Descreva a solução (mínimo de 10 caracteres)").max(4000, "Solução muito longa"),
  rootCause: z.enum(ROOT_CAUSES, { message: "Selecione a causa raiz" }),
  trainingRelated: z.boolean().default(false),
  customerConfirmation: z.enum(["sim", "pendente"], { message: "Informe a confirmação do cliente" }),
});
export type ResolveData = z.infer<typeof resolveSchema>;

export const closeSchema = z.object({ ticketId: id, note: optionalText });

export const reopenSchema = z.object({ ticketId: id, reason: z.string().trim().min(5, "Informe o motivo da reabertura").max(2000, "Motivo muito longo") });

export const ticketOpportunitySchema = z.object({
  ticketId: id,
  productId: z.string().trim().min(1, "Selecione o produto"),
  need: z.string().trim().min(3, "Descreva a necessidade do cliente").max(2000, "Texto muito longo"),
  notes: optionalText,
});

export const attachmentSchema = z.object({
  ticketId: id,
  name: z.string().trim().min(2, "Informe o nome do anexo").max(160),
  url: z.string().trim().url("Informe uma URL válida (https://...)"),
});

export const transferSchema = z.object({
  ticketId: id,
  assigneeId: optionalText,
  queue: z.enum(TICKET_QUEUES, { message: "Selecione a fila" }),
  note: z.string().trim().min(3, "Explique o motivo da transferência").max(1000, "Nota muito longa"),
});

export const articleSchema = z.object({
  id: optionalText,
  title: z.string().trim().min(5, "Título muito curto").max(160, "Título muito longo"),
  productId: optionalText,
  module: z
    .string()
    .trim()
    .max(60, "Módulo muito longo")
    .optional()
    .transform((v) => (v ? v : undefined)),
  category: optionalText,
  problem: z
    .string()
    .trim()
    .max(1000, "Descrição do problema muito longa")
    .optional()
    .transform((v) => (v ? v : undefined)),
  keywords: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(30).default([]),
  body: z.string().trim().min(20, "O conteúdo precisa ter pelo menos 20 caracteres").max(20000, "Conteúdo muito longo"),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).default([]),
  published: z.boolean().default(true),
  sourceTicketId: optionalText,
});
export type ArticleData = z.infer<typeof articleSchema>;

export const articleVoteSchema = z.object({ articleId: id, helpful: z.boolean() });

export const csatSubmitSchema = z.object({
  token: z.string().trim().min(8, "Link de avaliação inválido"),
  score: z.coerce.number({ message: "Escolha uma nota" }).int("Nota inválida").min(0, "Nota mínima 0").max(10, "Nota máxima 10"),
  comment: z
    .string()
    .trim()
    .max(1000, "Comentário muito longo")
    .optional()
    .transform((v) => (v ? v : undefined)),
});

const FIELD_LABELS: Record<string, string> = {
  clientId: "Cliente",
  subject: "Assunto",
  description: "Descrição",
  channel: "Canal",
  priority: "Criticidade",
  queue: "Fila",
  body: "Texto",
  durationMinutes: "Duração",
  summary: "Resumo",
  reason: "Motivo",
  solution: "Solução",
  rootCause: "Causa raiz",
  productId: "Produto",
  need: "Necessidade",
  url: "URL",
  name: "Nome",
  title: "Título",
  score: "Nota",
  note: "Nota",
  problem: "Problema",
  module: "Módulo",
};

/** Primeira mensagem de erro do zod, com o nome do campo quando ajuda. */
export function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Dados inválidos";
  const label = FIELD_LABELS[issue.path.map(String).join(".")];
  return label && !issue.message.toLowerCase().includes(label.toLowerCase()) ? `${label}: ${issue.message}` : issue.message;
}
