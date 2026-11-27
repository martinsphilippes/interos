import "server-only";
/**
 * API de módulos e licenças do ERP (contratos de módulos v1 e de licenças v2, `Authorization: Bearer <token>`,
 * envelope `{ data, meta }`). Só leitura, simulação e o envio assinado do retrato completo. Tipos tolerantes: campos
 * desconhecidos são ignorados e enumerações novas tratadas como "outro" (contrato §17).
 */
import type { ErpLicenseSnapshot, ErpControlMode, ErpDisplayMode, ErpItemIssue } from "@/domain/erp/license";

export type { ErpItemIssue };
import type { ErpEffectiveEntry, ErpRuntimeModule } from "@/domain/erp/status";
import { erpRequest, type ErpResponse } from "./http";

const V1 = "/api/interos/v1";
const V2 = "/api/interos/v2";
const enc = encodeURIComponent;

export interface ErpLicenseCompany {
  companyId: string;
  name: string;
  cnpj: string | null;
  kind: string;
  status: string;
  isDemo: boolean;
  appliedLicenseVersion: number;
  controlMode: ErpControlMode | string;
  runtimeVersion: number;
}

/** Empresas que o ERP mostra para a credencial: as da lista `empresas` dela ou, sem lista, só as já ligadas ao INTEROS. */
export async function listLicenseCompanies(): Promise<ErpLicenseCompany[]> {
  const res = await erpRequest<ErpLicenseCompany[]>({ api: "licencas", method: "GET", path: `${V2}/companies` });
  return Array.isArray(res.data) ? res.data : [];
}


export interface ErpLicenseStatus {
  companyId: string;
  companyName: string;
  appliedVersion: number;
  commercialStatus: string | null;
  display: ErpDisplayMode | string | null;
  limits: Record<string, number | null> | null;
  /** Estado efetivo por chave v1 (unidade, ligada, estado, aviso). */
  effective: Record<string, ErpEffectiveEntry> | null;
  rejectedItems: ErpItemIssue[];
  warnings: ErpItemIssue[];
  appliedAt: string | null;
  nextTransitionAt: string | null;
  runtime: { mode: ErpControlMode | string; version: number };
  sync: { lastSnapshotAt: string | null; lastSyncAt: string | null; lastSyncResult: unknown };
}

export interface ReadOptions {
  /** Tempo limite da leitura (a tela usa um curto para não travar quando o ERP está lento). */
  timeoutMs?: number;
}

export async function getLicenseStatus(companyId: string, options: ReadOptions = {}): Promise<ErpResponse<ErpLicenseStatus>> {
  return erpRequest<ErpLicenseStatus>({ api: "licencas", method: "GET", path: `${V2}/companies/${enc(companyId)}/license`, timeoutMs: options.timeoutMs });
}

/** Impacto de um desligamento no runtime (simulação v1 embutida na simulação da licença). */
export interface ErpImpact {
  module: string;
  name?: string;
  action?: string;
  from?: string;
  to?: string;
  policy?: string;
  blockers?: { key: string; label: string; count: number }[];
  obligations?: string[];
  integrationsAffected?: ({ module?: string; effect?: string } | string)[];
  requires?: string[];
  dependents?: string[];
  cascadedFrom?: string | null;
}

export interface ErpSimulationIssue {
  code: string;
  message: string;
  module?: string;
}

export interface ErpLicensePlanResult {
  companyId: string;
  licenseVersion: number;
  appliedVersion: number;
  stale: boolean;
  changes: { module: string; action: string }[];
  rejectedItems: ErpItemIssue[];
  warnings: ErpItemIssue[];
  effective: Record<string, ErpEffectiveEntry>;
  companyState: string;
  companyNotice?: string;
  nextTransitionAt: string | null;
  simulation: { impacts: ErpImpact[]; errors: ErpSimulationIssue[]; warnings: ErpSimulationIssue[]; valid?: boolean; resulting?: Record<string, string> } | null;
  valid: boolean;
}

/** Simula o retrato (nada é gravado no ERP). */
export async function simulateLicense(companyId: string, snapshot: ErpLicenseSnapshot): Promise<ErpResponse<ErpLicensePlanResult>> {
  return erpRequest<ErpLicensePlanResult>({ api: "licencas", method: "POST", path: `${V2}/companies/${enc(companyId)}/license/simulate`, body: snapshot, retries: 1, timeoutMs: 30_000 });
}

export interface ErpLicenseApplyResult {
  status: "applied" | "rejected" | "stale" | "duplicate" | string;
  appliedVersion: number;
  runtimeVersion: number | null;
  rejectedItems: ErpItemIssue[];
  warnings: ErpItemIssue[];
  effective: Record<string, ErpEffectiveEntry> | null;
  nextTransitionAt: string | null;
}

/**
 * Envia o retrato assinado. Repetir com o MESMO `eventId` e o mesmo corpo devolve a resposta original; o ERP aplica
 * por versão (uma versão já aplicada ou recusada nunca muda). O corpo é recalculado pelo chamador só com nova versão.
 */
export async function putLicense(companyId: string, snapshot: ErpLicenseSnapshot, meta: { eventId: string; actor: string }): Promise<ErpResponse<ErpLicenseApplyResult>> {
  return erpRequest<ErpLicenseApplyResult>({
    api: "licencas",
    method: "PUT",
    path: `${V2}/companies/${enc(companyId)}/license`,
    body: snapshot,
    sign: true,
    eventId: meta.eventId,
    actor: meta.actor,
    retries: 0,
    timeoutMs: 45_000,
    // Retrato recusado (dependência, tipo de empresa): 422 com o resultado no envelope de sucesso.
    acceptStatuses: [422],
  });
}

export interface ErpRuntimeState {
  companyId: string;
  companyName: string | null;
  companyKind: string | null;
  companyStatus: string | null;
  operational: boolean | null;
  mode: ErpControlMode | string;
  version: number;
  catalogVersion: string | null;
  baseline: { takenAt: string | null; status: string | null; divergences: unknown[] } | null;
  modules: ErpRuntimeModule[];
}

/**
 * Estado operacional por chave v1 (contrato de módulos v1): estado, acesso, encerramento em curso e a configuração que
 * falta na empresa. Leitura complementar: a fonte do contratado é a licença.
 */
export async function getRuntimeModules(companyId: string, options: ReadOptions = {}): Promise<ErpResponse<ErpRuntimeState>> {
  return erpRequest<ErpRuntimeState>({ api: "licencas", method: "GET", path: `${V1}/companies/${enc(companyId)}/modules`, timeoutMs: options.timeoutMs });
}

export interface ErpLicenseHistoryEntry {
  licenseVersion?: number;
  status?: string;
  source?: string;
  at?: string;
  eventId?: string | null;
  [key: string]: unknown;
}

export async function getLicenseHistory(companyId: string): Promise<ErpLicenseHistoryEntry[]> {
  const res = await erpRequest<ErpLicenseHistoryEntry[] | { items?: ErpLicenseHistoryEntry[] }>({ api: "licencas", method: "GET", path: `${V2}/companies/${enc(companyId)}/license/history` });
  const data = res.data as unknown;
  if (Array.isArray(data)) return data as ErpLicenseHistoryEntry[];
  const items = (data as { items?: unknown })?.items;
  return Array.isArray(items) ? (items as ErpLicenseHistoryEntry[]) : [];
}

/** Telemetria agregada (contrato v2 §6). Formato aberto: a tela mostra só o que vier. */
export async function getUsage(companyId: string, from: string, to: string): Promise<ErpResponse<Record<string, unknown>>> {
  return erpRequest<Record<string, unknown>>({ api: "licencas", method: "GET", path: `${V2}/companies/${enc(companyId)}/usage`, query: { from, to } });
}
