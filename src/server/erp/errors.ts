/**
 * Erro de uma chamada ao ERP. A decisão é sempre pelo `code` (contrato), nunca pela mensagem, que é texto para
 * pessoas e pode mudar. Módulo puro (sem segredos): pode ir para testes e para mensagens de tela.
 */
import type { ErpApi } from "./config";

export type ErpErrorKind =
  /** Integração sem URL/credencial neste deploy, ou o ERP responde que não está configurado. */
  | "not_configured"
  /** Credencial recusada (401) ou sem escopo (403). */
  | "auth"
  | "not_found"
  /** Versão divergente, operação em andamento, chave repetida com outro conteúdo. */
  | "conflict"
  /** Pedido recusado pelas regras do ERP (validação, dependência, regra de negócio). */
  | "rejected"
  /** Limite de chamadas. */
  | "rate_limited"
  /** Falha do ERP (5xx) ou de rede/tempo esgotado: repetir com a mesma chave é seguro. */
  | "unavailable";

export interface ErpFieldError {
  field: string;
  message: string;
}

export class ErpError extends Error {
  readonly api: ErpApi;
  readonly status: number;
  /** Código estável do contrato (`version_conflict`, `cnpj_em_uso`...) ou `network`/`timeout`. */
  readonly code: string;
  readonly kind: ErpErrorKind;
  readonly details: unknown;
  readonly fields: ErpFieldError[];
  readonly requestId: string | null;
  readonly retryAfterMs: number | null;

  constructor(init: {
    api: ErpApi;
    status: number;
    code: string;
    message: string;
    details?: unknown;
    fields?: ErpFieldError[];
    requestId?: string | null;
    retryAfterMs?: number | null;
    kind?: ErpErrorKind;
  }) {
    super(init.message);
    this.name = "ErpError";
    this.api = init.api;
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? null;
    this.fields = init.fields ?? [];
    this.requestId = init.requestId ?? null;
    this.retryAfterMs = init.retryAfterMs ?? null;
    this.kind = init.kind ?? classifyErpError(init.status, init.code);
  }

  /** Repetir a MESMA solicitação (mesma chave) pode resolver: falha temporária, limite ou operação em andamento. */
  get retryable(): boolean {
    return this.kind === "unavailable" || this.kind === "rate_limited" || IN_PROGRESS_CODES.has(this.code);
  }
}

/**
 * "Ainda em andamento no ERP": a mesma chave sendo processada, ou outro retrato da mesma empresa sendo aplicado
 * (`license_busy`). Esperar e repetir com a MESMA chave.
 */
const IN_PROGRESS_CODES = new Set(["solicitacao_em_andamento", "in_progress", "license_busy"]);
const NOT_CONFIGURED_CODES = new Set(["servico_nao_configurado", "integration_not_configured", "not_configured"]);

export function classifyErpError(status: number, code: string): ErpErrorKind {
  if (NOT_CONFIGURED_CODES.has(code)) return "not_configured";
  if (code === "network" || code === "timeout") return "unavailable";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "rejected";
}

/** Mensagem curta para a tela, por tipo (o detalhe técnico fica no registro da operação). */
export function erpErrorSummary(error: ErpError): string {
  switch (error.kind) {
    case "not_configured":
      return "A integração com o ERP não está configurada neste ambiente.";
    case "auth":
      return "O ERP recusou a credencial do INTEROS. Avise o administrador da integração.";
    case "not_found":
      return "O ERP não encontrou esta empresa (ou ela não está vinculada a este INTEROS).";
    case "conflict":
      return error.message || "O ERP informou um conflito com outra alteração.";
    case "rate_limited":
      return "O ERP pediu para esperar um pouco antes de novas chamadas.";
    case "unavailable":
      return "O ERP não respondeu agora. Nada foi perdido: a solicitação pode ser repetida com segurança.";
    default:
      return error.message || "O ERP recusou a solicitação.";
  }
}

export function isErpError(error: unknown): error is ErpError {
  return error instanceof ErpError;
}
