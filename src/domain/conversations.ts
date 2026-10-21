/**
 * Regras puras da Central de Atendimento: rótulos, janela de 24 h do WhatsApp e escolha do operador na distribuição.
 * Sem servidor (usado pelo serviço, pela interface e pelos testes).
 */
import type { ConversationCloseReason, ConversationStatus, QueueStrategy } from "./types";

export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  nova: "Nova",
  na_fila: "Na fila",
  em_atendimento: "Em atendimento",
  aguardando_cliente: "Aguardando cliente",
  encerrada: "Encerrada",
};

export const CLOSE_REASON_LABELS: Record<ConversationCloseReason, string> = {
  resolvida: "Dúvida resolvida",
  virou_chamado: "Virou chamado",
  proposta_enviada: "Proposta enviada",
  sem_resposta: "Sem resposta do cliente",
  engano: "Engano / spam",
};

export const QUEUE_STRATEGY_LABELS: Record<QueueStrategy, string> = {
  menor_carga: "Menor carga entre disponíveis",
  rodizio: "Rodízio",
  responsavel_primeiro: "Responsável do cliente primeiro",
  manual: "Manual (gestor distribui)",
};

export function isOpenConversation(c: { status: ConversationStatus }): boolean {
  return c.status !== "encerrada";
}

// ---------------------------------------------------------------------------
// Janela de 24 h do WhatsApp
// ---------------------------------------------------------------------------

/** A Meta só aceita texto livre até 24 h depois da última mensagem do cliente; fora disso, só modelo aprovado. */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface WindowState {
  open: boolean;
  /** Quando a janela fecha (ou fechou); ausente se o cliente nunca escreveu. */
  closesAt?: string;
}

export function whatsappWindow(lastInboundAt: string | undefined, now: number = Date.now()): WindowState {
  if (!lastInboundAt) return { open: false };
  const closes = new Date(lastInboundAt).getTime() + WHATSAPP_WINDOW_MS;
  if (!Number.isFinite(closes)) return { open: false };
  return { open: now < closes, closesAt: new Date(closes).toISOString() };
}

// ---------------------------------------------------------------------------
// Distribuição
// ---------------------------------------------------------------------------

export interface QueueCandidate {
  id: string;
  /** Online, ativo e membro da fila. */
  available: boolean;
  /** Conversas abertas com ele agora. */
  load: number;
  /** Limite próprio (ficha do usuário); ausente = o da fila. */
  limit?: number;
}

export interface PickAssigneeInput {
  strategy: QueueStrategy;
  candidates: readonly QueueCandidate[];
  maxConcurrent: number;
  /** Responsável natural (dono do lead, do chamado aberto ou da conversa anterior). */
  preferredId?: string;
  /** Último escolhido pelo rodízio. */
  lastAssignedId?: string;
}

/**
 * Escolhe o operador da conversa, ou undefined (fica na fila). Só entra quem está disponível e abaixo do limite (o
 * próprio, quando a ficha do usuário define; senão, o da fila).
 * - manual: ninguém (o gestor distribui);
 * - responsavel_primeiro: o responsável natural, se puder; senão, menor carga;
 * - menor_carga: menor carga, empate pela ordem da fila;
 * - rodizio: o próximo depois do último escolhido.
 * Em qualquer estratégia automática, o responsável natural disponível tem preferência.
 */
export function pickAssignee(input: PickAssigneeInput): string | undefined {
  if (input.strategy === "manual") return undefined;
  const able = input.candidates.filter((c) => c.available && c.load < Math.max(1, c.limit ?? input.maxConcurrent));
  if (able.length === 0) return undefined;
  if (input.preferredId) {
    const preferred = able.find((c) => c.id === input.preferredId);
    if (preferred) return preferred.id;
  }
  if (input.strategy === "rodizio") {
    const order = input.candidates.map((c) => c.id);
    const start = input.lastAssignedId ? order.indexOf(input.lastAssignedId) : -1;
    for (let step = 1; step <= order.length; step++) {
      const id = order[(start + step + order.length) % order.length];
      if (able.some((c) => c.id === id)) return id;
    }
    return undefined;
  }
  let best = able[0];
  for (const c of able) if (c.load < best.load) best = c;
  return best.id;
}

// ---------------------------------------------------------------------------
// Menu de boas-vindas (mensagem automática): a resposta do cliente escolhe a fila.
// ---------------------------------------------------------------------------

export interface MenuOption {
  tecla: string;
  rotulo: string;
  filaId: string;
}

/** Texto do menu com as opções numeradas. */
export function menuText(config: { texto: string; opcoes: readonly MenuOption[] }): string {
  return [config.texto.trim(), ...config.opcoes.map((o) => `${o.tecla} · ${o.rotulo}`)].join("\n");
}

/**
 * Opção escolhida pela resposta do cliente ("2", "2.", "opção 2", "2 - financeiro", ou o nome exato da opção). O número
 * precisa abrir a mensagem: «tenho 3 boletos» é texto livre, não a opção 3.
 */
export function pickMenuOption(body: string, options: readonly MenuOption[]): MenuOption | undefined {
  const t = body.trim().toLowerCase();
  const digit = t.match(/^(?:op[cç][aã]o\s*|n[º°o]?\s*|#\s*)?(\d{1,2})(?!\d)/)?.[1];
  if (digit) return options.find((o) => o.tecla.trim() === digit);
  return options.find((o) => o.rotulo.trim().toLowerCase() === t);
}
