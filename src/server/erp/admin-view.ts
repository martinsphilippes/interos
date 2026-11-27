import "server-only";
/**
 * Resumo da integração com o ERP Intercert para Administração › Integrações: APIs configuradas, catálogo vigente, as
 * alterações de módulos que ainda não terminaram (aguardando aprovação ou sincronização) e os eventos recebidos do ERP.
 */
import { COLLECTIONS, type Client } from "@/domain/types";
import type { ErpChangeRequest, ErpLink } from "@/domain/erp/types";
import { ERP_ENVIRONMENT_LABELS } from "@/domain/erp/types";
import { getManyByIds, list } from "@/server/db";
import { erpIntegrationState, getErpConfig, type ErpIntegrationState } from "./config";
import { getCurrentCatalog } from "./catalog-store";
import { getErpEventsOverview } from "./inbound";
import { ERP_EVENT_LABELS, ERP_EVENT_TYPES, type ErpEventType, type ErpInboundStatus } from "@/domain/erp/events";

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
  /** Eventos ERP → INTEROS (webhook): os últimos recebidos, sem o aviso diário de licença sem novidade. */
  events: {
    lastReceivedAt: string | null;
    staleCompanies: number;
    recent: { id: string; type: string; label: string; clientId: string | null; clientName: string | null; erpCompanyId: string; status: ErpInboundStatus; receivedAt: string; attempts: number; outcome: string | null; error: string | null }[];
  } | null;
}

export async function getErpAdminSummary(): Promise<ErpAdminSummary> {
  const config = getErpConfig();
  const integration = erpIntegrationState(config);
  const environment = integration.environment;
  const empty: ErpAdminSummary = { integration, environmentLabel: environment ? ERP_ENVIRONMENT_LABELS[environment] : null, catalog: null, linked: 0, pending: [], events: null };
  if (!config || !environment) return empty;

  const [loaded, links, open, events] = await Promise.all([
    getCurrentCatalog(environment).catch(() => null),
    list<ErpLink>(COLLECTIONS.erpLinks, { where: [["environment", "==", environment], ["status", "==", "ativo"]] }),
    list<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, { where: [["environment", "==", environment], ["status", "in", ["aguardando_aprovacao", "enviando", "falhou"]]] }),
    getErpEventsOverview(environment).catch((error) => {
      console.error("[erp] falha ao ler os eventos recebidos", error);
      return null;
    }),
  ]);
  const clientIds = [...open.map((c) => c.clientId), ...(events?.recent ?? []).map((e) => e.clientId).filter((id): id is string => Boolean(id))];
  const clients = await getManyByIds<Client>(COLLECTIONS.clients, [...new Set(clientIds)]);
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
    events: events
      ? {
          lastReceivedAt: events.lastReceivedAt,
          staleCompanies: events.staleCompanies,
          recent: events.recent.map((e) => ({
            id: e.id,
            type: e.type,
            label: (ERP_EVENT_TYPES as readonly string[]).includes(e.type) ? ERP_EVENT_LABELS[e.type as ErpEventType] : e.type,
            clientId: e.clientId,
            clientName: e.clientId ? clients.get(e.clientId)?.tradeName ?? null : null,
            erpCompanyId: e.erpCompanyId,
            status: e.status,
            receivedAt: e.receivedAt,
            attempts: e.attempts,
            outcome: e.outcome,
            error: e.error,
          })),
        }
      : null,
  };
}
