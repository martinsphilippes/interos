import "server-only";
/**
 * Dados de Administração › Empresas ERP (regras em src/domain/erp/companies.ts): os vínculos ativos do ambiente
 * configurado, as licenças registradas, as alterações abertas, os clientes e os eventos recebidos do ERP. Só leituras
 * do INTEROS — nenhuma chamada ao ERP (o estado ao vivo de cada empresa fica na aba Módulos ERP do cliente).
 */
import { COLLECTIONS, type Client } from "@/domain/types";
import { ERP_ENVIRONMENT_LABELS, type ErpChangeRequest, type ErpEnvironment, type ErpLicenseRecord, type ErpLink } from "@/domain/erp/types";
import { buildErpCompanyRows, type ErpCompanyRow } from "@/domain/erp/companies";
import { getManyByIds, list, orgQuery } from "@/server/db";
import { erpIntegrationState, getErpConfig } from "./config";

/** Eventos recentes considerados para "último evento" e avisos (os mais novos; o aviso olha só 7 dias). */
const EVENTS_WINDOW = 2000;

export interface ErpUnlinkedClient {
  clientId: string;
  clientName: string;
  clientStatus: string;
}

export interface ErpCompaniesOverview {
  /** A integração com o ERP está configurada neste ambiente (endereço e ambiente). */
  configured: boolean;
  environment: ErpEnvironment | null;
  environmentLabel: string | null;
  rows: ErpCompanyRow[];
  /** Clientes ativos ou em implantação ainda sem empresa no ERP neste ambiente (para vincular ou criar). */
  unlinked: ErpUnlinkedClient[];
  /** Último evento recebido do ERP no ambiente (null = nenhum). */
  lastEventAt: string | null;
}

export async function getErpCompaniesOverview(now = new Date()): Promise<ErpCompaniesOverview> {
  const config = getErpConfig();
  const environment = erpIntegrationState(config).environment;
  const empty: ErpCompaniesOverview = { configured: false, environment: environment ?? null, environmentLabel: environment ? ERP_ENVIRONMENT_LABELS[environment] : null, rows: [], unlinked: [], lastEventAt: null };
  if (!config || !environment) return empty;

  const [links, open, eventsSnap, active] = await Promise.all([
    list<ErpLink>(COLLECTIONS.erpLinks, { where: [["environment", "==", environment], ["status", "==", "ativo"]] }),
    list<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, { where: [["environment", "==", environment], ["status", "in", ["aguardando_aprovacao", "enviando", "falhou"]]] }),
    orgQuery(COLLECTIONS.erpEvents, [["environment", "==", environment]]).orderBy("receivedAt", "desc").limit(EVENTS_WINDOW).get(),
    list<Client>(COLLECTIONS.clients, { where: [["status", "in", ["ativo", "em_implantacao"]]] }),
  ]);
  const [licenses, linkedClients] = await Promise.all([
    getManyByIds<ErpLicenseRecord>(COLLECTIONS.erpLicenses, links.map((l) => l.id)),
    getManyByIds<Client>(COLLECTIONS.clients, links.map((l) => l.clientId)),
  ]);
  const events = eventsSnap.docs
    .map((d) => d.data() as { erpCompanyId?: string; type?: string; receivedAt?: string })
    .filter((e): e is { erpCompanyId: string; type: string; receivedAt: string } => Boolean(e.erpCompanyId && e.type && e.receivedAt));
  const rows = buildErpCompanyRows({ links, licenses, openChanges: open, clients: linkedClients, events, now });
  const linked = new Set(links.map((l) => l.clientId));
  const unlinked = active
    .filter((c) => !linked.has(c.id))
    .map((c) => ({ clientId: c.id, clientName: c.tradeName || c.legalName || c.id, clientStatus: c.status }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR"));
  return { ...empty, configured: true, rows, unlinked, lastEventAt: events[0]?.receivedAt ?? null };
}
