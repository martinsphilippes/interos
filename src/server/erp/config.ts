import "server-only";
/**
 * Configuração da integração com o ERP Intercert, lida só no servidor. Os valores nunca saem deste módulo: as telas
 * recebem apenas a presença de cada variável (`erpIntegrationState`).
 *
 * Um deploy do INTEROS fala com UM ambiente do ERP (homologação ou produção), para que empresas de teste nunca se
 * misturem com as reais: cada vínculo guarda o ambiente em que foi feito e só vale nele.
 *
 * O ERP expõe três famílias de API, cada uma com a própria credencial (menor privilégio):
 * - licencas: catálogo de módulos, estado por empresa, simulação e aplicação (contratos de módulos v1 e licenças v2);
 * - provisionamento: criar, vincular, suspender e reativar empresas e convidar administradores;
 * - torre: indicadores da Torre de Controle (somente leitura).
 * Sem a credencial de uma família, as telas dela mostram "não configurado" e nada é enviado.
 */

import type { ErpEnvironment } from "@/domain/erp/types";

export type { ErpEnvironment };
export type ErpApi = "licencas" | "provisionamento" | "torre";

export const ERP_ENV_VARS = {
  url: "ERP_INTERCERT_URL",
  environment: "ERP_INTERCERT_AMBIENTE",
  licenseToken: "ERP_INTERCERT_TOKEN_LICENCAS",
  licenseSigningSecret: "ERP_INTERCERT_SEGREDO_ASSINATURA",
  provisioningCredential: "ERP_INTERCERT_CREDENCIAL_PROVISIONAMENTO",
  towerCredential: "ERP_INTERCERT_CREDENCIAL_TORRE",
} as const;

export interface ErpConfig {
  environment: ErpEnvironment;
  /** Origem do ERP, sem barra final e sem caminho (ex.: https://intercerterp.vercel.app). */
  baseUrl: string;
  /** Token das APIs de módulos e licenças (`Authorization: Bearer <token>`). */
  licenseToken: string | null;
  /** Segredo HMAC das escritas de licença (cabeçalho X-Interos-Signature). */
  licenseSigningSecret: string | null;
  /** Credencial `<id>.<segredo>` do provisionamento. */
  provisioningCredential: string | null;
  /** Credencial `<id>.<segredo>` da Torre de Controle. */
  towerCredential: string | null;
}

function read(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/** Normaliza a URL do ERP: só origem https (http apenas para localhost, em desenvolvimento e testes). */
export function normalizeErpBaseUrl(raw: string | null): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  return url.origin;
}

function parseEnvironment(raw: string | null): ErpEnvironment | null {
  if (raw === "homologacao" || raw === "producao") return raw;
  return null;
}

/**
 * Configuração atual, ou null quando a URL ou o ambiente faltam (ou são inválidos). Lida a cada chamada (barata) para
 * que testes e scripts possam trocar as variáveis.
 */
export function getErpConfig(): ErpConfig | null {
  const baseUrl = normalizeErpBaseUrl(read(ERP_ENV_VARS.url));
  const environment = parseEnvironment(read(ERP_ENV_VARS.environment));
  if (!baseUrl || !environment) return null;
  return {
    environment,
    baseUrl,
    licenseToken: read(ERP_ENV_VARS.licenseToken),
    licenseSigningSecret: read(ERP_ENV_VARS.licenseSigningSecret),
    provisioningCredential: read(ERP_ENV_VARS.provisioningCredential),
    towerCredential: read(ERP_ENV_VARS.towerCredential),
  };
}

export interface ErpApiAvailability {
  /** Leitura (catálogo, estado, histórico, Torre). */
  read: boolean;
  /** Escrita (aplicar licença, provisionar). */
  write: boolean;
}

export interface ErpIntegrationState {
  configured: boolean;
  environment: ErpEnvironment | null;
  /** Host do ERP (sem caminho), para exibir. */
  host: string | null;
  apis: Record<ErpApi, ErpApiAvailability>;
  /** Variáveis ausentes ou inválidas (só nomes). */
  missing: string[];
}

/** Estado da configuração sem valores: o que cada família consegue fazer e o que falta. */
export function erpIntegrationState(config: ErpConfig | null = getErpConfig()): ErpIntegrationState {
  const missing: string[] = [];
  if (!normalizeErpBaseUrl(read(ERP_ENV_VARS.url))) missing.push(ERP_ENV_VARS.url);
  if (!parseEnvironment(read(ERP_ENV_VARS.environment))) missing.push(ERP_ENV_VARS.environment);
  const has = (value: string | null | undefined, name: string) => {
    if (!value) missing.push(name);
    return Boolean(value);
  };
  const licenseRead = has(config?.licenseToken ?? read(ERP_ENV_VARS.licenseToken), ERP_ENV_VARS.licenseToken);
  const licenseWrite = has(config?.licenseSigningSecret ?? read(ERP_ENV_VARS.licenseSigningSecret), ERP_ENV_VARS.licenseSigningSecret) && licenseRead;
  const provisioning = has(config?.provisioningCredential ?? read(ERP_ENV_VARS.provisioningCredential), ERP_ENV_VARS.provisioningCredential);
  const tower = has(config?.towerCredential ?? read(ERP_ENV_VARS.towerCredential), ERP_ENV_VARS.towerCredential);
  const base = Boolean(config);
  return {
    configured: base && licenseRead,
    environment: config?.environment ?? null,
    host: config ? new URL(config.baseUrl).host : null,
    apis: {
      licencas: { read: base && licenseRead, write: base && licenseWrite },
      provisionamento: { read: base && provisioning, write: base && provisioning },
      torre: { read: base && tower, write: false },
    },
    missing: Array.from(new Set(missing)),
  };
}
