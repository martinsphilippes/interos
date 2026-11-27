import "server-only";
/**
 * Alterações de módulos do ERP por empresa (licença v2), da revisão à confirmação do ERP.
 *
 * Fluxo: revisar (plano + simulação do ERP, sem gravar nada) → confirmar (motivo; aprovação quando o desligamento
 * exige) → enviar o retrato completo assinado → registrar o que o ERP devolveu. Garantias:
 * - uma alteração aberta por empresa (aguardando aprovação, enviando ou aguardando nova tentativa): duas pessoas nunca
 *   enviam versões concorrentes; quem preparou sobre uma versão antiga recebe "versão mudou" com a seleção preservada;
 * - repetir é seguro: o id da alteração é o `X-Interos-Event-Id` e a versão nunca muda entre tentativas;
 * - nada aparece como ativo antes da confirmação do ERP (o contratado vigente só muda quando o ERP aplica);
 * - se o ERP aplicou mas a resposta se perdeu, a reconciliação encontra a versão aplicada e conclui sem reenviar.
 */
import { docdb, type Transaction } from "@/server/docdb";
import { COLLECTIONS, type User, type UserRef } from "@/domain/types";
import type { ErpChangeError, ErpChangeRequest, ErpChangeSimulation, ErpLicenseRecord, ErpLink, ErpOnlyOff } from "@/domain/erp/types";
import {
  ERP_DISPLAY_MODES,
  ERP_ITEM_STATE_LABELS,
  buildSnapshot,
  deactivations,
  displayChangeParts,
  displayDivergences,
  erpOnlyDisables,
  hasDisplayWork,
  planDisplayChanges,
  planLicenseChanges,
  type CurrentDisplay,
  type DisplayPlan,
  type ErpControlMode,
  type ErpDisplayDraft,
  type ErpDisplayMode,
  type ErpDraftChange,
  type ErpLicenseItem,
  type ErpLicenseSnapshot,
  type ErpUnitDisplay,
  type LicensePlan,
} from "@/domain/erp/license";
import type { ErpCatalogIndex } from "@/domain/erp/catalog";
import { BusinessError } from "@/server/auth/error-classes";
import { resolvePermissionsForUser } from "@/server/auth/permission-store";
import { getById, list, newId, nowIso, txGetOwn, ORG_ID } from "@/server/db";
import { emitEvent } from "@/server/events/emit";
import { notify } from "@/server/notifications";
import { getErpConfig } from "./config";
import { ErpError, erpErrorSummary } from "./errors";
import { getCurrentCatalog, type LoadedCatalog } from "./catalog-store";
import { getErpLink } from "./links";
import { getLicenseHistory, getLicenseStatus, getRuntimeModules, putLicense, simulateLicense, type ErpLicenseApplyResult, type ErpLicensePlanResult, type ErpLicenseStatus, type ErpRuntimeState } from "./api-licencas";

export const ERP_APPROVE_KEY = "operacao.clientes.erp.aprovar" as const;

export type ErpChangeBlockCode = "nao_configurado" | "sem_vinculo" | "sem_catalogo" | "alteracao_aberta" | "versao_mudou" | "lote_invalido" | "sem_mudanca" | "estado_invalido" | "nao_encontrada" | "erp_indisponivel";

/** Motivo de não seguir, com mensagem para a pessoa (failAction exibe). */
export class ErpChangeBlocked extends BusinessError {
  constructor(
    message: string,
    readonly code: ErpChangeBlockCode,
  ) {
    super(message);
    this.name = "ErpChangeBlocked";
  }
}

const OPEN_STATUSES = new Set<ErpChangeRequest["status"]>(["aguardando_aprovacao", "enviando", "falhou"]);
/** Espera até a próxima tentativa automática, por número de tentativas já feitas (minutos). */
const RETRY_MINUTES = [1, 5, 15, 60, 360, 720];
const MAX_AUTO_ATTEMPTS = 8;
/** Alteração "enviando" sem resposta há mais que isto (processo interrompido) é reenviada pela rotina. */
const STUCK_SENDING_MS = 3 * 60 * 1000;

const licenseRef = (linkId: string) => docdb.collection(COLLECTIONS.erpLicenses).doc(linkId);
const changeRef = (id: string) => docdb.collection(COLLECTIONS.erpChangeRequests).doc(id);

function emptyRecord(link: ErpLink, now: string): Omit<ErpLicenseRecord, "id"> {
  return { organizationId: ORG_ID, createdAt: now, updatedAt: now, linkId: link.id, clientId: link.clientId, environment: link.environment, erpCompanyId: link.erpCompanyId, issuedVersion: 0, current: null, appliedVersion: 0, appliedAt: null, openChangeId: null };
}

export async function getLicenseRecord(linkId: string): Promise<ErpLicenseRecord | null> {
  return getById<ErpLicenseRecord>(COLLECTIONS.erpLicenses, linkId);
}

export async function getChange(id: string): Promise<ErpChangeRequest | null> {
  return getById<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, id);
}

/** Alterações de um cliente (mais recentes primeiro), no ambiente configurado. */
export async function listClientChanges(clientId: string, limit = 50): Promise<ErpChangeRequest[]> {
  const environment = getErpConfig()?.environment;
  if (!environment) return [];
  const all = await list<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, { where: [["clientId", "==", clientId], ["environment", "==", environment]] });
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
}

/**
 * Itens de partida quando o INTEROS ainda não registrou licença para a empresa: o que ela usa HOJE no ERP (unidades
 * ligadas no runtime). A primeira alteração registra esse retrato, sem desligar nada por omissão.
 */
export function baseItemsFromErp(index: ErpCatalogIndex, runtime: ErpRuntimeState | null, status: ErpLicenseStatus | null): ErpLicenseItem[] {
  const unitByKey = new Map(index.units.filter((u) => u.v1Key).map((u) => [u.v1Key as string, u.code]));
  const on = new Set<string>();
  if (runtime?.modules?.length) {
    for (const m of runtime.modules) {
      const unit = unitByKey.get(m.module);
      if (unit && (m.state === "enabled" || m.state === "scheduled_off")) on.add(unit);
    }
  } else if (status?.effective) {
    for (const [key, entry] of Object.entries(status.effective)) {
      const unit = unitByKey.get(key) ?? (index.byCode.get(entry.unit)?.unit ? entry.unit : undefined);
      if (unit && entry.on) on.add(unit);
    }
  }
  return [...on].sort().map((code) => ({ code, state: "active" as const }));
}

export interface ErpReading {
  status: ErpLicenseStatus | null;
  runtime: ErpRuntimeState | null;
  error: ErpError | null;
}

/**
 * Exibição que vale hoje: a do último retrato do INTEROS; antes dele (ou sem o padrão fixado), a que o ERP aplica.
 * As escolhas por unidade do ERP só valem antes do primeiro retrato do INTEROS, que passa a ser a referência.
 * `fixed` é só o padrão que o INTEROS escolheu: o calculado pelo ERP aparece na tela, mas nunca vai no retrato.
 */
export function currentDisplay(record: Pick<ErpLicenseRecord, "current"> | null, status: Pick<ErpLicenseStatus, "display" | "displays"> | null): CurrentDisplay & { fixed: ErpDisplayMode | null; displays: ErpUnitDisplay[] } {
  const erpDefault = status?.display && (ERP_DISPLAY_MODES as readonly string[]).includes(status.display) ? (status.display as ErpDisplayMode) : null;
  const erpUnits = (status?.displays ?? []).filter((d) => (ERP_DISPLAY_MODES as readonly string[]).includes(d.display));
  const fixed = record?.current?.display ?? null;
  return { display: fixed ?? erpDefault, fixed, displays: record?.current ? (record.current.displays ?? []) : erpUnits };
}

/** Lê o estado da empresa no ERP (licença v2 + runtime v1), em paralelo. Falha não interrompe: vira `error`. */
export async function readErpState(erpCompanyId: string, timeoutMs?: number): Promise<ErpReading> {
  const [status, runtime] = await Promise.allSettled([getLicenseStatus(erpCompanyId, { timeoutMs }), getRuntimeModules(erpCompanyId, { timeoutMs })]);
  const error = [status, runtime].map((r) => (r.status === "rejected" ? r.reason : null)).find((e) => e) ?? null;
  return {
    status: status.status === "fulfilled" ? status.value.data : null,
    runtime: runtime.status === "fulfilled" ? runtime.value.data : null,
    error: error instanceof ErpError ? error : error ? new ErpError({ api: "licencas", status: 0, code: "network", message: String((error as Error)?.message ?? error) }) : null,
  };
}

function summarizeSimulation(index: ErpCatalogIndex, plan: ErpLicensePlanResult, requestId: string | null, at: string): ErpChangeSimulation {
  const unitByKey = new Map(index.units.filter((u) => u.v1Key).map((u) => [u.v1Key as string, u.code]));
  const sim = plan.simulation;
  return {
    at,
    requestId,
    valid: Boolean(plan.valid) && (sim?.errors?.length ?? 0) === 0,
    rejected: plan.rejectedItems ?? [],
    warnings: plan.warnings ?? [],
    impacts: (sim?.impacts ?? []).map((i) => ({
      unit: unitByKey.get(i.module) ?? null,
      module: i.module,
      name: i.name ?? i.module,
      action: i.action ?? null,
      from: i.from ?? null,
      to: i.to ?? null,
      policy: i.policy ?? null,
      blockers: (i.blockers ?? []).filter((b) => b && b.count > 0),
      obligations: i.obligations ?? [],
      integrationsAffected: (i.integrationsAffected ?? []).map((x) => (typeof x === "string" ? x : [x.module, x.effect].filter(Boolean).join(": "))),
      cascadedFrom: i.cascadedFrom ?? null,
    })),
    errors: sim?.errors ?? [],
    companyState: plan.companyState ?? null,
    companyNotice: plan.companyNotice ?? null,
    nextTransitionAt: plan.nextTransitionAt ?? null,
  };
}

/**
 * Por que a alteração exige aprovação (lista vazia = não exige). Só desligamentos e a passagem para "aplicado" pedem
 * aprovação: ativar nunca. Desligamento simples (sem pendência, sem cascata) segue direto; o que o ERP desligaria sem
 * estar no plano (ligado só lá) sempre pede.
 */
export function approvalReasons(index: ErpCatalogIndex, plan: LicensePlan, simulation: ErpChangeSimulation | null, modeFrom: string | null, modeTo: ErpControlMode | null): string[] {
  const reasons: string[] = [];
  const offs = deactivations(plan);
  const nameOf = (code: string) => `${code} ${index.byCode.get(code)?.name ?? ""}`.trim();
  for (const off of erpOnlyDisables(plan, simulation)) {
    const label = off.unit ? nameOf(off.unit) : off.name;
    reasons.push(`${label}: está ligado no ERP, mas não no contratado do INTEROS; este envio também desliga`);
    for (const impact of (simulation?.impacts ?? []).filter((i) => i.module === off.module)) {
      for (const b of impact.blockers) reasons.push(`${label}: ${b.label} (${b.count}) em andamento`);
      for (const o of impact.obligations) reasons.push(`${label}: ${o}`);
    }
  }
  for (const off of offs) {
    const impacts = (simulation?.impacts ?? []).filter((i) => i.unit === off.code);
    for (const impact of impacts) {
      for (const b of impact.blockers) reasons.push(`${nameOf(off.code)}: ${b.label} (${b.count}) em andamento`);
      for (const o of impact.obligations) reasons.push(`${nameOf(off.code)}: ${o}`);
      if (impact.policy === "drain" && impact.blockers.length) reasons.push(`${nameOf(off.code)}: encerramento gradual (o ERP só conclui pendências até terminar)`);
    }
    if (off.to === "read_only" || off.to === "suspended") reasons.push(`${nameOf(off.code)}: ${ERP_ITEM_STATE_LABELS[off.to].toLowerCase()}`);
  }
  const cascade = plan.changes.filter((c) => c.origin === "cascata");
  if (cascade.length) reasons.push(`Desliga também, em cascata: ${cascade.map((c) => nameOf(c.code)).join(", ")}`);
  if (modeTo === "enforced" && modeFrom !== "enforced") reasons.push("Passa a aplicar o contrato no ERP: o que não estiver contratado deixa de ficar disponível para a empresa");
  return Array.from(new Set(reasons));
}

export interface LicenseReview {
  link: ErpLink;
  catalogVersionId: string;
  /** Versão emitida que a pessoa está vendo (vai de volta na confirmação). */
  baseVersion: number;
  /** Primeira licença registrada pelo INTEROS: parte do que a empresa usa hoje. */
  initial: boolean;
  currentItems: ErpLicenseItem[];
  plan: LicensePlan;
  /** Mudanças de exibição do lote (padrão da empresa e por unidade): nunca pedem aprovação. */
  displayPlan: DisplayPlan;
  /** O ERP aceita exibição por unidade (null = não deu para ler). */
  displaySupported: boolean | null;
  /** Versão do retrato registrado em que o plano se baseou (conferida de novo dentro da transação do envio). */
  basedOnVersion: number;
  /** Unidades ligadas só no ERP que o envio desligaria (pela simulação). */
  erpOnlyOff: ErpOnlyOff[];
  modeFrom: string | null;
  controlMode: ErpControlMode | null;
  simulation: ErpChangeSimulation | null;
  /** Por que a simulação não pôde ser feita (o envio continua possível; o ERP valida de novo). */
  simulationError: string | null;
  requiresApproval: boolean;
  approvalReasons: string[];
  openChange: ErpChangeRequest | null;
  erpAppliedVersion: number;
}

interface Context {
  link: ErpLink;
  loaded: LoadedCatalog;
  record: ErpLicenseRecord | null;
}

async function context(clientId: string): Promise<Context> {
  const config = getErpConfig();
  if (!config?.licenseToken) throw new ErpChangeBlocked("A integração com o ERP não está configurada neste ambiente.", "nao_configurado");
  const link = await getErpLink(clientId, config.environment);
  if (!link) throw new ErpChangeBlocked("Este cliente ainda não está vinculado a uma empresa no ERP.", "sem_vinculo");
  const loaded = await getCurrentCatalog(config.environment);
  if (!loaded) throw new ErpChangeBlocked("O catálogo de módulos do ERP ainda não foi importado. Importe em Administração › Integrações.", "sem_catalogo");
  const record = await getLicenseRecord(link.id);
  return { link, loaded: { record: loaded.record, catalog: loaded.catalog, index: loaded.index }, record };
}

/** Revisa o lote: plano completo, simulação do ERP e se exige aprovação. Não grava nada. */
export async function reviewLicenseChange(
  input: { clientId: string; draft: readonly ErpDraftChange[]; display?: ErpDisplayDraft | null; controlMode?: ErpControlMode | null; startEmpty?: boolean },
  now = new Date(),
): Promise<LicenseReview> {
  const { link, loaded, record } = await context(input.clientId);
  const reading = await readErpState(link.erpCompanyId);
  const initial = !record?.current;
  // A primeira licença parte do que a empresa usa hoje no ERP. Sem essa leitura o retrato sairia só com a seleção e
  // desligaria todo o resto: não segue. (Empresa recém-criada pelo INTEROS parte do vazio: o conjunto é o escolhido.)
  const startEmpty = Boolean(input.startEmpty && initial);
  if (initial && !startEmpty && reading.error) {
    throw new ErpChangeBlocked(
      "Não foi possível ler no ERP o que esta empresa usa hoje. A primeira licença parte dessa leitura (sem ela, desligaria o que não estiver na lista): tente de novo quando o ERP responder.",
      "erp_indisponivel",
    );
  }
  const currentItems = record?.current?.items ?? (startEmpty ? [] : baseItemsFromErp(loaded.index, reading.runtime, reading.status));
  const plan = planLicenseChanges(loaded.index, currentItems, input.draft, now);
  const displayPlan = planDisplayChanges(loaded.index, currentDisplay(record, reading.status), input.display);
  plan.errors.push(...displayPlan.errors);
  // ERP sem a exibição por unidade ignoraria a escolha, e o INTEROS a mostraria como aplicada: não segue
  const displaySupported = displayDivergences(loaded.index, record?.current ?? null, reading.status).supported;
  if (displaySupported === false && displayPlan.changes.some((c) => c.code !== null && !c.stale)) {
    plan.errors.push({ code: "-", reason: "exibicao_sem_suporte", message: "O ERP desta empresa ainda não aceita exibição por unidade (só o padrão da empresa). Tire as escolhas por unidade do lote." });
  }
  const modeFrom = reading.runtime?.mode ?? reading.status?.runtime?.mode ?? null;
  const controlMode = input.controlMode && input.controlMode !== modeFrom ? input.controlMode : null;
  const openChange = record?.openChangeId ? await getChange(record.openChangeId) : null;
  const erpAppliedVersion = Math.max(reading.status?.appliedVersion ?? 0, record?.appliedVersion ?? 0);
  let simulation: ErpChangeSimulation | null = null;
  let simulationError: string | null = null;
  const hasWork = plan.changes.length > 0 || hasDisplayWork(displayPlan) || controlMode !== null || initial;
  if (plan.errors.length === 0 && hasWork) {
    const version = Math.max(record?.issuedVersion ?? 0, erpAppliedVersion) + 1;
    const snapshot = buildSnapshot({ companyId: link.erpCompanyId, licenseVersion: version, items: plan.items, previous: record?.current ?? null, controlMode, display: displayPlan, issuedAt: now.toISOString() });
    try {
      const res = await simulateLicense(link.erpCompanyId, snapshot);
      simulation = summarizeSimulation(loaded.index, res.data, res.requestId, nowIso());
    } catch (error) {
      simulationError = error instanceof ErpError ? erpErrorSummary(error) : "Não foi possível simular no ERP agora.";
    }
  }
  const reasons = approvalReasons(loaded.index, plan, simulation, modeFrom, controlMode);
  return {
    link,
    catalogVersionId: loaded.record.id,
    baseVersion: record?.issuedVersion ?? 0,
    initial,
    currentItems,
    plan,
    displayPlan,
    displaySupported,
    basedOnVersion: record?.current?.licenseVersion ?? 0,
    erpOnlyOff: erpOnlyDisables(plan, simulation),
    modeFrom,
    controlMode,
    simulation,
    simulationError,
    requiresApproval: reasons.length > 0,
    approvalReasons: reasons,
    openChange: openChange && OPEN_STATUSES.has(openChange.status) ? openChange : null,
    erpAppliedVersion,
  };
}

export interface SubmitInput {
  clientId: string;
  draft: readonly ErpDraftChange[];
  /** Exibição preparada (padrão da empresa e por unidade). */
  display?: ErpDisplayDraft | null;
  controlMode?: ErpControlMode | null;
  baseVersion: number;
  reason: string;
  contractReference?: string | null;
  actor: UserRef;
  /** A pessoa tem a permissão de aprovar (o desligamento que exige aprovação segue direto, registrado como dela). */
  canApprove: boolean;
  /** Licença inicial de empresa recém-criada pelo INTEROS: o retrato é exatamente a seleção (não parte do ERP). */
  startEmpty?: boolean;
  /**
   * Chaves do runtime que a revisão mostrou como "o ERP também vai desligar". Se a confirmação encontrar outra, não
   * segue (nem para quem pode aprovar): a pessoa revisa de novo. Ausente = sem conferência (chamadas internas).
   */
  reviewedErpOnlyOff?: readonly string[] | null;
}

/**
 * Confirma o lote. Revisa de novo no servidor (nunca confia no plano da tela), recusa se outra alteração está aberta ou
 * se a versão mudou desde a revisão, grava a alteração e envia (ou deixa aguardando aprovação).
 */
export async function submitLicenseChange(input: SubmitInput): Promise<ErpChangeRequest> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new ErpChangeBlocked("Informe o motivo da alteração (fica no histórico da empresa e no ERP).", "lote_invalido");
  const review = await reviewLicenseChange({ clientId: input.clientId, draft: input.draft, display: input.display, controlMode: input.controlMode, startEmpty: input.startEmpty });
  if (review.plan.errors.length) throw new ErpChangeBlocked(review.plan.errors.map((e) => e.message).join(" "), "lote_invalido");
  if (review.simulation && !review.simulation.valid) {
    const why = [...review.simulation.rejected.filter((r) => r.reason === "dependency_missing" || r.reason === "kind_not_supported"), ...review.simulation.errors].map((r) => r.message);
    throw new ErpChangeBlocked(`O ERP recusaria este lote: ${why.join(" ") || "regras de dependência"}.`, "lote_invalido");
  }
  if (!review.plan.changes.length && !hasDisplayWork(review.displayPlan) && !review.controlMode && !review.initial) throw new ErpChangeBlocked("Nada a alterar: a seleção já é o contratado.", "sem_mudanca");
  // O retrato é completo: sem a simulação não dá para ver o que está em andamento (caixa aberto, notas pendentes) nem
  // o que o ERP desligaria por estar ligado só lá. Nenhum envio segue sem ela — exceto a licença inicial da empresa
  // recém-criada pelo INTEROS (nada foi ligado lá fora da seleção): ela fica registrada, e o envio simula de novo antes
  // de cada tentativa.
  if (!review.simulation && !(input.startEmpty && review.initial)) {
    throw new ErpChangeBlocked(
      `Sem a simulação do ERP o envio não segue (ela mostra o que está em andamento e o que o envio desligaria). ${review.simulationError ?? "O ERP não respondeu."} Tente de novo em instantes.`,
      "erp_indisponivel",
    );
  }
  // O ERP pode ter mudado entre a revisão e a confirmação: se agora o envio desligaria algo ligado só lá que a pessoa
  // não viu na revisão, não segue — nem para quem pode aprovar (seria aprovar o que ninguém viu).
  if (input.reviewedErpOnlyOff) {
    const seen = new Set(input.reviewedErpOnlyOff);
    const fresh = review.erpOnlyOff.filter((o) => !seen.has(o.module));
    if (fresh.length) {
      throw new ErpChangeBlocked(`O ERP mudou desde a revisão: agora este envio também desligaria ${fresh.map(offLabel).join(", ")}, ligado lá fora do contratado. Revise de novo.`, "versao_mudou");
    }
  }

  const needsApproval = review.requiresApproval && !input.canApprove;
  const now = nowIso();
  const id = newId(COLLECTIONS.erpChangeRequests);
  const link = review.link;

  const change = await docdb.runTransaction(async (tx: Transaction) => {
    const snap = await txGetOwn(tx, licenseRef(link.id));
    const record: ErpLicenseRecord = snap ? ({ ...(snap.data() as unknown as ErpLicenseRecord), id: link.id } as ErpLicenseRecord) : ({ ...emptyRecord(link, now), id: link.id } as ErpLicenseRecord);
    if (record.openChangeId) {
      const openSnap = await txGetOwn(tx, changeRef(record.openChangeId));
      const open = openSnap ? (openSnap.data() as unknown as ErpChangeRequest) : null;
      if (open && OPEN_STATUSES.has(open.status)) throw new ErpChangeBlocked("Há outra alteração de módulos desta empresa em andamento. Conclua, aprove ou cancele a anterior antes de enviar outra.", "alteracao_aberta");
    }
    if (record.issuedVersion !== input.baseVersion) throw new ErpChangeBlocked("Outra pessoa alterou os módulos desta empresa enquanto você revisava. O estado foi recarregado.", "versao_mudou");
    // o plano foi montado sobre o retrato registrado na revisão: se outro foi aplicado depois, o lote o desfaria
    if ((record.current?.licenseVersion ?? 0) !== review.basedOnVersion) throw new ErpChangeBlocked("O ERP confirmou outra alteração enquanto você revisava. O estado foi recarregado.", "versao_mudou");
    const version = needsApproval ? null : Math.max(record.issuedVersion, review.erpAppliedVersion) + 1;
    const snapshot: ErpLicenseSnapshot | null = version
      ? buildSnapshot({ companyId: link.erpCompanyId, licenseVersion: version, items: review.plan.items, previous: record.current, controlMode: review.controlMode, display: review.displayPlan, issuedAt: now })
      : null;
    const doc: Omit<ErpChangeRequest, "id"> = {
      organizationId: ORG_ID,
      createdAt: now,
      updatedAt: now,
      kind: "licenca",
      clientId: input.clientId,
      linkId: link.id,
      environment: link.environment,
      erpCompanyId: link.erpCompanyId,
      status: needsApproval ? "aguardando_aprovacao" : "enviando",
      draft: [...input.draft],
      plan: review.plan.changes,
      displayDraft: input.display ?? null,
      displayChanges: review.displayPlan.changes,
      erpOnlyOff: review.erpOnlyOff,
      controlMode: review.controlMode,
      initial: review.initial,
      baseVersion: input.baseVersion,
      licenseVersion: version,
      snapshot,
      before: review.currentItems,
      after: review.plan.items,
      simulation: review.simulation,
      requiresApproval: review.requiresApproval,
      approvalReasons: review.approvalReasons,
      approval: review.requiresApproval && !needsApproval ? { by: input.actor, at: now, self: true } : null,
      reason,
      contractReference: input.contractReference?.trim() || null,
      requestedBy: input.actor,
      requestedAt: now,
      attempts: 0,
      lastAttemptAt: null,
      nextAttemptAt: null,
      lastError: null,
      result: null,
      requestIds: [],
      catalogVersionId: review.catalogVersionId,
      cancelled: null,
    };
    tx.set(changeRef(id), doc);
    const { id: _recordId, ...recordData } = record;
    void _recordId;
    tx.set(licenseRef(link.id), { ...recordData, issuedVersion: version ?? record.issuedVersion, openChangeId: id, updatedAt: now });
    return { ...doc, id } as ErpChangeRequest;
  });

  if (change.status === "aguardando_aprovacao") {
    await afterApprovalRequested(change);
    return change;
  }
  return sendLicenseChange(change.id);
}

async function approverIds(excludeId: string): Promise<string[]> {
  const users = await list<User>(COLLECTIONS.users);
  const out: string[] = [];
  for (const u of users) {
    if (u.active === false || u.id === excludeId) continue;
    const perms = await resolvePermissionsForUser(u);
    if (perms?.has(ERP_APPROVE_KEY)) out.push(u.id);
  }
  return out;
}

async function afterApprovalRequested(change: ErpChangeRequest): Promise<void> {
  try {
    await emitEvent({
      type: "erp.license_approval_requested",
      actor: change.requestedBy,
      clientId: change.clientId,
      entity: { type: "erp_change", id: change.id },
      title: "Desligamento de módulo do ERP aguardando aprovação",
      description: change.approvalReasons.slice(0, 3).join(" · "),
      payload: { changeId: change.id, reason: change.reason, approvalReasons: change.approvalReasons },
    });
    const ids = await approverIds(change.requestedBy.id);
    if (ids.length) {
      await notify({
        userIds: ids,
        kind: "acao",
        title: "Aprovar desligamento de módulo do ERP",
        body: `${change.requestedBy.name}: ${change.reason}`,
        href: `/clientes/${change.clientId}?aba=erp`,
        entity: { type: "erp_change", id: change.id },
        key: `erp_aprovacao_${change.id}`,
      });
    }
  } catch (error) {
    console.error("[erp] pedido de aprovação gravado, mas o aviso falhou", error);
  }
}

const actorHeader = (who: UserRef) => `${who.name} (${who.id})`.slice(0, 200);
const offLabel = (o: ErpOnlyOff) => (o.unit ? `${o.unit} ${o.name}` : o.name);

/**
 * Antes de cada envio (inclusive as novas tentativas, que podem vir horas depois), simula de novo o MESMO retrato: se
 * desde o pedido o ERP passou a ter algo ligado só lá, o envio o desligaria sem ninguém ver. Nesse caso não envia e
 * para de tentar (a pessoa cancela e pede de novo). ERP fora do ar conta como tentativa que falhou (tenta de novo).
 */
async function erpChangedSince(change: ErpChangeRequest): Promise<ErpChangeError | null> {
  if (!change.snapshot || !change.erpCompanyId) return null;
  const loaded = await getCurrentCatalog(change.environment).catch(() => null);
  if (!loaded) return null;
  try {
    const res = await simulateLicense(change.erpCompanyId, change.snapshot);
    const simulation = summarizeSimulation(loaded.index, res.data, res.requestId, nowIso());
    const known = new Set((change.erpOnlyOff ?? []).map((o) => o.module));
    const fresh = erpOnlyDisables({ changes: change.plan }, simulation).filter((o) => !known.has(o.module));
    if (!fresh.length) return null;
    const names = fresh.map((o) => (o.unit ? `${o.unit} ${loaded.index.byCode.get(o.unit)?.name ?? o.name}` : o.name)).join(", ");
    return {
      code: "erp_mudou",
      message: `Não enviado: desde o pedido, o ERP passou a ter ligado ${names}, fora do contratado no INTEROS, e este retrato também desligaria. Cancele e peça de novo para revisar.`,
      kind: "rejected",
      retryable: false,
      requestId: res.requestId,
      at: nowIso(),
    };
  } catch (error) {
    return errorOf(error, nowIso());
  }
}

function errorOf(error: unknown, at: string): ErpChangeError {
  if (error instanceof ErpError) return { code: error.code, message: erpErrorSummary(error) + (error.kind === "rejected" || error.kind === "auth" ? ` (${error.message})` : ""), kind: error.kind, retryable: error.retryable, requestId: error.requestId, at };
  return { code: "interno", message: "Falha inesperada ao enviar ao ERP.", kind: "unavailable", retryable: true, requestId: null, at };
}

/**
 * Envia (ou reenvia) a alteração ao ERP com o mesmo evento e o mesmo retrato. Idempotente: alteração já concluída
 * volta como está. Usada na confirmação, na aprovação, no "Tentar de novo" e na rotina de novas tentativas.
 */
export async function sendLicenseChange(id: string): Promise<ErpChangeRequest> {
  const change = await getChange(id);
  if (!change) throw new ErpChangeBlocked("Alteração não encontrada.", "nao_encontrada");
  if (change.status !== "enviando" && change.status !== "falhou") return change;
  if (!change.snapshot || !change.erpCompanyId) throw new ErpChangeBlocked("Esta alteração não tem retrato para enviar.", "estado_invalido");
  const startedAt = nowIso();
  // Marca o envio sob trava: se a alteração foi cancelada (ou concluída) entre a leitura e aqui, não envia.
  let proceed = false;
  await docdb.runTransaction(async (tx) => {
    proceed = false;
    const snap = await txGetOwn(tx, changeRef(id));
    const current = snap ? (snap.data() as unknown as ErpChangeRequest) : null;
    if (!current || (current.status !== "enviando" && current.status !== "falhou")) return;
    tx.update(changeRef(id), { status: "enviando", lastAttemptAt: startedAt, updatedAt: startedAt });
    proceed = true;
  });
  if (!proceed) return (await getChange(id)) ?? change;
  const changedSince = await erpChangedSince(change);
  if (changedSince) return failed(id, changedSince);
  try {
    const res = await putLicense(change.erpCompanyId, change.snapshot, { eventId: change.id, actor: actorHeader(change.approval && !change.approval.self ? change.approval.by : change.requestedBy) });
    return await finish(id, res.data, res.requestId);
  } catch (error) {
    return failed(id, errorOf(error, nowIso()));
  }
}

async function finish(id: string, data: ErpLicenseApplyResult, requestId: string | null): Promise<ErpChangeRequest> {
  const at = nowIso();
  const status: ErpChangeRequest["status"] = data.status === "applied" || data.status === "duplicate" ? "aplicada" : data.status === "rejected" ? "recusada" : data.status === "stale" ? "conflito" : "falhou";
  const result: ErpChangeRequest["result"] = {
    status: data.status,
    appliedVersion: data.appliedVersion ?? null,
    runtimeVersion: data.runtimeVersion ?? null,
    rejectedItems: data.rejectedItems ?? [],
    warnings: data.warnings ?? [],
    requestId,
    at,
  };
  let updated: ErpChangeRequest | null = null;
  let transitioned = false;
  await docdb.runTransaction(async (tx) => {
    const snap = await txGetOwn(tx, changeRef(id));
    const change = snap ? ({ ...(snap.data() as unknown as ErpChangeRequest), id } as ErpChangeRequest) : null;
    if (!change) return;
    if (change.status === "aplicada" || change.status === "recusada" || change.status === "conflito" || change.status === "cancelada") {
      updated = change;
      return;
    }
    const recSnap = change.linkId ? await txGetOwn(tx, licenseRef(change.linkId)) : null;
    const record = recSnap ? (recSnap.data() as unknown as ErpLicenseRecord) : null;
    const patch: Partial<ErpChangeRequest> = {
      status: status === "falhou" ? "falhou" : status,
      result,
      attempts: change.attempts + 1,
      nextAttemptAt: null,
      lastError: status === "falhou" ? { code: `status_${data.status}`, message: `O ERP respondeu "${data.status}".`, kind: "rejected", retryable: false, requestId, at } : null,
      requestIds: requestId ? [...change.requestIds, requestId] : change.requestIds,
      updatedAt: at,
    };
    tx.update(changeRef(id), patch as Record<string, unknown>);
    if (record && change.linkId) {
      const recPatch: Partial<ErpLicenseRecord> = { updatedAt: at };
      if (record.openChangeId === id && status !== "falhou") recPatch.openChangeId = null;
      if (status === "aplicada" && change.snapshot) {
        recPatch.current = change.snapshot;
        recPatch.appliedVersion = Math.max(record.appliedVersion, change.snapshot.licenseVersion);
        recPatch.appliedAt = at;
      }
      if (status === "conflito") recPatch.issuedVersion = Math.max(record.issuedVersion, data.appliedVersion ?? 0);
      tx.update(licenseRef(change.linkId), recPatch as Record<string, unknown>);
    }
    updated = { ...change, ...patch } as ErpChangeRequest;
    transitioned = true;
  });
  const out = updated as ErpChangeRequest | null;
  if (!out) throw new ErpChangeBlocked("Alteração não encontrada.", "nao_encontrada");
  if (transitioned) await recordOutcome(out);
  return out;
}

async function failed(id: string, error: ErpChangeError): Promise<ErpChangeRequest> {
  let updated: ErpChangeRequest | null = null;
  let first = false;
  await docdb.runTransaction(async (tx) => {
    const snap = await txGetOwn(tx, changeRef(id));
    const change = snap ? ({ ...(snap.data() as unknown as ErpChangeRequest), id } as ErpChangeRequest) : null;
    if (!change) return;
    if (change.status !== "enviando" && change.status !== "falhou") {
      updated = change;
      return;
    }
    const attempts = change.attempts + 1;
    const auto = error.retryable && attempts < MAX_AUTO_ATTEMPTS;
    const wait = RETRY_MINUTES[Math.min(attempts - 1, RETRY_MINUTES.length - 1)] * 60_000;
    const patch: Partial<ErpChangeRequest> = {
      status: "falhou",
      attempts,
      lastError: error,
      nextAttemptAt: auto ? new Date(Date.parse(error.at) + wait).toISOString() : null,
      requestIds: error.requestId ? [...change.requestIds, error.requestId] : change.requestIds,
      updatedAt: error.at,
    };
    tx.update(changeRef(id), patch as Record<string, unknown>);
    updated = { ...change, ...patch } as ErpChangeRequest;
    first = change.attempts === 0;
  });
  const out = updated as ErpChangeRequest | null;
  if (!out) throw new ErpChangeBlocked("Alteração não encontrada.", "nao_encontrada");
  if (first) await recordOutcome(out);
  return out;
}

/** Linha do histórico do cliente para o resultado (aplicada, recusada, conflito ou primeira falha). */
async function recordOutcome(change: ErpChangeRequest): Promise<void> {
  try {
    const loaded = await getCurrentCatalog(change.environment);
    const nameOf = (code: string) => `${code} ${loaded?.index.byCode.get(code)?.name ?? ""}`.trim();
    const label = (state: string | null) => (state ? (ERP_ITEM_STATE_LABELS as Record<string, string>)[state] ?? state : "Não contratado");
    const changes: Record<string, { from: string; to: string }> = Object.fromEntries(change.plan.map((p) => [nameOf(p.code), { from: label(p.from), to: label(p.to) }]));
    // exibição do desligado (fase A): entra na linha do tempo como as unidades, com o texto da revisão
    const displayChanges = change.displayChanges ?? [];
    for (const d of displayChanges) {
      const { what, from, to } = displayChangeParts(d, d.code ? (loaded?.index.byCode.get(d.code)?.name ?? null) : null);
      changes[`Exibição · ${what}`] = { from, to };
    }
    if (change.controlMode) changes["Modo de controle no ERP"] = { from: "—", to: change.controlMode };
    const applied = change.status === "aplicada";
    const counts = [
      change.plan.length ? `${change.plan.length} ${change.plan.length === 1 ? "item" : "itens"}` : null,
      displayChanges.length ? `${displayChanges.length} de exibição` : null,
      change.controlMode ? "modo de controle" : null,
    ].filter(Boolean);
    await emitEvent({
      type: applied ? "erp.license_changed" : "erp.license_failed",
      actor: change.approval && !change.approval.self ? change.approval.by : change.requestedBy,
      clientId: change.clientId,
      entity: { type: "erp_change", id: change.id },
      title: applied
        ? `Módulos do ERP alterados (${[...counts, `versão ${change.licenseVersion}`].join(", ")})`
        : change.status === "recusada"
          ? "Alteração de módulos recusada pelo ERP"
          : change.status === "conflito"
            ? "Alteração de módulos não aplicada: outra versão já estava no ERP"
            : "Alteração de módulos aguardando sincronização com o ERP",
      description: applied ? undefined : (change.result?.rejectedItems ?? []).map((r) => r.message).join(" · ") || change.lastError?.message,
      payload: {
        changes,
        reason: change.reason,
        changeId: change.id,
        licenseVersion: change.licenseVersion,
        contractReference: change.contractReference,
        erpRequestIds: change.requestIds,
        status: change.status,
      },
    });
  } catch (error) {
    console.error("[erp] resultado gravado, mas o registro no histórico falhou", error);
  }
}

/** Aprova um desligamento que exigia aprovação e envia. */
export async function approveLicenseChange(id: string, approver: UserRef): Promise<ErpChangeRequest> {
  const change = await getChange(id);
  if (!change || change.kind !== "licenca") throw new ErpChangeBlocked("Alteração não encontrada.", "nao_encontrada");
  if (change.status !== "aguardando_aprovacao") throw new ErpChangeBlocked("Esta alteração não está aguardando aprovação.", "estado_invalido");
  if (change.requestedBy.id === approver.id) throw new ErpChangeBlocked("Quem pediu não aprova o próprio pedido: peça a outra pessoa com a permissão de aprovar.", "estado_invalido");
  const { loaded, record } = await context(change.clientId);
  // Lê o ERP de novo: a versão aplicada (para a versão nova) e, na primeira licença, o que a empresa usa AGORA (pode ter
  // mudado desde o pedido). Sem essa leitura a primeira licença não sai, como no pedido.
  const reading = change.erpCompanyId ? await readErpState(change.erpCompanyId) : null;
  const status = reading?.status ?? null;
  if (!record?.current && (!reading || reading.error)) {
    throw new ErpChangeBlocked("Não foi possível ler no ERP o que esta empresa usa hoje. A primeira licença parte dessa leitura: aprove quando o ERP responder.", "erp_indisponivel");
  }
  const base = record?.current?.items ?? baseItemsFromErp(loaded.index, reading?.runtime ?? null, reading?.status ?? null);
  const plan = planLicenseChanges(loaded.index, base, change.draft);
  // a exibição pedida sobre a que vale AGORA (outra alteração pode ter mudado depois do pedido)
  const displayPlan = planDisplayChanges(loaded.index, currentDisplay(record, status), change.displayDraft ?? null);
  plan.errors.push(...displayPlan.errors);
  if (plan.errors.length) throw new ErpChangeBlocked(plan.errors.map((e) => e.message).join(" "), "lote_invalido");
  const now = nowIso();
  // Simula de novo o que sai agora: desde o pedido, o ERP pode ter algo novo ligado só lá (o envio desligaria sem
  // ninguém ver) ou uma regra que recusaria o lote. Sem a simulação, a aprovação espera o ERP responder.
  const erpCompanyId = change.erpCompanyId as string;
  const probe = buildSnapshot({ companyId: erpCompanyId, licenseVersion: Math.max(record?.issuedVersion ?? 0, record?.appliedVersion ?? 0, status?.appliedVersion ?? 0) + 1, items: plan.items, previous: record?.current ?? null, controlMode: change.controlMode, display: displayPlan, issuedAt: now });
  let simulation: ErpChangeSimulation;
  try {
    const res = await simulateLicense(erpCompanyId, probe);
    simulation = summarizeSimulation(loaded.index, res.data, res.requestId, nowIso());
  } catch {
    throw new ErpChangeBlocked("O ERP não respondeu à simulação. Aprove quando ele responder: ela confirma o que o envio desliga agora.", "erp_indisponivel");
  }
  if (!simulation.valid) {
    const why = [...simulation.rejected.filter((r) => r.reason === "dependency_missing" || r.reason === "kind_not_supported"), ...simulation.errors].map((r) => r.message);
    throw new ErpChangeBlocked(`O ERP recusaria este lote agora: ${why.join(" ") || "regras de dependência"}. Cancele e peça de novo.`, "lote_invalido");
  }
  const known = new Set((change.erpOnlyOff ?? []).map((o) => o.module));
  const surprise = erpOnlyDisables(plan, simulation).filter((o) => !known.has(o.module));
  if (surprise.length) {
    const names = surprise.map((o) => (o.unit ? `${o.unit} ${loaded.index.byCode.get(o.unit)?.name ?? ""}`.trim() : o.name)).join(", ");
    throw new ErpChangeBlocked(`Desde o pedido, o ERP passou a ter ligado ${names}, fora do contratado no INTEROS: este envio também desligaria. Cancele e peça de novo para revisar.`, "estado_invalido");
  }
  await docdb.runTransaction(async (tx) => {
    const snap = await txGetOwn(tx, changeRef(id));
    const fresh = snap ? (snap.data() as unknown as ErpChangeRequest) : null;
    if (!fresh || fresh.status !== "aguardando_aprovacao") throw new ErpChangeBlocked("Esta alteração não está mais aguardando aprovação.", "estado_invalido");
    const recSnap = await txGetOwn(tx, licenseRef(change.linkId as string));
    const rec = recSnap ? (recSnap.data() as unknown as ErpLicenseRecord) : null;
    // o plano foi montado sobre o retrato lido acima: se outro foi aplicado entre a leitura e aqui, ele seria desfeito
    if ((rec?.current?.licenseVersion ?? 0) !== (record?.current?.licenseVersion ?? 0)) throw new ErpChangeBlocked("O ERP confirmou outra alteração desta empresa agora há pouco. Recarregue e aprove de novo.", "versao_mudou");
    const issued = rec?.issuedVersion ?? 0;
    const version = Math.max(issued, rec?.appliedVersion ?? 0, status?.appliedVersion ?? 0) + 1;
    const snapshot = buildSnapshot({ companyId: change.erpCompanyId as string, licenseVersion: version, items: plan.items, previous: rec?.current ?? null, controlMode: change.controlMode, display: displayPlan, issuedAt: now });
    tx.update(changeRef(id), { status: "enviando", approval: { by: approver, at: now, self: false }, plan: plan.changes, displayChanges: displayPlan.changes, after: plan.items, snapshot, licenseVersion: version, updatedAt: now });
    tx.update(licenseRef(change.linkId as string), { issuedVersion: version, openChangeId: id, updatedAt: now });
  });
  return sendLicenseChange(id);
}

/**
 * Cancela uma alteração que o ERP ainda não aplicou (aguardando aprovação ou aguardando sincronização). Antes confere
 * no ERP: se a versão já foi aplicada (resposta perdida), conclui como aplicada em vez de cancelar.
 */
export async function cancelLicenseChange(id: string, actor: UserRef, reason: string): Promise<ErpChangeRequest> {
  const why = reason.trim();
  if (why.length < 3) throw new ErpChangeBlocked("Informe o motivo do cancelamento.", "lote_invalido");
  const change = await getChange(id);
  if (!change) throw new ErpChangeBlocked("Alteração não encontrada.", "nao_encontrada");
  if (change.status !== "aguardando_aprovacao" && change.status !== "falhou") throw new ErpChangeBlocked("Só é possível cancelar alteração aguardando aprovação ou sincronização.", "estado_invalido");
  if (change.status === "falhou" && (await reconcileChange(change))) {
    const after = await getChange(id);
    if (after && after.status === "aplicada") throw new ErpChangeBlocked("O ERP já tinha aplicado esta alteração: ela foi concluída em vez de cancelada.", "estado_invalido");
  }
  const at = nowIso();
  let out: ErpChangeRequest | null = null;
  await docdb.runTransaction(async (tx) => {
    const snap = await txGetOwn(tx, changeRef(id));
    const fresh = snap ? ({ ...(snap.data() as unknown as ErpChangeRequest), id } as ErpChangeRequest) : null;
    if (!fresh || (fresh.status !== "aguardando_aprovacao" && fresh.status !== "falhou")) throw new ErpChangeBlocked("Esta alteração mudou de situação; recarregue.", "estado_invalido");
    // Leituras antes das escritas (regra da transação).
    const recSnap = fresh.linkId ? await txGetOwn(tx, licenseRef(fresh.linkId)) : null;
    const rec = recSnap ? (recSnap.data() as unknown as ErpLicenseRecord) : null;
    const patch = { status: "cancelada" as const, cancelled: { by: actor, at, reason: why }, nextAttemptAt: null, updatedAt: at };
    tx.update(changeRef(id), patch);
    if (fresh.linkId && rec?.openChangeId === id) tx.update(licenseRef(fresh.linkId), { openChangeId: null, updatedAt: at });
    out = { ...fresh, ...patch };
  });
  return out as unknown as ErpChangeRequest;
}

/**
 * A versão desta alteração já está aplicada no ERP (a resposta se perdeu)? Confere no histórico de licenças do ERP pelo
 * evento e conclui como aplicada. Devolve true quando concluiu.
 */
export async function reconcileChange(change: ErpChangeRequest): Promise<boolean> {
  if (!change.erpCompanyId || !change.licenseVersion || (change.status !== "enviando" && change.status !== "falhou")) return false;
  try {
    const history = await getLicenseHistory(change.erpCompanyId);
    const entry = history.find((h) => h.licenseVersion === change.licenseVersion);
    if (!entry || (entry.eventId && entry.eventId !== change.id)) return false;
    const status = String(entry.status ?? "");
    const mapped = status === "applied" ? "applied" : status === "rejected" ? "rejected" : status === "stale" ? "stale" : null;
    if (!mapped) return false;
    await finish(change.id, { status: mapped, appliedVersion: change.licenseVersion, runtimeVersion: null, rejectedItems: (entry.rejectedItems as ErpLicenseApplyResult["rejectedItems"]) ?? [], warnings: [], effective: null, nextTransitionAt: null }, null);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rotina (a cada 5 min): novas tentativas vencidas e envios interrompidos, com a mesma chave. Só alterações de licença
 * do ambiente configurado (criação de empresa é retomada pela pessoa; outro ambiente nunca é enviado a este ERP).
 * `includeUnscheduled` (reenvio manual pela administração): todas as que aguardam sincronização, agora, inclusive as
 * que pararam sem nova tentativa agendada (ex.: credencial recusada, já corrigida).
 */
export async function processPendingErpChanges(now = new Date(), max = 20, options: { includeUnscheduled?: boolean } = {}): Promise<{ attempted: number; applied: number; failed: number }> {
  const config = getErpConfig();
  if (!config?.licenseToken) return { attempted: 0, applied: 0, failed: 0 };
  const scope: [string, "==", string][] = [
    ["kind", "==", "licenca"],
    ["environment", "==", config.environment],
  ];
  const [failedList, sending] = await Promise.all([
    list<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, { where: [["status", "==", "falhou"], ...scope] }),
    list<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, { where: [["status", "==", "enviando"], ...scope] }),
  ]);
  const due = [
    ...failedList.filter((c) => options.includeUnscheduled || (c.nextAttemptAt !== null && Date.parse(c.nextAttemptAt) <= now.getTime())),
    ...sending.filter((c) => now.getTime() - Date.parse(c.lastAttemptAt ?? c.createdAt) > STUCK_SENDING_MS),
  ]
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .slice(0, max);
  let applied = 0;
  let failedCount = 0;
  for (const change of due) {
    try {
      if (await reconcileChange(change)) {
        applied += 1;
        continue;
      }
      const out = await sendLicenseChange(change.id);
      if (out.status === "aplicada") applied += 1;
      else if (out.status === "falhou") failedCount += 1;
    } catch (error) {
      failedCount += 1;
      console.error(`[erp] nova tentativa da alteração ${change.id} falhou`, error);
    }
  }
  return { attempted: due.length, applied, failed: failedCount };
}
