/**
 * Tipos da integração com o ERP Intercert guardados no INTEROS. Módulo puro (sem servidor): usado também pelas telas.
 *
 * Nome de código "erp" de propósito: "módulo" já é o módulo do próprio INTEROS (`ModuleKey`, `inactiveModules`).
 */
import type { BaseEntity, UserRef } from "../types";
import type { ErpCatalogDiff, ErpCatalogItem } from "./catalog";
import type { ErpControlMode, ErpDraftChange, ErpItemIssue, ErpLicenseItem, ErpLicenseSnapshot, PlannedChange } from "./license";

export type ErpEnvironment = "homologacao" | "producao";

export const ERP_ENVIRONMENT_LABELS: Record<ErpEnvironment, string> = {
  homologacao: "Homologação",
  producao: "Produção",
};

/** Versão importada do catálogo técnico (um documento por versão + o ponteiro `<ambiente>__atual`). */
export interface ErpCatalogRecord extends BaseEntity {
  kind: "versao";
  environment: ErpEnvironment;
  catalogVersion: string;
  /** SHA-256 dos itens normalizados: mesma versão declarada com conteúdo diferente vira outro registro. */
  hash: string;
  status: string | null;
  product: { code: string; name: string } | null;
  items: ErpCatalogItem[];
  counts: { modules: number; submodules: number; resources: number; units: number; sellableUnits: number };
  importedAt: string;
  /** Quem importou (null = rotina automática). */
  importedBy: UserRef | null;
  previousId: string | null;
  diff: ErpCatalogDiff;
  source: { path: string; requestId: string; etag: string | null };
}

export interface ErpCatalogPointer extends BaseEntity {
  kind: "atual";
  environment: ErpEnvironment;
  currentId: string | null;
  /** Última consulta ao ERP (mesmo sem mudança). */
  checkedAt: string;
  lastError: { code: string; message: string; at: string; requestId: string | null } | null;
}

/** Como o vínculo foi feito. */
export type ErpLinkMethod =
  /** O INTEROS criou a empresa no ERP (provisionamento). */
  | "provisionamento"
  /** Empresa que já usava o ERP, com o código de consentimento gerado pelo administrador dela. */
  | "codigo"
  /** Empresa identificada pelo id ERP e CNPJ conferidos na API de módulos (homologação e implantação assistida). */
  | "identificacao";

export const ERP_LINK_METHOD_LABELS: Record<ErpLinkMethod, string> = {
  provisionamento: "Criada pelo INTEROS",
  codigo: "Vinculada com o código da empresa",
  identificacao: "Identificada pelo id ERP e CNPJ",
};

/**
 * Vínculo cliente do INTEROS ↔ empresa no ERP (tabela de correspondência). Id `<ambiente>__<clientId>`: um vínculo
 * por cliente em cada ambiente; uma empresa do ERP também só pode estar em um cliente (conferido em transação).
 */
export interface ErpLink extends BaseEntity {
  clientId: string;
  environment: ErpEnvironment;
  /** Id da empresa no ERP (`idEmpresa`/`companyId`, opaco). */
  erpCompanyId: string;
  erpCompanyName: string | null;
  /** CNPJ só com dígitos, conferido com o ERP no vínculo. */
  cnpj: string | null;
  /** Tipo da empresa no ERP (varejo, escritório contábil, rede...), como o ERP informa. */
  erpKind: string | null;
  status: "ativo" | "encerrado";
  method: ErpLinkMethod;
  linkedAt: string;
  linkedBy: UserRef;
  /** Alteração de provisionamento que criou a empresa, quando foi pelo INTEROS. */
  provisioningChangeId: string | null;
  endedAt?: string;
  endedBy?: UserRef;
  endReason?: string;
  /** Última leitura bem-sucedida do estado no ERP. */
  lastSyncAt: string | null;
  lastSyncError: { code: string; message: string; at: string; requestId: string | null } | null;
}

/** Estado de um item na licença (contrato v2): vocabulário do ERP, preservado. */
export const ERP_LICENSE_ITEM_STATES = ["active", "inactive", "trial", "activation_scheduled", "suspension_scheduled", "suspended", "expired", "read_only"] as const;
export type ErpLicenseItemState = (typeof ERP_LICENSE_ITEM_STATES)[number];

/**
 * Licença contratada de uma empresa vinculada (`erp_licenses`, id = id do vínculo). `current` é o último retrato
 * CONFIRMADO pelo ERP: a base de toda alteração. `issuedVersion` é a última versão emitida (aplicada, recusada ou em
 * envio); o próximo envio usa `issuedVersion + 1` — uma versão nunca é reaproveitada.
 */
export interface ErpLicenseRecord extends BaseEntity {
  linkId: string;
  clientId: string;
  environment: ErpEnvironment;
  erpCompanyId: string;
  issuedVersion: number;
  current: ErpLicenseSnapshot | null;
  appliedVersion: number;
  appliedAt: string | null;
  /** A alteração aberta (aguardando aprovação, enviando ou aguardando nova tentativa): uma por empresa por vez. */
  openChangeId: string | null;
}

/**
 * - aguardando_aprovacao: desligamento que exige aprovação (nada foi enviado);
 * - enviando: retrato emitido e em envio ao ERP;
 * - falhou: o ERP não confirmou (rede, indisponível, credencial); repetir usa o MESMO evento e a mesma versão;
 * - aplicada: o ERP confirmou (o estado devolvido fica em `result`);
 * - recusada: o ERP recusou o retrato (motivos em `result.rejectedItems`); a versão fica queimada;
 * - conflito: outra versão já estava aplicada no ERP (reconciliar antes de seguir);
 * - cancelada: desistência registrada (com motivo) antes de o ERP aplicar.
 */
export const ERP_CHANGE_STATUSES = ["aguardando_aprovacao", "enviando", "falhou", "aplicada", "recusada", "conflito", "cancelada"] as const;
export type ErpChangeStatus = (typeof ERP_CHANGE_STATUSES)[number];

export const ERP_CHANGE_STATUS_LABELS: Record<ErpChangeStatus, string> = {
  aguardando_aprovacao: "Aguardando aprovação",
  enviando: "Enviando ao ERP",
  falhou: "Aguardando sincronização",
  aplicada: "Aplicada pelo ERP",
  recusada: "Recusada pelo ERP",
  conflito: "Conflito de versão",
  cancelada: "Cancelada",
};

/** Simulação do ERP guardada com o pedido (o que a pessoa viu ao confirmar). */
export interface ErpChangeSimulation {
  at: string;
  requestId: string | null;
  valid: boolean;
  rejected: ErpItemIssue[];
  warnings: ErpItemIssue[];
  impacts: {
    /** Unidade do catálogo v2 (quando a chave v1 tem unidade). */
    unit: string | null;
    module: string;
    name: string;
    to: string | null;
    policy: string | null;
    blockers: { key: string; label: string; count: number }[];
    obligations: string[];
    integrationsAffected: string[];
    cascadedFrom: string | null;
  }[];
  errors: { code: string; message: string; module?: string }[];
  companyState: string | null;
  companyNotice: string | null;
  nextTransitionAt: string | null;
}

export interface ErpChangeError {
  code: string;
  message: string;
  kind: string;
  retryable: boolean;
  requestId: string | null;
  at: string;
}

/** Alteração rastreável enviada ao ERP (`erp_change_requests`). O id é o `X-Interos-Event-Id` / `Idempotency-Key`. */
export interface ErpChangeRequest extends BaseEntity {
  kind: "licenca" | "provisionamento";
  clientId: string;
  linkId: string | null;
  environment: ErpEnvironment;
  erpCompanyId: string | null;
  status: ErpChangeStatus;
  /** O que a pessoa pediu (por unidade). */
  draft: ErpDraftChange[];
  /** O conjunto completo: pedidos + incluídos por dependência + desligados em cascata. */
  plan: PlannedChange[];
  /** Troca do modo de controle da empresa no ERP (legado → observação → aplicado). */
  controlMode: ErpControlMode | null;
  /** Primeira licença registrada pelo INTEROS (parte do que a empresa já usa no ERP). */
  initial: boolean;
  /** `issuedVersion` que a pessoa via ao preparar (controle de edição concorrente). */
  baseVersion: number;
  licenseVersion: number | null;
  /** Retrato exato enviado (o mesmo corpo em toda nova tentativa). */
  snapshot: ErpLicenseSnapshot | null;
  before: ErpLicenseItem[];
  after: ErpLicenseItem[];
  simulation: ErpChangeSimulation | null;
  requiresApproval: boolean;
  approvalReasons: string[];
  approval: { by: UserRef; at: string; self: boolean } | null;
  reason: string;
  contractReference: string | null;
  requestedBy: UserRef;
  requestedAt: string;
  attempts: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  lastError: ErpChangeError | null;
  result: {
    status: string;
    appliedVersion: number | null;
    runtimeVersion: number | null;
    rejectedItems: ErpItemIssue[];
    warnings: ErpItemIssue[];
    requestId: string | null;
    at: string;
  } | null;
  requestIds: string[];
  catalogVersionId: string | null;
  cancelled: { by: UserRef; at: string; reason: string } | null;
  /** Provisionamento: dados enviados (sem segredo) e a resposta resumida. */
  provisioning?: ErpProvisioningRecord | null;
  /**
   * Provisionamento: corpo EXATO enviado ao ERP. Nova tentativa usa o mesmo corpo com a mesma chave (o ERP compara a
   * impressão digital); chave nova reaplicaria a criação inteira.
   */
  requestBody?: Record<string, unknown> | null;
  /** Provisionamento: alteração de licença criada em seguida com as unidades escolhidas. */
  licenseChangeId?: string | null;
}

export interface ErpProvisioningRecord {
  contaInterosId: string;
  razaoSocial: string;
  cnpj: string;
  modulos: string[];
  units: string[];
  packageKey: string | null;
  adminEmail: string;
  entregaConvite: "interos" | "erp";
  /** Etapa da implantação devolvida pelo ERP. */
  implantacao: string | null;
  /** O convite saiu (pelo ERP) ou o link foi mostrado uma vez ao operador (nunca gravado). */
  inviteShownAt: string | null;
}
