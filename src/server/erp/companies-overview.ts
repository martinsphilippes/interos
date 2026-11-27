import "server-only";
/**
 * Dados de Administração › Empresas ERP (regras em src/domain/erp/companies.ts): os vínculos ativos do ambiente
 * configurado (com o último evento e o último aviso do ERP, gravados quando o evento chega), as licenças registradas,
 * as alterações abertas ou não aplicadas e os clientes. Só leituras do INTEROS, e nenhuma varredura de eventos.
 * Nenhuma chamada ao ERP: o estado ao vivo de cada empresa fica na aba Módulos ERP do cliente.
 */
import { COLLECTIONS, type Client } from "@/domain/types";
import { ERP_ENVIRONMENT_LABELS, type ErpChangeRequest, type ErpEnvironment, type ErpLicenseRecord, type ErpLink } from "@/domain/erp/types";
import { buildErpCompanyRows, type ErpCompanyRow } from "@/domain/erp/companies";
import type { DataScope } from "@/server/auth/scope";
import { getManyByIds, list } from "@/server/db";
import { scopeClients } from "@/server/clients/access";
import { erpIntegrationState, getErpConfig } from "./config";

export interface ErpUnlinkedClient {
  clientId: string;
  clientName: string;
  clientStatus: string;
  /** CNPJ ou CPF só com dígitos (para a busca). */
  document: string | null;
}

export interface ErpCompaniesOverview {
  /** A integração com o ERP está configurada neste ambiente (endereço e ambiente). */
  configured: boolean;
  environment: ErpEnvironment | null;
  environmentLabel: string | null;
  rows: ErpCompanyRow[];
  /** Clientes ativos ou em implantação ainda sem empresa no ERP neste ambiente (para vincular ou criar). */
  unlinked: ErpUnlinkedClient[];
  /** Último evento recebido do ERP no ambiente, entre as empresas da lista (null = nenhum). */
  lastEventAt: string | null;
}

/** `scope`: escopo de dados de clientes de quem vê (o administrador vê a empresa inteira). */
export async function getErpCompaniesOverview(scope: DataScope, now = new Date()): Promise<ErpCompaniesOverview> {
  const config = getErpConfig();
  const environment = erpIntegrationState(config).environment;
  const empty: ErpCompaniesOverview = { configured: false, environment: environment ?? null, environmentLabel: environment ? ERP_ENVIRONMENT_LABELS[environment] : null, rows: [], unlinked: [], lastEventAt: null };
  if (!config || !environment) return empty;

  const [links, open, notApplied, active] = await Promise.all([
    list<ErpLink>(COLLECTIONS.erpLinks, { where: [["environment", "==", environment], ["status", "==", "ativo"]] }),
    list<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, { where: [["environment", "==", environment], ["status", "in", ["aguardando_aprovacao", "enviando", "falhou"]]] }),
    list<ErpChangeRequest>(COLLECTIONS.erpChangeRequests, { where: [["environment", "==", environment], ["status", "in", ["recusada", "conflito"]]] }),
    list<Client>(COLLECTIONS.clients, { where: [["status", "in", ["ativo", "em_implantacao"]]] }),
  ]);
  // clientes lidos uma vez: os ativos já vieram; só os vinculados fora dessa lista (inativos, cancelados) são buscados
  const clients = new Map(active.map((c) => [c.id, c]));
  const missing = links.map((l) => l.clientId).filter((id) => !clients.has(id));
  const [licenses, others] = await Promise.all([getManyByIds<ErpLicenseRecord>(COLLECTIONS.erpLicenses, links.map((l) => l.id)), getManyByIds<Client>(COLLECTIONS.clients, missing)]);
  for (const [id, c] of others) clients.set(id, c);

  // escopo de dados: quem não vê a base inteira só vê as empresas dos clientes da própria carteira
  const whole = scope.kind === "empresa";
  const visible = whole ? null : new Set(scopeClients([...clients.values()], scope).map((c) => c.id));
  const seen = (clientId: string) => !visible || visible.has(clientId);

  const rows = buildErpCompanyRows({ links: links.filter((l) => seen(l.clientId)), licenses, openChanges: open, notAppliedChanges: notApplied, clients, now });
  const linked = new Set(links.map((l) => l.clientId));
  const unlinked = active
    .filter((c) => !linked.has(c.id) && seen(c.id))
    .map((c) => ({ clientId: c.id, clientName: c.tradeName || c.legalName || c.id, clientStatus: c.status, document: c.document ? c.document.replace(/\D/g, "") || null : null }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR"));
  const lastEventAt = rows.map((r) => r.lastEvent?.at ?? "").sort().pop() || null;
  return { ...empty, configured: true, rows, unlinked, lastEventAt };
}
