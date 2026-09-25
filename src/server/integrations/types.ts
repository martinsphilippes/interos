/**
 * Tipos do registro de integrações externas. Módulo puro (sem acesso a variáveis de ambiente): pode ser
 * importado por Client Components para tipar o snapshot que as páginas passam por props.
 */
import type { Communication, Contract } from "@/domain/types";

export const INTEGRATION_KEYS = ["whatsapp", "voip", "email", "assinatura", "cobranca", "mapas", "sso", "ia"] as const;
/** Chave da integração = categoria (um provedor por categoria). */
export type IntegrationKey = (typeof INTEGRATION_KEYS)[number];

export const INTEGRATION_CATEGORY_LABELS: Record<IntegrationKey, string> = {
  whatsapp: "WhatsApp",
  voip: "Telefonia / VoIP",
  email: "E-mail",
  assinatura: "Assinatura digital",
  cobranca: "Cobrança",
  mapas: "Mapas",
  sso: "Login corporativo (SSO)",
  ia: "Inteligência artificial",
};

/**
 * - conectado: credenciais presentes E adaptador implementado no INTEROS (o sistema fala com o provedor).
 * - nao_conectado: faltam credenciais; o sistema usa o fallback manual.
 * - verificar: não dá para confirmar pelo servidor (ex.: SSO habilitado no console do Firebase) ou há
 *   credenciais mas o adaptador do provedor ainda não foi implementado (o fallback continua em uso).
 */
export type IntegrationState = "conectado" | "nao_conectado" | "verificar";

export const INTEGRATION_STATE_LABELS: Record<IntegrationState, string> = {
  conectado: "Conectado",
  nao_conectado: "Não conectado",
  verificar: "Verificar",
};

/** Conjunto de variáveis que, completo, configura a integração (há integrações com mais de uma opção). */
export interface IntegrationRequirement {
  label: string;
  vars: string[];
  /** O INTEROS tem código que usa esta opção. */
  implemented: boolean;
}

export interface IntegrationEnvVar {
  name: string;
  description: string;
  required: boolean;
  /** Presença da variável no servidor (nunca o valor). */
  present: boolean;
}

export interface IntegrationStatus {
  key: IntegrationKey;
  name: string;
  category: IntegrationKey;
  /** O que a integração habilita no INTEROS. */
  enables: string;
  configured: boolean;
  implemented: boolean;
  state: IntegrationState;
  /** Explicação curta do estado (ex.: "Credenciais presentes, adaptador ainda não implementado"). */
  stateReason: string;
  requirements: IntegrationRequirement[];
  envVars: IntegrationEnvVar[];
  docsUrl: string;
  /** Como o sistema opera sem a integração. */
  fallback: string;
  /** Onde configurar. */
  whereToConfigure: string;
}

/** Snapshot leve para Client Components (passe por props; não importe status.ts no cliente). */
export type IntegrationFlags = Record<IntegrationKey, IntegrationState>;

// ---------------------------------------------------------------------------
// Extensões aditivas do modelo (a mover para src/domain/types.ts pelo integrador)
// ---------------------------------------------------------------------------

/** Communication.status aceita "manual": contato feito fora do sistema e registrado à mão. */
export type CommunicationStatusExtended = Communication["status"] | "manual";
/** Communication.provider aceita "manual" (fallback) e "resend" (e-mail transacional). */
export type CommunicationProviderExtended = Communication["provider"] | "manual" | "resend";

/** Signatário com a evidência da assinatura registrada manualmente. */
export type ContractSigner = Contract["signers"][number] & {
  /** "manual": assinatura registrada pelo Financeiro com evidência; "provedor": veio do provedor de assinatura. */
  method?: "manual" | "provedor";
  /** URL do documento assinado ou descrição da evidência (papel, e-mail de aceite etc.). */
  evidence?: string;
  evidenceUrl?: string;
  registeredBy?: string;
  registeredAt?: string;
};
