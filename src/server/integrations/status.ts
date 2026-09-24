/**
 * Registro de integrações externas do INTEROS: fonte única para saber se um provedor está REALMENTE
 * conectado. Todos os adaptadores (WhatsApp, VoIP, e-mail, assinatura, cobrança, mapas) e todas as telas
 * consultam `isConnected(key)` / `getIntegrationStatus()` antes de apresentar uma ação como automática.
 *
 * "Conectado" exige duas coisas: as variáveis de ambiente do provedor presentes no servidor E um adaptador
 * implementado aqui no código. Credencial sem adaptador aparece como "Verificar" e o fallback manual segue
 * em uso. Os valores das variáveis nunca saem deste módulo, só a presença.
 *
 * Código de servidor apenas (sem "server-only" para poder ser usado por módulos compartilhados como
 * src/server/sales/maps.ts). NÃO importe em Client Components: no navegador as variáveis não existem e tudo
 * apareceria como "não conectado". Passe `getIntegrationFlags()` por props.
 */
import {
  INTEGRATION_KEYS,
  type IntegrationEnvVar,
  type IntegrationFlags,
  type IntegrationKey,
  type IntegrationRequirement,
  type IntegrationState,
  type IntegrationStatus,
} from "./types";

export type { IntegrationFlags, IntegrationKey, IntegrationState, IntegrationStatus } from "./types";

const VERCEL_ENV = "Vercel → projeto INTEROS → Settings → Environment Variables (Production e Preview); em desenvolvimento, .env.local. Faça um novo deploy depois de salvar.";

interface CatalogEntry {
  key: IntegrationKey;
  name: string;
  enables: string;
  requirements: IntegrationRequirement[];
  /** Variáveis opcionais (webhooks, remetente, modelo...). */
  optional?: { name: string; description: string }[];
  descriptions: Record<string, string>;
  docsUrl: string;
  fallback: string;
  whereToConfigure?: string;
  /** Estado que não dá para detectar pelo servidor (ex.: SSO no console do Firebase). */
  undetectable?: string;
}

const CATALOG: CatalogEntry[] = [
  {
    key: "whatsapp",
    name: "WhatsApp Business (Meta Cloud API)",
    enables: "Envio de mensagens de cobrança, respostas da Caixa de Entrada e do Suporte direto pelo INTEROS; recebimento via webhook.",
    requirements: [{ label: "Meta Cloud API", vars: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"], implemented: true }],
    optional: [
      { name: "WHATSAPP_VERIFY_TOKEN", description: "Token do handshake GET do webhook /api/webhooks/whatsapp." },
      { name: "WHATSAPP_WEBHOOK_TOKEN", description: "Token exigido no header x-interos-token do POST do webhook." },
    ],
    descriptions: {
      WHATSAPP_ACCESS_TOKEN: "Token permanente do usuário do sistema no Meta Business (whatsapp_business_messaging).",
      WHATSAPP_PHONE_NUMBER_ID: "ID do número de telefone no WhatsApp Manager.",
    },
    docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started",
    fallback: "Link wa.me: abre o WhatsApp do usuário com o texto pronto e a conversa é registrada manualmente.",
  },
  {
    key: "voip",
    name: "Telefonia VoIP / PABX",
    enables: "Click-to-call, duração real e gravação das ligações anexadas ao cliente.",
    requirements: [{ label: "Provedor VoIP", vars: ["VOIP_PROVIDER_API_KEY"], implemented: false }],
    optional: [{ name: "VOIP_PROVIDER", description: "Nome do provedor (ex.: twilio, zenvia, pabx)." }],
    descriptions: { VOIP_PROVIDER_API_KEY: "Chave de API do provedor de telefonia." },
    docsUrl: "https://www.twilio.com/docs/voice",
    fallback: "Link tel: abre o discador do aparelho; o resultado da ligação é registrado manualmente (sem gravação).",
  },
  {
    key: "email",
    name: "E-mail transacional (Resend ou SMTP)",
    enables: "Envio de contratos, lembretes de assinatura e respostas por e-mail direto pelo INTEROS.",
    requirements: [
      { label: "Resend", vars: ["RESEND_API_KEY", "EMAIL_FROM"], implemented: true },
      { label: "SMTP", vars: ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"], implemented: false },
    ],
    optional: [{ name: "SMTP_PORT", description: "Porta SMTP (padrão 587)." }],
    descriptions: {
      RESEND_API_KEY: "Chave de API do Resend (domínio remetente verificado).",
      EMAIL_FROM: "Remetente, ex.: Intercert <financeiro@intercert.com.br>.",
      SMTP_HOST: "Servidor SMTP.",
      SMTP_USER: "Usuário SMTP.",
      SMTP_PASSWORD: "Senha SMTP.",
    },
    docsUrl: "https://resend.com/docs/api-reference/emails/send-email",
    fallback: "Link mailto: abre o e-mail do usuário com assunto e texto prontos; o envio é registrado manualmente.",
  },
  {
    key: "assinatura",
    name: "Assinatura digital (Clicksign / DocuSign)",
    enables: "Envelope de assinatura enviado pelo provedor, status dos signatários e evidências automáticas.",
    requirements: [{ label: "Provedor de assinatura", vars: ["SIGNATURE_PROVIDER_API_KEY"], implemented: false }],
    optional: [
      { name: "SIGNATURE_PROVIDER", description: "clicksign ou docusign." },
      { name: "SIGNATURE_WEBHOOK_TOKEN", description: "Token do webhook de status de assinatura." },
    ],
    descriptions: { SIGNATURE_PROVIDER_API_KEY: "Token de API do provedor de assinatura." },
    docsUrl: "https://developers.clicksign.com/",
    fallback: "Documento gerado no INTEROS (com hash SHA-256) e assinatura registrada manualmente com evidência.",
  },
  {
    key: "cobranca",
    name: "Cobrança (Asaas / Iugu)",
    enables: "Boletos/PIX emitidos pelo provedor e baixa automática de pagamentos via webhook /api/webhooks/cobranca.",
    requirements: [{ label: "Provedor de cobrança", vars: ["BILLING_PROVIDER_API_KEY", "BILLING_WEBHOOK_TOKEN"], implemented: false }],
    optional: [{ name: "BILLING_PROVIDER", description: "asaas ou iugu." }],
    descriptions: {
      BILLING_PROVIDER_API_KEY: "Chave de API do provedor de cobrança.",
      BILLING_WEBHOOK_TOKEN: "Token exigido no header x-interos-token do webhook /api/webhooks/cobranca.",
    },
    docsUrl: "https://docs.asaas.com/",
    fallback: "Cobranças controladas no INTEROS; boleto/PIX emitidos fora e pagamento registrado manualmente com comprovante.",
  },
  {
    key: "mapas",
    name: "Google Maps Platform",
    enables: "Geocodificação de endereços e distância/tempo de rota reais nas visitas.",
    requirements: [{ label: "Google Maps", vars: ["GOOGLE_MAPS_API_KEY"], implemented: true }],
    descriptions: { GOOGLE_MAPS_API_KEY: "Chave com Geocoding API e Distance Matrix API habilitadas (somente servidor)." },
    docsUrl: "https://developers.google.com/maps/documentation/geocoding/overview",
    fallback: "Mapa por iframe/link do Google Maps sem chave; distância estimada em linha reta pela cidade.",
  },
  {
    key: "sso",
    name: "Microsoft SSO (Entra ID via Firebase Authentication)",
    enables: "Login com a conta corporativa Microsoft.",
    requirements: [],
    descriptions: {},
    docsUrl: "https://firebase.google.com/docs/auth/web/microsoft-oauth",
    fallback: "Login por e-mail e senha do Firebase Authentication.",
    whereToConfigure: "Console do Firebase → Authentication → Sign-in method → Microsoft (Client ID e segredo do app no Entra ID).",
    undetectable: "O provedor é habilitado no console do Firebase; o servidor não consegue confirmar.",
  },
  {
    key: "ia",
    name: "IA (Anthropic Claude)",
    enables: "Sugestões dos agentes de automação e textos gerados por IA.",
    requirements: [{ label: "Anthropic", vars: ["ANTHROPIC_API_KEY"], implemented: true }],
    optional: [{ name: "INTEROS_AI_MODEL", description: "Modelo (padrão claude-sonnet-5)." }],
    descriptions: { ANTHROPIC_API_KEY: "Chave da API da Anthropic." },
    docsUrl: "https://docs.anthropic.com/en/api/messages",
    fallback: "Somente regras determinísticas (sem texto gerado por IA).",
  },
];

function hasEnv(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function evaluate(entry: CatalogEntry): IntegrationStatus {
  const complete = entry.requirements.filter((r) => r.vars.every(hasEnv));
  const configured = complete.length > 0;
  const implemented = complete.some((r) => r.implemented);
  let state: IntegrationState;
  let stateReason: string;
  if (entry.undetectable) {
    state = "verificar";
    stateReason = entry.undetectable;
  } else if (configured && implemented) {
    state = "conectado";
    stateReason = `Credenciais presentes (${complete.filter((r) => r.implemented).map((r) => r.label).join(", ")}).`;
  } else if (configured) {
    state = "verificar";
    stateReason = `Credenciais presentes (${complete.map((r) => r.label).join(", ")}), mas o adaptador deste provedor ainda não foi implementado: o fallback manual continua em uso.`;
  } else {
    state = "nao_conectado";
    stateReason = "Variáveis de ambiente ausentes.";
  }

  const seen = new Set<string>();
  const envVars: IntegrationEnvVar[] = [];
  for (const req of entry.requirements) {
    for (const name of req.vars) {
      if (seen.has(name)) continue;
      seen.add(name);
      envVars.push({ name, description: entry.descriptions[name] ?? "", required: true, present: hasEnv(name) });
    }
  }
  for (const opt of entry.optional ?? []) {
    if (seen.has(opt.name)) continue;
    seen.add(opt.name);
    envVars.push({ name: opt.name, description: opt.description, required: false, present: hasEnv(opt.name) });
  }

  return {
    key: entry.key,
    name: entry.name,
    category: entry.key,
    enables: entry.enables,
    configured,
    implemented: entry.requirements.some((r) => r.implemented),
    state,
    stateReason,
    requirements: entry.requirements,
    envVars,
    docsUrl: entry.docsUrl,
    fallback: entry.fallback,
    whereToConfigure: entry.whereToConfigure ?? VERCEL_ENV,
  };
}

/** Estado de todas as integrações (lido a cada chamada: variáveis de ambiente podem mudar entre deploys). */
export function getIntegrationStatus(): IntegrationStatus[] {
  return CATALOG.map(evaluate);
}

/** Estado de uma integração. */
export function getIntegration(key: IntegrationKey): IntegrationStatus {
  const entry = CATALOG.find((c) => c.key === key);
  if (!entry) throw new Error(`Integração desconhecida: ${key}`);
  return evaluate(entry);
}

/** true somente quando o INTEROS fala de fato com o provedor (credenciais + adaptador implementado). */
export function isConnected(key: IntegrationKey): boolean {
  return getIntegration(key).state === "conectado";
}

/** Snapshot leve (estado por chave) para passar a Client Components por props. */
export function getIntegrationFlags(): IntegrationFlags {
  const out = {} as IntegrationFlags;
  for (const s of getIntegrationStatus()) out[s.key] = s.state;
  for (const key of INTEGRATION_KEYS) out[key] ??= "nao_conectado";
  return out;
}
