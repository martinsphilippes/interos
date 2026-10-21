import { z } from "zod";
import { CONVERSATION_CHANNELS, CONVERSATION_CLOSE_REASONS, QUEUE_STRATEGIES, TEMPLATE_CATEGORIES, TEMPLATE_CONTEXTS } from "@/domain/types";
import { DEPARTMENT_KEYS } from "@/domain/constants";

const id = (label: string) => z.string(`${label} inválido`).trim().min(1, `${label} inválido`);
const optionalId = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : undefined));
const body = (label: string) => z.string(`Escreva a ${label}`).trim().min(1, `Escreva a ${label}`).max(4000, `${label[0].toUpperCase()}${label.slice(1)} muito longa`);

export const conversationIdSchema = z.object({ conversationId: id("Conversa") });

export const sendMessageSchema = z.object({ conversationId: id("Conversa"), body: body("mensagem"), manual: z.boolean().default(false), quickReplyId: optionalId });

export const noteSchema = z.object({ conversationId: id("Conversa"), body: body("nota") });

export const transferSchema = z
  .object({
    conversationId: id("Conversa"),
    toUserId: optionalId,
    toQueueId: optionalId,
    note: z.string("Escreva a nota para quem recebe").trim().min(3, "Escreva a nota para quem recebe (o cliente não vê)").max(1000, "Nota muito longa"),
  })
  .refine((v) => Boolean(v.toUserId) !== Boolean(v.toQueueId), { message: "Escolha uma pessoa ou uma fila", path: ["toUserId"] });

export const closeSchema = z
  .object({
    conversationId: id("Conversa"),
    reason: z.enum(CONVERSATION_CLOSE_REASONS, { message: "Escolha o motivo" }),
    summary: z
      .string()
      .trim()
      .max(2000, "Resumo muito longo")
      .nullish()
      .transform((v) => (v ? v : undefined)),
    ticket: z.enum(["nenhum", "vincular", "novo"]).default("nenhum"),
    ticketId: optionalId,
    /** Enviar a mensagem automática de encerramento (quando ligada). */
    sendClosingMessage: z.boolean().default(true),
  })
  .refine((v) => v.ticket !== "vincular" || Boolean(v.ticketId), { message: "Escolha o chamado", path: ["ticketId"] })
  .refine((v) => v.ticket !== "novo" || (v.summary?.length ?? 0) >= 3, { message: "Escreva o resumo: ele vira a descrição do chamado", path: ["summary"] });

export const linkIdentitySchema = z
  .object({
    conversationId: id("Conversa"),
    kind: z.enum(["contato", "cliente", "lead", "novo_lead", "nenhum"], { message: "Escolha uma opção" }),
    id: optionalId,
    name: z
      .string()
      .trim()
      .max(120, "Nome muito longo")
      .nullish()
      .transform((v) => (v ? v : undefined)),
    fixPhone: z.boolean().default(false),
  })
  .refine((v) => !["contato", "cliente", "lead"].includes(v.kind) || Boolean(v.id), { message: "Escolha o cadastro", path: ["id"] });

export const assignSchema = z.object({ conversationId: id("Conversa"), assigneeId: id("Operador") });

export const startSchema = z
  .object({
    channel: z.enum(CONVERSATION_CHANNELS, { message: "Escolha o canal" }),
    address: z.string("Informe o telefone ou e-mail").trim().min(5, "Informe o telefone ou e-mail").max(200, "Endereço muito longo"),
    clientId: optionalId,
    contactId: optionalId,
    leadId: optionalId,
    queueId: optionalId,
    body: z.string().trim().max(4000, "Mensagem muito longa").default(""),
    manual: z.boolean().default(false),
    templateId: optionalId,
  })
  .refine((v) => Boolean(v.templateId) || v.body.length > 0, { message: "Escreva a mensagem ou escolha um modelo", path: ["body"] })
  .refine((v) => !v.templateId || v.channel === "whatsapp", { message: "Modelos são do WhatsApp", path: ["templateId"] })
  .refine((v) => (v.channel === "email" ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.address) : v.address.replace(/\D/g, "").length >= 10), {
    message: "Telefone com DDD (WhatsApp) ou e-mail válido",
    path: ["address"],
  });

export const sendTemplateSchema = z.object({ conversationId: id("Conversa"), templateId: id("Modelo") });

export const syncTemplatesSchema = z.object({}).passthrough();

export const saveTemplateSchema = z.object({
  id: optionalId,
  name: z.string("Informe o nome").trim().min(3, "Nome do modelo: ao menos 3 letras").max(60, "Nome muito longo"),
  category: z.enum(TEMPLATE_CATEGORIES, { message: "Escolha a categoria" }),
  context: z.enum(TEMPLATE_CONTEXTS, { message: "Escolha onde o modelo é usado" }),
  body: z.string("Escreva o texto").trim().min(10, "Texto do modelo muito curto").max(1024, "A Meta aceita até 1.024 caracteres"),
  footer: z
    .string()
    .trim()
    .max(60, "Rodapé: até 60 caracteres")
    .nullish()
    .transform((v) => (v ? v : undefined)),
  variables: z.array(z.string().trim()).max(20),
});

export const searchTargetsSchema = z.object({ q: z.string().trim().min(2, "Digite ao menos 2 letras").max(80) });

export const saveQueueSchema = z
  .object({
    id: optionalId,
    name: z.string("Informe o nome").trim().min(2, "Informe o nome da fila").max(60, "Nome muito longo"),
    department: z.enum(DEPARTMENT_KEYS, { message: "Escolha o departamento" }),
    channels: z.array(z.enum(CONVERSATION_CHANNELS)).min(1, "Escolha ao menos um canal"),
    memberIds: z.array(z.string().trim().min(1)).max(100),
    strategy: z.enum(QUEUE_STRATEGIES, { message: "Escolha a distribuição" }),
    maxConcurrent: z.coerce.number("Informe o limite").int("Use um número inteiro").min(1, "Mínimo de 1 conversa").max(30, "Máximo de 30 conversas"),
    slaRuleKey: optionalId,
    overflowQueueId: optionalId,
    overflowAfterMinutes: z.coerce.number().int().min(1, "Mínimo de 1 minuto").max(480, "Máximo de 8 horas").optional(),
    isDefault: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .refine((v) => !v.overflowQueueId || v.overflowAfterMinutes !== undefined, { message: "Informe em quantos minutos transbordar", path: ["overflowAfterMinutes"] });

/** Resultado da busca de «Novo atendimento». */
export interface ConversationTarget {
  kind: "contato" | "cliente" | "lead";
  id: string;
  clientId?: string;
  name: string;
  company?: string;
  whatsapp?: string;
  email?: string;
}

export const saveQuickReplySchema = z.object({
  id: optionalId,
  shortcut: z.string("Informe o atalho").trim().min(2, "Atalho: ao menos 2 letras").max(40, "Atalho muito longo"),
  body: z.string("Escreva o texto").trim().min(2, "Escreva o texto").max(2000, "Texto muito longo"),
  queueId: optionalId,
  active: z.boolean().default(true),
});

const autoText = (label: string) => z.string(`Escreva ${label}`).trim().min(5, `Escreva ${label}`).max(1000, "Texto muito longo");

export const saveAutoMessagesSchema = z.object({
  menu: z.object({
    ativa: z.boolean(),
    texto: autoText("o texto do menu"),
    opcoes: z
      .array(
        z.object({
          tecla: z.string().trim().regex(/^\d{1,2}$/, "Use números nas opções do menu"),
          rotulo: z.string().trim().min(2, "Nome da opção muito curto").max(40, "Nome da opção muito longo"),
          filaId: z.string().trim().min(1, "Escolha a fila de cada opção"),
        }),
      )
      .max(9, "No máximo 9 opções"),
  }),
  foraDoHorario: z.object({ ativa: z.boolean(), texto: autoText("a mensagem de fora do horário") }),
  encerramento: z.object({ ativa: z.boolean(), texto: autoText("a mensagem de encerramento") }),
  aguardandoFila: z.object({ ativa: z.boolean(), minutos: z.coerce.number().int().min(1, "Mínimo de 1 minuto").max(120, "Máximo de 2 horas"), texto: autoText("o aviso de posição") }),
  semResposta: z.object({
    ativa: z.boolean(),
    lembreteHoras: z.coerce.number().int().min(1, "Mínimo de 1 hora").max(72, "Máximo de 72 horas"),
    textoLembrete: autoText("o lembrete"),
    encerrarHoras: z.coerce.number().int().min(2, "Mínimo de 2 horas").max(168, "Máximo de 7 dias"),
    textoEncerramento: autoText("a mensagem de encerramento automático"),
  }),
});
