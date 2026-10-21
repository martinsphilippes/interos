/**
 * Variáveis de mensagem do INTEROS — uma lista só para os modelos do WhatsApp ({{1}}… ligados a uma variável), as
 * respostas rápidas ({contato}, {operador}…) e a régua de cobrança (mesmos nomes de {chave} que ela já usa).
 * Puro: sem servidor.
 */
import type { TemplateContext } from "./types";

export interface MessageVariable {
  label: string;
  /** Onde existe valor para ela. */
  contexts: readonly TemplateContext[];
  /** Exemplo exibido na prévia e enviado à Meta como amostra. */
  example: string;
}

export const MESSAGE_VARIABLES = {
  contato: { label: "Primeiro nome do contato", contexts: ["conversa", "cobranca"], example: "Joana" },
  cliente: { label: "Nome do cliente (empresa)", contexts: ["conversa", "cobranca"], example: "Mercado Bom Preço" },
  operador: { label: "Nome de quem envia", contexts: ["conversa"], example: "Karem" },
  atendimento: { label: "Número do atendimento", contexts: ["conversa"], example: "AT-2026-0018" },
  parcela: { label: "Parcela", contexts: ["cobranca"], example: "parcela 10/12" },
  valor: { label: "Valor", contexts: ["cobranca"], example: "R$ 1.290,00" },
  vencimento: { label: "Vencimento", contexts: ["cobranca"], example: "25/10/2026" },
  linhaDigitavel: { label: "Linha digitável do boleto", contexts: ["cobranca"], example: "34191.79001 01043.510047 91020.150008 8 99990000012900" },
  linkBoleto: { label: "Link do boleto ou de pagamento", contexts: ["cobranca"], example: "https://boleto.exemplo/abc" },
} as const satisfies Record<string, MessageVariable>;

export type MessageVariableKey = keyof typeof MESSAGE_VARIABLES;

export function isMessageVariable(key: string): key is MessageVariableKey {
  return Object.prototype.hasOwnProperty.call(MESSAGE_VARIABLES, key);
}

/** Variáveis disponíveis num contexto. */
export function variablesFor(context: TemplateContext): MessageVariableKey[] {
  return (Object.keys(MESSAGE_VARIABLES) as MessageVariableKey[]).filter((k) => (MESSAGE_VARIABLES[k].contexts as readonly string[]).includes(context));
}

/** Quantos {{n}} o corpo do modelo usa (o maior n). */
export function placeholderCount(body: string): number {
  let max = 0;
  for (const m of body.matchAll(/\{\{(\d+)\}\}/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/** Os {{n}} são 1..N sem buracos? (exigência da Meta) */
export function placeholdersValid(body: string): boolean {
  const used = new Set(Array.from(body.matchAll(/\{\{(\d+)\}\}/g), (m) => Number(m[1])));
  const n = placeholderCount(body);
  for (let i = 1; i <= n; i++) if (!used.has(i)) return false;
  return true;
}

/** Corpo do modelo com os valores (prévia e registro da mensagem enviada). */
export function fillTemplate(body: string, params: readonly string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_m, n: string) => params[Number(n) - 1] ?? "");
}

/** Parâmetros do modelo (na ordem dos {{n}}) a partir dos valores do contexto; faltando valor, a variável sai na lista. */
export function templateParams(variables: readonly string[], values: Partial<Record<string, string>>): { params: string[]; missing: string[] } {
  const missing: string[] = [];
  const params = variables.map((key) => {
    const v = values[key]?.trim();
    if (!v) missing.push(key);
    return v ?? "";
  });
  return { params, missing };
}

/**
 * Texto com {chave} preenchido (respostas rápidas). Chave sem valor fica de fora da saída e entra em `missing` — a tela
 * bloqueia o envio em vez de mandar «{contato}» ao cliente.
 */
export function fillPlaceholders(text: string, values: Partial<Record<string, string>>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (!isMessageVariable(key)) return match;
    const v = values[key]?.trim();
    if (!v) {
      missing.push(key);
      return match;
    }
    return v;
  });
  return { text: out, missing: Array.from(new Set(missing)) };
}

/** Nome técnico de modelo aceito pela Meta: minúsculas, números e _. */
export function templateNameOf(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}
