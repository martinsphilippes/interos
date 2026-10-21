import "server-only";
/**
 * Mensagens automáticas da Central (setting `central_automaticas`). Tudo nasce DESLIGADO: nada sai sozinho até o
 * gestor ligar em Canais e filas › Mensagens automáticas.
 *
 * - Disparadas quando o cliente escreve: menu de boas-vindas (a resposta escolhe a fila) e fora do horário.
 * - Disparada ao encerrar: mensagem de encerramento.
 * - Disparadas pelo tempo (agendador, /api/cron/central): posição na fila e cliente que parou de responder.
 *
 * Regras de segurança: só sai pelo provedor de verdade (canal conectado; no WhatsApp, dentro da janela de 24 h — fora
 * dela a Meta recusaria); sem conexão, não sai nada (automação nunca vira «registro manual»). Cada tipo no máximo uma vez
 * a cada 12 h por conversa (o menu, até 2 vezes por conversa). Ficam na conversa com o autor «Central de Atendimento».
 */
import { list, nowIso, update, create } from "@/server/db";
import { getHolidays } from "@/server/sla";
import { sendOrRecord } from "@/server/integrations/communications";
import { isConnected } from "@/server/integrations/status";
import { COLLECTIONS, type AutoMessageKind, type Conversation, type Settings } from "@/domain/types";
import { whatsappWindow, type MenuOption } from "@/domain/conversations";
import { metaReplyWindow } from "@/domain/channels";

export { menuText, pickMenuOption, type MenuOption } from "@/domain/conversations";
import { DEFAULT_BUSINESS_HOURS, isBusinessOpen, nextOpeningLabel, type BusinessHours } from "@/domain/business-hours";
import { BusinessError } from "@/server/auth/error-classes";
import { replySubject } from "@/domain/email-inbound";

export const AUTO_MESSAGES_SETTING = "central_automaticas";
const REPEAT_MS = 12 * 3600_000;

export interface AutoMessagesConfig {
  menu: { ativa: boolean; texto: string; opcoes: MenuOption[] };
  foraDoHorario: { ativa: boolean; texto: string };
  encerramento: { ativa: boolean; texto: string };
  aguardandoFila: { ativa: boolean; minutos: number; texto: string };
  semResposta: { ativa: boolean; lembreteHoras: number; textoLembrete: string; encerrarHoras: number; textoEncerramento: string };
}

export const DEFAULT_AUTO_MESSAGES: AutoMessagesConfig = {
  menu: {
    ativa: false,
    texto: "Olá! Você está falando com a Intercert. Responda com o número:",
    opcoes: [
      { tecla: "1", rotulo: "Suporte", filaId: "fila_suporte_n1" },
      { tecla: "2", rotulo: "Financeiro e boletos", filaId: "fila_financeiro" },
      { tecla: "3", rotulo: "Comprar ou renovar", filaId: "fila_comercial" },
    ],
  },
  foraDoHorario: { ativa: false, texto: "Recebemos sua mensagem! Nosso horário é de segunda a sexta, das 8h às 18h. Respondemos a partir de {proximaAbertura}." },
  encerramento: { ativa: false, texto: "Atendimento encerrado. Obrigado pelo contato! Se precisar, é só mandar uma nova mensagem." },
  aguardandoFila: { ativa: false, minutos: 5, texto: "Já já alguém da equipe te atende. Você é o {posicao}º da fila." },
  semResposta: {
    ativa: false,
    lembreteHoras: 4,
    textoLembrete: "Oi! Ficou alguma dúvida? Estamos por aqui.",
    encerrarHoras: 24,
    textoEncerramento: "Como não tivemos retorno, encerramos este atendimento. Se precisar, é só mandar uma nova mensagem.",
  },
};

export async function getAutoMessages(): Promise<AutoMessagesConfig & { stored: boolean }> {
  const docs = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", AUTO_MESSAGES_SETTING]] });
  const v = (docs[0]?.value ?? {}) as Partial<AutoMessagesConfig>;
  const d = DEFAULT_AUTO_MESSAGES;
  return {
    menu: { ...d.menu, ...v.menu, opcoes: v.menu?.opcoes ?? d.menu.opcoes },
    foraDoHorario: { ...d.foraDoHorario, ...v.foraDoHorario },
    encerramento: { ...d.encerramento, ...v.encerramento },
    aguardandoFila: { ...d.aguardandoFila, ...v.aguardandoFila },
    semResposta: { ...d.semResposta, ...v.semResposta },
    stored: docs.length > 0,
  };
}

export async function saveAutoMessages(config: AutoMessagesConfig, actorId: string): Promise<void> {
  const keys = config.menu.opcoes.map((o) => o.tecla.trim());
  if (new Set(keys).size !== keys.length) throw new BusinessError("Cada opção do menu precisa de um número diferente");
  if (config.semResposta.encerrarHoras <= config.semResposta.lembreteHoras) throw new BusinessError("Encerrar por falta de resposta precisa vir depois do lembrete");
  const docs = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", AUTO_MESSAGES_SETTING]] });
  const value = config as unknown as Record<string, unknown>;
  void actorId;
  if (docs[0]) await update<Settings>(COLLECTIONS.settings, docs[0].id, { value });
  else await create<Settings>(COLLECTIONS.settings, { key: AUTO_MESSAGES_SETTING, value, description: "Mensagens automáticas da Central de Atendimento." });
}

async function businessHours(): Promise<{ hours: BusinessHours; holidays: Set<string> }> {
  const docs = await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", "horario_comercial"]] });
  const v = docs[0]?.value as Partial<BusinessHours> | undefined;
  const hours: BusinessHours = v && typeof v.inicio === "number" && typeof v.fim === "number" && Array.isArray(v.dias) ? { inicio: v.inicio, fim: v.fim, dias: v.dias } : DEFAULT_BUSINESS_HOURS;
  return { hours, holidays: await getHolidays() };
}

export async function businessStatus(at: Date = new Date()): Promise<{ open: boolean; nextOpening: string }> {
  const { hours, holidays } = await businessHours();
  return { open: isBusinessOpen(at, hours, holidays), nextOpening: nextOpeningLabel(at, hours, holidays) };
}

/** Dá para mandar automaticamente agora? (provedor conectado; no WhatsApp, janela aberta) */
export function canAutoSend(c: Pick<Conversation, "channel" | "lastInboundAt">, now: number = Date.now()): boolean {
  if (c.channel === "whatsapp") return isConnected("whatsapp") && whatsappWindow(c.lastInboundAt, now).open;
  if (c.channel === "email") return isConnected("email");
  // Instagram/Messenger: automática só nas primeiras 24 h (a etiqueta de atendimento humano não vale para robô).
  // A conexão (pela tela) é conferida no envio, que não grava nada se o canal não estiver conectado.
  if (c.channel === "instagram" || c.channel === "messenger") return !metaReplyWindow(c.lastInboundAt, now).humanAgentTag && metaReplyWindow(c.lastInboundAt, now).open;
  return true;
}

function recentlySent(c: Pick<Conversation, "autoSentAt">, kind: AutoMessageKind, now: number): boolean {
  const at = c.autoSentAt?.[kind];
  return Boolean(at && now - new Date(at).getTime() < REPEAT_MS);
}

const SYSTEM = { id: "sistema", name: "Central de Atendimento" };

/**
 * Envia uma mensagem automática na conversa. Não envia (e não registra) se o canal não está conectado, se a janela
 * de 24 h fechou ou se o mesmo tipo saiu há menos de 12 h. Devolve se saiu.
 */
export async function sendAutoMessage(c: Conversation, kind: AutoMessageKind, text: string, options: { allowRepeat?: boolean } = {}): Promise<boolean> {
  const now = Date.now();
  if (!text.trim() || !canAutoSend(c, now)) return false;
  if (!options.allowRepeat && recentlySent(c, kind, now)) return false;
  const sent = await sendOrRecord({
    channel: c.channel,
    to: c.address,
    subject: replySubject(c.subject),
    inReplyTo: c.channel === "email" ? c.lastInboundMessageId : undefined,
    text,
    clientId: c.clientId,
    contactId: c.contactId,
    entity: { type: "conversation", id: c.id },
    actor: SYSTEM,
    conversationId: c.id,
    templateKey: `automatica:${kind}`,
    whenNotConnected: "nao_enviada",
  });
  if (sent.delivery !== "enviada") return false;
  const at = nowIso();
  // Automática não conta como resposta humana: o cliente continua esperando alguém da equipe.
  await update<Conversation>(COLLECTIONS.conversations, c.id, { autoSentAt: { ...(c.autoSentAt ?? {}), [kind]: at }, lastMessageAt: at, lastMessagePreview: text.slice(0, 140) });
  c.autoSentAt = { ...(c.autoSentAt ?? {}), [kind]: at };
  return true;
}
