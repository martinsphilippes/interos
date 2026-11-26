/**
 * Tipos da integração com o ERP Intercert guardados no INTEROS. Módulo puro (sem servidor): usado também pelas telas.
 *
 * Nome de código "erp" de propósito: "módulo" já é o módulo do próprio INTEROS (`ModuleKey`, `inactiveModules`).
 */
import type { BaseEntity, UserRef } from "../types";
import type { ErpCatalogDiff, ErpCatalogItem } from "./catalog";

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
