import "server-only";
/**
 * Visão da aba "Módulos ERP" de um cliente: catálogo vigente, vínculo, licença contratada, estado lido do ERP e os três
 * estados de cada unidade. Lê o ERP com tempo limite curto (a ficha não trava com o ERP lento) e, quando a leitura
 * falha, mostra o último contratado com o aviso. Também reconcilia sozinha uma alteração cuja resposta se perdeu.
 * O resultado é serializável (vai inteiro para o componente da tela).
 */
import { after } from "next/server";
import type { ErpChangeRequest, ErpEnvironment, ErpLink } from "@/domain/erp/types";
import { ERP_ENVIRONMENT_LABELS } from "@/domain/erp/types";
import { ERP_COMMERCIAL_CLASS_LABELS, ERP_DEV_STATUS_LABELS, isUnitSellable, type ErpItemLevel, type ErpItemRole } from "@/domain/erp/catalog";
import { displayDivergences, type ErpDisplayMode, type ErpLicenseItem, type ErpUnitDisplay } from "@/domain/erp/license";
import { moduleSummary, unitStatus, type ErpRuntimeModule, type ErpUnitStatus, type ModuleSummary } from "@/domain/erp/status";
import { ERP_PACKAGES, packageUnits } from "@/domain/erp/packages";
import { erpIntegrationState, getErpConfig, type ErpIntegrationState } from "./config";
import { ErpError, erpErrorSummary } from "./errors";
import { catalogNeedsRefresh, getCurrentCatalog, importErpCatalog } from "./catalog-store";
import { getErpLink, markLinkSync } from "./links";
import { baseItemsFromErp, currentDisplay, getChange, getLicenseRecord, listClientChanges, readErpState, reconcileChange } from "./changes";
import { latestProvisioning } from "./provisioning";

/** A ficha espera o ERP no máximo isto por leitura (as duas leituras correm em paralelo). */
const PAGE_READ_TIMEOUT_MS = 8_000;

export interface ErpItemRow {
  code: string;
  level: ErpItemLevel;
  module: string;
  name: string;
  description: string | null;
  notes: string | null;
  role: ErpItemRole;
  devStatus: string;
  devStatusLabel: string;
  classLabel: string;
  available: boolean;
  sellable: boolean;
  /** Unidade que carrega o item (incluído ou duplicata). */
  owner: string | null;
  aliasOf: string | null;
  reuses: string | null;
  /** Unidades: dependências obrigatórias e quem depende desta (diretos). */
  requires: string[];
  /** Unidades: grupos "basta um" (pelo menos uma de cada grupo ligada). */
  requiresAny: string[][];
  /** Tipos de empresa a que a unidade se aplica, como o ERP informa (`retail`, `accounting`...); null = todos. */
  kinds: string[] | null;
  dependents: string[];
  optional: string[];
  v1Key: string | null;
  permissions: string[];
  routes: string[];
  status: ErpUnitStatus | null;
  /** Detalhe operacional do ERP (unidades). */
  runtime: Pick<ErpRuntimeModule, "state" | "since" | "drainUntil" | "access" | "history"> | null;
}

export interface ErpModuleRow {
  code: string;
  name: string;
  devStatus: string;
  devStatusLabel: string;
  role: ErpItemRole;
  summary: ModuleSummary;
}

export interface ErpCompanyView {
  state: "nao_configurado" | "sem_catalogo" | "sem_vinculo" | "pronto";
  environment: ErpEnvironment | null;
  environmentLabel: string | null;
  host: string | null;
  integration: Pick<ErpIntegrationState, "apis" | "missing">;
  link: ErpLink | null;
  catalog: { id: string; version: string; status: string | null; importedAt: string; checkedAt: string | null; lastError: string | null; counts: { modules: number; submodules: number; units: number; sellableUnits: number } } | null;
  catalogError: string | null;
  erp: {
    ok: boolean;
    error: { code: string; message: string; requestId: string | null } | null;
    companyName: string | null;
    kind: string | null;
    companyStatus: string | null;
    mode: string | null;
    runtimeVersion: number | null;
    appliedVersion: number | null;
    commercialStatus: string | null;
    display: string | null;
    nextTransitionAt: string | null;
    readAt: string;
  } | null;
  license: {
    issuedVersion: number;
    appliedVersion: number;
    appliedAt: string | null;
    initial: boolean;
    items: ErpLicenseItem[];
    /** Padrão da empresa para o desligado (o fixado pelo INTEROS ou, antes dele, o do ERP; null = desconhecido). */
    display: ErpDisplayMode | null;
    /** Escolhas de exibição por unidade que valem hoje. */
    displays: ErpUnitDisplay[];
    /** O padrão foi escolhido pelo INTEROS (false = é o que o ERP calcula sozinho). */
    displayFixed: boolean;
    /** O ERP aceita exibição por unidade (false = ainda não: lá vale só o padrão da empresa; null = não deu para ler). */
    displaySupported: boolean | null;
    /** Diferenças entre a exibição registrada no INTEROS e a que o ERP devolve. */
    displayDivergences: string[];
  };
  modules: ErpModuleRow[];
  items: ErpItemRow[];
  openChange: ErpChangeRequest | null;
  /** Criação da empresa no ERP pelo INTEROS (a mais recente), para acompanhar e retomar. */
  provisioning: ErpChangeRequest | null;
  history: ErpChangeRequest[] | null;
  packages: { key: string; name: string; description: string; kind: string; units: string[] }[];
}

function forScreen(change: ErpChangeRequest): ErpChangeRequest {
  // Sem o corpo enviado, o retrato inteiro e o e-mail do administrador da empresa (a tela não usa).
  return { ...change, requestBody: null, snapshot: null, provisioning: change.provisioning ? { ...change.provisioning, adminEmail: "" } : change.provisioning };
}

function blank(state: ErpCompanyView["state"], integration: ErpIntegrationState, extra: Partial<ErpCompanyView> = {}): ErpCompanyView {
  return {
    state,
    environment: integration.environment,
    environmentLabel: integration.environment ? ERP_ENVIRONMENT_LABELS[integration.environment] : null,
    host: integration.host,
    integration: { apis: integration.apis, missing: integration.missing },
    link: null,
    catalog: null,
    catalogError: null,
    erp: null,
    license: { issuedVersion: 0, appliedVersion: 0, appliedAt: null, initial: true, items: [], display: null, displays: [], displayFixed: false, displaySupported: null, displayDivergences: [] },
    modules: [],
    items: [],
    openChange: null,
    provisioning: null,
    history: null,
    packages: [],
    ...extra,
  };
}

/**
 * Monta a visão. `withHistory` só com a permissão de auditoria. Nunca lança por causa do ERP: falhas viram estados
 * da tela (não configurado, sem catálogo, ERP sem resposta).
 */
export async function getErpCompanyView(clientId: string, options: { withHistory: boolean }): Promise<ErpCompanyView> {
  const config = getErpConfig();
  const integration = erpIntegrationState(config);
  if (!config || !integration.apis.licencas.read) return blank("nao_configurado", integration);

  let loaded = await getCurrentCatalog(config.environment);
  let catalogError: string | null = null;
  if (!loaded) {
    // Primeira vez: importa já (a tela precisa do catálogo); depois, a conferência vai para segundo plano.
    try {
      await importErpCatalog(null);
      loaded = await getCurrentCatalog(config.environment);
    } catch (error) {
      catalogError = error instanceof ErpError ? erpErrorSummary(error) : error instanceof Error ? error.message : "Falha ao importar o catálogo.";
    }
  } else if (catalogNeedsRefresh(loaded.pointer)) {
    after(() => importErpCatalog(null).then(() => undefined, (error) => console.warn("[erp] conferência do catálogo em segundo plano falhou", error)));
  }
  const [link, history, provisioningChange] = await Promise.all([
    getErpLink(clientId, config.environment),
    options.withHistory ? listClientChanges(clientId) : Promise.resolve(null),
    latestProvisioning(clientId, config.environment),
  ]);
  const provisioning = provisioningChange ? forScreen(provisioningChange) : null;
  if (!loaded) return blank("sem_catalogo", integration, { catalogError, link, provisioning, history: history ? history.map(forScreen) : null });

  const { index, record: catalogRecord, pointer } = loaded;
  const catalog = {
    id: catalogRecord.id,
    version: catalogRecord.catalogVersion,
    status: catalogRecord.status,
    importedAt: catalogRecord.importedAt,
    checkedAt: pointer.checkedAt ?? null,
    lastError: pointer.lastError?.message ?? null,
    counts: { modules: catalogRecord.counts.modules, submodules: catalogRecord.counts.submodules, units: catalogRecord.counts.units, sellableUnits: catalogRecord.counts.sellableUnits },
  };
  const packages = ERP_PACKAGES.map((p) => ({ key: p.key, name: p.name, description: p.description, kind: p.kind, units: packageUnits(index, p).units }));

  let record = link ? await getLicenseRecord(link.id) : null;
  const reading = link ? await readErpState(link.erpCompanyId, PAGE_READ_TIMEOUT_MS) : null;
  let openChange = record?.openChangeId ? await getChange(record.openChangeId) : null;

  if (link && reading) {
    await markLinkSync(link, reading.error ? { ok: false, code: reading.error.code, message: reading.error.message, requestId: reading.error.requestId } : { ok: true }).catch(() => undefined);
    // Resposta perdida: o ERP já tem a versão desta alteração aplicada → conclui sem reenviar.
    if (openChange && (openChange.status === "enviando" || openChange.status === "falhou") && openChange.licenseVersion && (reading.status?.appliedVersion ?? 0) >= openChange.licenseVersion) {
      if (await reconcileChange(openChange)) {
        record = await getLicenseRecord(link.id);
        openChange = null;
      }
    }
  }
  if (openChange && !["aguardando_aprovacao", "enviando", "falhou"].includes(openChange.status)) openChange = null;

  const initial = !record?.current;
  const contracted = record?.current?.items ?? (reading ? baseItemsFromErp(index, reading.runtime, reading.status) : []);
  const contractedByCode = new Map(contracted.map((i) => [i.code, i]));
  const runtimeByKey = new Map((reading?.runtime?.modules ?? []).map((m) => [m.module, m]));
  const effective = reading?.status?.effective ?? null;
  const mode = (reading?.runtime?.mode ?? reading?.status?.runtime?.mode ?? null) as "legacy" | "shadow" | "enforced" | null;
  const openCodes = new Set(openChange?.plan.map((p) => p.code) ?? []);
  const rejectedByCode = new Map<string, string>();
  for (const r of reading?.status?.rejectedItems ?? []) rejectedByCode.set(r.code, r.message);
  const lastDone = history?.find((c) => c.status === "recusada" || c.status === "aplicada");
  if (lastDone?.status === "recusada") for (const r of lastDone.result?.rejectedItems ?? []) rejectedByCode.set(r.code, r.message);

  const statusByUnit = new Map<string, ErpUnitStatus>();
  for (const unit of index.units) {
    const runtime = unit.v1Key ? (runtimeByKey.get(unit.v1Key) ?? null) : null;
    const eff = unit.v1Key && effective ? (effective[unit.v1Key] ?? null) : null;
    statusByUnit.set(
      unit.code,
      unitStatus({
        item: unit,
        contracted: contractedByCode.get(unit.code) ?? null,
        runtime,
        effective: eff,
        mode,
        signals: {
          openChange: openChange && openCodes.has(unit.code) ? { status: openChange.status as "aguardando_aprovacao" | "enviando" | "falhou" } : null,
          rejected: rejectedByCode.get(unit.code) ?? null,
        },
      }),
    );
  }

  const items: ErpItemRow[] = index.catalog.items
    .filter((i) => i.level !== "module")
    .map((i) => {
      const role = index.roleOf(i.code);
      const runtime = i.unit && i.v1Key ? runtimeByKey.get(i.v1Key) : undefined;
      return {
        code: i.code,
        level: i.level,
        module: i.module,
        name: i.name,
        description: i.description,
        notes: i.notes,
        role,
        devStatus: i.devStatus,
        devStatusLabel: ERP_DEV_STATUS_LABELS[i.devStatus] ?? i.devStatus,
        classLabel: ERP_COMMERCIAL_CLASS_LABELS[i.commercialClass] ?? i.commercialClass,
        available: i.available,
        sellable: isUnitSellable(i),
        owner: role === "included" ? index.ownerUnitOf(i.code) : null,
        aliasOf: i.aliasOf,
        reuses: i.reuses,
        requires: i.unit ? [...index.requiredUnitsOf(i.code)] : i.requires,
        requiresAny: i.unit ? index.requiredAnyUnitsOf(i.code).map((group) => [...group]) : [],
        kinds: i.kinds,
        dependents: i.unit ? [...index.dependentUnitsOf(i.code)] : [],
        optional: i.optional,
        v1Key: i.v1Key,
        permissions: i.permissions,
        routes: i.routes,
        status: i.unit ? (statusByUnit.get(i.code) ?? null) : null,
        runtime: runtime ? { state: runtime.state, since: runtime.since ?? null, drainUntil: runtime.drainUntil ?? null, access: runtime.access ?? null, history: runtime.history ?? null } : null,
      };
    });

  const modules: ErpModuleRow[] = index.modules.map((m) => ({
    code: m.code,
    name: m.name,
    devStatus: m.devStatus,
    devStatusLabel: ERP_DEV_STATUS_LABELS[m.devStatus] ?? m.devStatus,
    role: index.roleOf(m.code),
    summary: moduleSummary(index, m.code, statusByUnit),
  }));

  // exibição: a registrada no INTEROS (ou, antes do primeiro retrato, a do ERP) e se o ERP de fato aplica a mesma
  const shownDisplay = currentDisplay(record, reading?.status ?? null);
  const displayCheck = displayDivergences(index, record?.current ?? null, reading?.status ?? null);
  const erp: ErpCompanyView["erp"] = reading
    ? {
        ok: !reading.error,
        error: reading.error ? { code: reading.error.code, message: erpErrorSummary(reading.error), requestId: reading.error.requestId } : null,
        companyName: reading.status?.companyName ?? reading.runtime?.companyName ?? null,
        kind: reading.runtime?.companyKind ?? null,
        companyStatus: reading.runtime?.companyStatus ?? null,
        mode,
        runtimeVersion: reading.runtime?.version ?? reading.status?.runtime?.version ?? null,
        appliedVersion: reading.status?.appliedVersion ?? null,
        commercialStatus: reading.status?.commercialStatus ?? null,
        display: (reading.status?.display as string | null) ?? null,
        nextTransitionAt: reading.status?.nextTransitionAt ?? null,
        readAt: new Date().toISOString(),
      }
    : null;

  return {
    ...blank(link ? "pronto" : "sem_vinculo", integration),
    // A tela não precisa do corpo enviado (dados do administrador da empresa) nem do retrato inteiro.
    ...{ openChange: openChange ? forScreen(openChange) : null, provisioning, history: history ? history.map(forScreen) : null },
    link,
    catalog,
    catalogError,
    erp,
    license: {
      issuedVersion: record?.issuedVersion ?? 0,
      appliedVersion: record?.appliedVersion ?? 0,
      appliedAt: record?.appliedAt ?? null,
      initial,
      items: contracted,
      display: shownDisplay.display,
      displays: shownDisplay.displays,
      displayFixed: shownDisplay.fixed !== null,
      displaySupported: displayCheck.supported,
      displayDivergences: displayCheck.divergences,
    },
    modules,
    items,
    packages,
  };
}
