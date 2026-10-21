/**
 * Chat do site (fase 5): configuração, sites permitidos e textos. Puro: sem servidor (a tela de configuração e o
 * servidor usam as mesmas regras).
 */

export interface SiteChatConfig {
  enabled: boolean;
  /** Identifica o chat no código do site (público; não é segredo). Gerado ao salvar pela primeira vez. */
  publicKey: string;
  title: string;
  greeting: string;
  /** Cor principal (hex #rrggbb). */
  color: string;
  position: "direita" | "esquerda";
  askEmail: boolean;
  askPhone: boolean;
  /** Exige e-mail ou telefone antes de começar (para retornar se a pessoa sair). */
  requireContact: boolean;
  /** Sites onde o chat pode aparecer (domínio, ex.: intercert.com.br — vale também para os subdomínios). Vazio = qualquer site. */
  allowedDomains: string[];
  /** Mostrada fora do horário de atendimento (o visitante ainda pode deixar a mensagem). */
  offlineMessage: string;
  /** Aviso de privacidade mostrado no formulário (LGPD). */
  privacyNotice: string;
}

export const DEFAULT_SITE_CHAT: SiteChatConfig = {
  enabled: false,
  publicKey: "",
  title: "Fale com a Intercert",
  greeting: "Olá! Como podemos ajudar?",
  color: "#f97316",
  position: "direita",
  askEmail: true,
  askPhone: true,
  requireContact: true,
  allowedDomains: [],
  offlineMessage: "Estamos fora do horário de atendimento. Deixe sua mensagem que respondemos assim que possível.",
  privacyNotice: "Usamos seus dados só para responder a este atendimento.",
};

/** Limites de uso (contra abuso): novas conversas por IP por hora e mensagens por visitante por minuto. */
export const SITE_CHAT_LIMITS = { visitorsPerIpPerHour: 5, messagesPerMinute: 15, messageMaxLength: 2000, nameMaxLength: 80 };

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

/** «https://www.Intercert.com.br/contato» → «intercert.com.br»; inválido → "". */
export function normalizeDomain(value: string): string {
  const raw = value.trim().toLowerCase();
  if (!raw) return "";
  let host = raw;
  try {
    host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch {
    return "";
  }
  host = host.replace(/^www\./, "");
  return /^(localhost|[a-z0-9-]+(\.[a-z0-9-]+)+)$/.test(host) ? host : "";
}

/** A página (origem ou URL) está num dos sites permitidos (o próprio domínio ou subdomínio)? Lista vazia = qualquer. */
export function domainAllowed(pageUrl: string | null | undefined, allowed: readonly string[]): boolean {
  if (!allowed.length) return true;
  const host = normalizeDomain(pageUrl ?? "");
  if (!host) return false;
  return allowed.some((d) => host === d || host.endsWith(`.${d}`));
}

/** CSP frame-ancestors: quem pode colocar o chat em iframe. */
export function frameAncestors(allowed: readonly string[], self: string): string {
  if (!allowed.length) return "*";
  return ["'self'", ...allowed.flatMap((d) => (d === "localhost" ? ["http://localhost:*"] : [`https://${d}`, `https://*.${d}`])), self].join(" ");
}
