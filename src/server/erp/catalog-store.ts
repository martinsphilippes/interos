import "server-only";
/**
 * Catálogo técnico de módulos importado do ERP (`GET /api/interos/v2/catalog`). Cada versão diferente vira um registro
 * em `erp_catalogs` (com a diferença para a anterior: novos, alterados e retirados) e o ponteiro `<ambiente>__atual`
 * aponta a vigente. Módulos novos do ERP (51 em diante) entram sozinhos: nada aqui conhece códigos.
 *
 * Leitura com cache em memória por versão (o documento normalizado tem centenas de KB e muda raramente); o ponteiro é
 * relido a cada minuto. Sem catálogo importado, as telas pedem a importação (e a rotina diária tenta sozinha).
 */
import { createHash } from "node:crypto";
import { COLLECTIONS, type UserRef } from "@/domain/types";
import { catalogDiff, indexCatalog, isUnitSellable, normalizeCatalog, type ErpCatalog, type ErpCatalogIndex } from "@/domain/erp/catalog";
import type { ErpCatalogPointer, ErpCatalogRecord, ErpEnvironment } from "@/domain/erp/types";
import { create, getById, nowIso, update } from "@/server/db";
import { getErpConfig } from "./config";
import { ErpError } from "./errors";
import { erpRequest } from "./http";

export const CATALOG_PATH = "/api/interos/v2/catalog";
/** Idade a partir da qual abrir a tela dispara uma conferência do catálogo em segundo plano. */
export const CATALOG_REFRESH_MS = 6 * 60 * 60 * 1000;
const POINTER_TTL_MS = 60 * 1000;

const pointerId = (environment: ErpEnvironment) => `${environment}__atual`;

export function catalogHash(catalog: ErpCatalog): string {
  return createHash("sha256").update(JSON.stringify(catalog.items)).digest("hex");
}

export interface LoadedCatalog {
  record: Omit<ErpCatalogRecord, "items">;
  catalog: ErpCatalog;
  index: ErpCatalogIndex;
}

const byId = new Map<string, LoadedCatalog>();
let pointerCache: { environment: ErpEnvironment; value: ErpCatalogPointer | null; at: number } | null = null;

/** Esquece o cache (testes e depois de uma importação). */
export function resetCatalogCache(): void {
  byId.clear();
  pointerCache = null;
}

async function readPointer(environment: ErpEnvironment, fresh = false): Promise<ErpCatalogPointer | null> {
  if (!fresh && pointerCache && pointerCache.environment === environment && Date.now() - pointerCache.at < POINTER_TTL_MS) return pointerCache.value;
  const value = await getById<ErpCatalogPointer>(COLLECTIONS.erpCatalogs, pointerId(environment));
  pointerCache = { environment, value, at: Date.now() };
  return value;
}

async function loadRecord(id: string): Promise<LoadedCatalog | null> {
  const cached = byId.get(id);
  if (cached) return cached;
  const record = await getById<ErpCatalogRecord>(COLLECTIONS.erpCatalogs, id);
  if (!record || record.kind !== "versao") return null;
  const { items, ...meta } = record;
  const catalog: ErpCatalog = { catalogVersion: record.catalogVersion, status: record.status, product: record.product, items };
  const loaded: LoadedCatalog = { record: meta, catalog, index: indexCatalog(catalog) };
  byId.set(id, loaded);
  return loaded;
}

/** Catálogo vigente do ambiente configurado (ou null se nunca foi importado). */
export async function getCurrentCatalog(environment: ErpEnvironment | null = getErpConfig()?.environment ?? null): Promise<(LoadedCatalog & { pointer: ErpCatalogPointer }) | null> {
  if (!environment) return null;
  const pointer = await readPointer(environment);
  if (!pointer?.currentId) return null;
  const loaded = await loadRecord(pointer.currentId);
  return loaded ? { ...loaded, pointer } : null;
}

/** Uma versão específica (histórico de alterações cita a versão do catálogo da época). */
export async function getCatalogVersion(id: string): Promise<LoadedCatalog | null> {
  return loadRecord(id);
}

export interface CatalogImportResult {
  status: "nova_versao" | "sem_mudanca";
  record: Omit<ErpCatalogRecord, "items">;
}

/**
 * Busca o catálogo no ERP e grava uma versão nova se o conteúdo mudou. Idempotente: o id da versão é derivado do
 * ambiente, da versão declarada e do conteúdo, então duas importações simultâneas gravam o mesmo registro.
 */
export async function importErpCatalog(actor: UserRef | null): Promise<CatalogImportResult> {
  const config = getErpConfig();
  if (!config) throw new ErpError({ api: "licencas", status: 0, code: "not_configured", message: "Integração com o ERP não configurada.", kind: "not_configured" });
  const environment = config.environment;
  const now = nowIso();
  let response;
  try {
    response = await erpRequest<unknown>({ api: "licencas", method: "GET", path: CATALOG_PATH, retries: 2, timeoutMs: 30_000, config });
  } catch (error) {
    if (error instanceof ErpError) await savePointerError(environment, error, now);
    throw error;
  }
  let catalog: ErpCatalog;
  try {
    catalog = normalizeCatalog(response.data);
  } catch {
    const error = new ErpError({ api: "licencas", status: response.status, code: "catalogo_invalido", message: "O ERP respondeu, mas o documento não é o catálogo de módulos esperado.", requestId: response.requestId, kind: "rejected" });
    await savePointerError(environment, error, now);
    throw error;
  }
  const hash = catalogHash(catalog);
  const id = `${environment}__${catalog.catalogVersion.replace(/[^A-Za-z0-9._-]/g, "_")}__${hash.slice(0, 16)}`;
  const pointer = await readPointer(environment, true);

  if (pointer?.currentId === id) {
    await update<ErpCatalogPointer>(COLLECTIONS.erpCatalogs, pointerId(environment), { checkedAt: now, lastError: null });
    pointerCache = null;
    const current = await loadRecord(id);
    if (current) return { status: "sem_mudanca", record: current.record };
  }

  const previous = pointer?.currentId ? await loadRecord(pointer.currentId) : null;
  const units = catalog.items.filter((i) => i.unit);
  const existing = await loadRecord(id);
  if (!existing) {
    await create<ErpCatalogRecord>(
      COLLECTIONS.erpCatalogs,
      {
        kind: "versao",
        environment,
        catalogVersion: catalog.catalogVersion,
        hash,
        status: catalog.status,
        product: catalog.product,
        items: catalog.items,
        counts: {
          modules: catalog.items.filter((i) => i.level === "module").length,
          submodules: catalog.items.filter((i) => i.level === "submodule").length,
          resources: catalog.items.filter((i) => i.level === "resource").length,
          units: units.length,
          sellableUnits: units.filter(isUnitSellable).length,
        },
        importedAt: now,
        importedBy: actor,
        previousId: previous ? previous.record.id : null,
        diff: catalogDiff(previous?.catalog ?? null, catalog),
        source: { path: CATALOG_PATH, requestId: response.requestId, etag: response.etag },
      },
      id,
    );
  }
  await create<ErpCatalogPointer>(COLLECTIONS.erpCatalogs, { kind: "atual", environment, currentId: id, checkedAt: now, lastError: null }, pointerId(environment));
  pointerCache = null;
  const saved = await loadRecord(id);
  if (!saved) throw new Error("Catálogo importado não foi encontrado depois de gravado.");
  return { status: "nova_versao", record: saved.record };
}

async function savePointerError(environment: ErpEnvironment, error: ErpError, at: string): Promise<void> {
  try {
    const lastError = { code: error.code, message: error.message, at, requestId: error.requestId };
    const pointer = await readPointer(environment, true);
    if (pointer) await update<ErpCatalogPointer>(COLLECTIONS.erpCatalogs, pointerId(environment), { checkedAt: at, lastError });
    else await create<ErpCatalogPointer>(COLLECTIONS.erpCatalogs, { kind: "atual", environment, currentId: null, checkedAt: at, lastError }, pointerId(environment));
    pointerCache = null;
  } catch (cause) {
    console.error("[erp] não foi possível registrar a falha da importação do catálogo", cause);
  }
}

/** O catálogo vigente precisa de conferência (nunca importado ou conferido há mais de 6 horas). */
export function catalogNeedsRefresh(pointer: ErpCatalogPointer | null, now = Date.now()): boolean {
  if (!pointer?.currentId) return true;
  return now - Date.parse(pointer.checkedAt) > CATALOG_REFRESH_MS;
}
