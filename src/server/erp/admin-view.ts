import "server-only";
/**
 * Resumo da integração com o ERP Intercert para Administração › Integrações: APIs configuradas, catálogo vigente e
 * as alterações de módulos que ainda não terminaram (aguardando aprovação ou sincronização).
 */
import { COLLECTIONS, type Client } from "@/domain/types";
import type { ErpChangeRequest, ErpLink } from "@/domain/erp/types";
import { ERP_ENVIRONMENT_LABELS } from "@/domain/erp/types";
import { getManyByIds, list } from "@/server/db";
import { erpIntegrationState, getErpConfig, type ErpIntegrationState } from "./config";
import { getCurrentCatalog } from "./catalog-store";

export interface ErpAdminSummary {
  integration: ErpIntegrationState;
  environmentLabel: string | null;
  catalog: {
    version: string;
    status: string | null;
    importedAt: string;
    checkedAt: string | null;
    lastError: string | null;
    counts: { modules: number; submodules: number; units: number; sellableUnits: number };
    /** Mudanças em relação à versão anterior (`first`: primeira importação, sem anterior). */
    diff: { first: boolean; added: { code: string; name: string }[]; addedTotal: number; changed: number; removed: number };
  } | null;
  linked: number;
  pending: { id: string; clientId: string; clientName: string; status: ErpChangeRequest["status"]; kind: ErpChangeRequest["kind"]; requestedAt: string; attempts: number; nextAttemptAt: string | null; lastError: string | null }[];
}

export async function getErpAdminSummary(): Promise<ErpAdminSummary> {
  const config = getErpConfig();
  const integration = erpIntegrationState(config);
  const environment = integration.environment;
  const empty: ErpAdminSummary = { integration, environmentLabel: environment ? ERP_ENVIRONMENT_LABELS[environment] : null, catalog: null, linked: 0, pending: [] };
  if (!config || !environment) return empty;

  const [loaded, links, open] = await Promise.all([
    getCurrentCatalog(environment).catch(() => null),
    list<ErpLink>(COLLECTIONS.erpLinks, { where: [["environment", "==", environment], ["status", "==", "ativo"]] }),
    list<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, { where: [["environment", "==", environment], ["status", "in", ["aguardando_aprovacao", "enviando", "falhou"]]] }),
  ]);
  const clients = await getManyByIds<Client>(COLLECTIONS.clients, [...new Set(open.map((c) => c.clientId))]);
  const diff = loaded?.record.diff;
  return {
    ...empty,
    catalog: loaded
      ? {
          version: loaded.record.catalogVersion,
          status: loaded.record.status,
          importedAt: loaded.record.importedAt,
          checkedAt: loaded.pointer.checkedAt ?? null,
          lastError: loaded.pointer.lastError?.message ?? null,
          counts: { modules: loaded.record.counts.modules, submodules: loaded.record.counts.submodules, units: loaded.record.counts.units, sellableUnits: loaded.record.counts.sellableUnits },
          diff: {
            first: !loaded.record.previousId,
            added: (diff?.added ?? []).slice(0, 12).map((code) => ({ code, name: loaded.index.byCode.get(code)?.name ?? code })),
            addedTotal: diff?.added.length ?? 0,
            changed: diff?.changed.length ?? 0,
            removed: diff?.removed.length ?? 0,
          },
        }
      : null,
    linked: links.length,
    pending: open
      .sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : 1))
      .slice(0, 20)
      .map((c) => ({
        id: c.id,
        clientId: c.clientId,
        clientName: clients.get(c.clientId)?.tradeName ?? c.clientId,
        status: c.status,
        kind: c.kind,
        requestedAt: c.requestedAt,
        attempts: c.attempts,
        nextAttemptAt: c.nextAttemptAt,
        lastError: c.lastError?.message ?? null,
      })),
  };
}
