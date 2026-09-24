import "server-only";
import { getById, getManyByIds, list } from "@/server/db";
import {
  COLLECTIONS,
  type Campaign,
  type Client,
  type Communication,
  type DomainEvent,
  type Lead,
  type LeadSource,
  type LeadStatus,
  type Opportunity,
  type Product,
  type Prospect,
  type ProspectList,
  type User,
} from "@/domain/types";
import { dateKey, formatDateKey } from "@/lib/format";
import {
  LEAD_STATUSES,
  TEMPERATURES,
  TEMPERATURE_LABELS,
  inPeriod,
  leadsHref,
  periodRange,
  type CampaignRow,
  type InboxData,
  type InboxMessage,
  type LeadDetail,
  type LeadFilters,
  type LeadListItem,
  type LeadListResult,
  type MarketingOptions,
  type MarketingOverview,
  type PeriodKey,
  type ProspectListDetail,
  type ProspectListRow,
  type ProspectRowItem,
  type UserOption,
} from "@/components/marketing/marketing-model";
import { computeLeadScore, evaluateMqlGate, normalize } from "./scoring";
import { getScoringRules, matchLeadDuplicates, phoneKey } from "./service";

export { computeLeadScore } from "./scoring";

/**
 * Leituras do módulo de Marketing e Prospecção. Coleções filtradas por organização (igualdade) e
 * agregadas em memória. Todo número exibido nas telas sai daqui.
 */

const DAY_MS = 86_400_000;
const OPEN_STATUSES = new Set<LeadStatus>(["novo", "em_contato"]);

function toOption(u: User): UserOption {
  return { id: u.id, name: u.name, avatarUrl: u.avatarUrl, departmentId: u.departmentId };
}

async function userMap(): Promise<Map<string, User>> {
  const users = await list<User>(COLLECTIONS.users);
  return new Map(users.map((u) => [u.id, u]));
}

// ---------------------------------------------------------------------------
// Opções de formulário
// ---------------------------------------------------------------------------

export async function getMarketingOptions(): Promise<MarketingOptions> {
  const [users, sources, campaigns, products] = await Promise.all([
    list<User>(COLLECTIONS.users),
    list<LeadSource>(COLLECTIONS.leadSources),
    list<Campaign>(COLLECTIONS.campaigns),
    list<Product>(COLLECTIONS.products),
  ]);
  const active = users.filter((u) => u.active !== false).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return {
    users: active.map(toOption),
    sellers: active.filter((u) => u.departmentId === "vendas").map(toOption),
    sources: sources
      .filter((s) => s.active !== false)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .map((s) => ({ key: s.key, name: s.name })),
    campaigns: campaigns
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
      .map((c) => ({ id: c.id, name: c.name, status: c.status })),
    products: products
      .filter((p) => p.active)
      .sort((a, b) => a.order - b.order)
      .map((p) => ({ id: p.id, name: p.name, category: p.category })),
  };
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

/** Chaves (telefone/e-mail) que aparecem em mais de um lead: base do filtro "possível duplicidade". */
function duplicateKeys(leads: Lead[]): Set<string> {
  const count = new Map<string, number>();
  const bump = (key: string) => count.set(key, (count.get(key) ?? 0) + 1);
  for (const l of leads) {
    const p = phoneKey(l.phone);
    if (p.length >= 10) bump(`p:${p}`);
    const e = normalize(l.email);
    if (e) bump(`e:${e}`);
  }
  return new Set(Array.from(count.entries()).filter(([, n]) => n > 1).map(([k]) => k));
}

function isPossibleDuplicate(lead: Lead, keys: Set<string>): boolean {
  if (lead.duplicateOfId) return false;
  const p = phoneKey(lead.phone);
  const e = normalize(lead.email);
  return (p.length >= 10 && keys.has(`p:${p}`)) || (Boolean(e) && keys.has(`e:${e}`));
}

function enrichLeads(leads: Lead[], users: Map<string, User>, campaigns: Map<string, Campaign>, sources: Map<string, string>, now = Date.now()): LeadListItem[] {
  const keys = duplicateKeys(leads);
  const nowIso = new Date(now).toISOString();
  const dayAgo = new Date(now - DAY_MS).toISOString();
  return leads.map((l) => ({
    ...l,
    productInterestIds: l.productInterestIds ?? [],
    ownerName: l.ownerId ? users.get(l.ownerId)?.name : undefined,
    campaignName: l.campaignId ? campaigns.get(l.campaignId)?.name : undefined,
    originName: sources.get(l.origin) ?? l.origin,
    possibleDuplicate: isPossibleDuplicate(l, keys),
    noContact: OPEN_STATUSES.has(l.status) && !l.lastContactAt && l.createdAt < dayAgo,
    overdue: OPEN_STATUSES.has(l.status) && Boolean(l.nextActionAt) && (l.nextActionAt as string) < nowIso,
  }));
}

async function loadEnrichedLeads(): Promise<LeadListItem[]> {
  const [leads, users, campaigns, sources] = await Promise.all([list<Lead>(COLLECTIONS.leads), userMap(), list<Campaign>(COLLECTIONS.campaigns), list<LeadSource>(COLLECTIONS.leadSources)]);
  return enrichLeads(
    leads,
    users,
    new Map(campaigns.map((c) => [c.id, c])),
    new Map(sources.map((s) => [s.key, s.name])),
  );
}

function matchesFilters(l: LeadListItem, f: LeadFilters): boolean {
  if (f.status && !f.status.includes(l.status)) return false;
  if (f.temperature && l.temperature !== f.temperature) return false;
  if (f.origin && l.origin !== f.origin) return false;
  if (f.campaignId && l.campaignId !== f.campaignId) return false;
  if (f.ownerId === "nenhum" ? Boolean(l.ownerId) : f.ownerId && l.ownerId !== f.ownerId) return false;
  if (f.period) {
    const range = periodRange(f.period);
    if (!inPeriod(f.dateField === "qualificacao" ? l.qualifiedAt : l.createdAt, range)) return false;
  }
  if (f.noContact && !l.noContact) return false;
  if (f.possibleDuplicate && !l.possibleDuplicate) return false;
  if (f.needsAction && !(OPEN_STATUSES.has(l.status) && (!l.ownerId || l.overdue))) return false;
  if (f.q) {
    const term = normalize(f.q);
    const digits = f.q.replace(/\D/g, "");
    const text = normalize([l.name, l.company, l.email, l.city, l.interest].filter(Boolean).join(" "));
    if (!text.includes(term) && !(digits.length >= 4 && (l.phone ?? "").includes(digits))) return false;
  }
  return true;
}

export async function listLeads(filters: LeadFilters = {}): Promise<LeadListResult> {
  const all = await loadEnrichedLeads();
  const items = all.filter((l) => matchesFilters(l, filters));
  if (filters.sort === "data") items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  else items.sort((a, b) => b.score - a.score || (a.createdAt < b.createdAt ? 1 : -1));
  const countsByStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
  for (const l of items) countsByStatus[l.status] += 1;
  return { items, total: items.length, countsByStatus };
}

export async function getLead(id: string): Promise<LeadDetail | null> {
  const lead = await getById<Lead>(COLLECTIONS.leads, id);
  if (!lead) return null;
  const [all, rules, events, communications, products] = await Promise.all([
    loadEnrichedLeads(),
    getScoringRules(),
    list<DomainEvent>(COLLECTIONS.events, { where: [["entityId", "==", id]] }),
    list<Communication>(COLLECTIONS.communications, { where: [["entityId", "==", id]] }),
    getManyByIds<Product>(COLLECTIONS.products, lead.productInterestIds ?? []),
  ]);
  const item = all.find((l) => l.id === id);
  if (!item) return null;

  const score = computeLeadScore({ ...lead, productCategories: Array.from(products.values()).map((p) => p.category) }, rules);
  const duplicates = matchLeadDuplicates({ phone: lead.phone, email: lead.email, company: lead.company, excludeId: lead.id }, all).map((d) => ({ id: d.id, name: d.name, company: d.company, status: d.status, reasons: d.reasons }));
  const original = lead.duplicateOfId ? all.find((l) => l.id === lead.duplicateOfId) : undefined;
  const [client, opportunity] = await Promise.all([
    lead.clientId ? getById<Client>(COLLECTIONS.clients, lead.clientId) : Promise.resolve(null),
    lead.opportunityId ? getById<Opportunity>(COLLECTIONS.opportunities, lead.opportunityId) : Promise.resolve(null),
  ]);
  const seller = opportunity ? await getById<User>(COLLECTIONS.users, opportunity.ownerId) : null;

  // Histórico: eventos do lead + comunicações registradas (as de saída já têm evento correspondente).
  const history = [
    ...events.filter((e) => e.entityType === "lead").map((e) => ({ id: e.id, type: e.type, title: e.title, description: e.description, actorName: e.actorName, occurredAt: e.occurredAt })),
    ...communications
      .filter((c) => c.entityType === "lead" && c.direction === "entrada")
      .map((c) => ({ id: c.id, type: "whatsapp.message.received", title: `Mensagem recebida (${c.channel === "email" ? "e-mail" : "WhatsApp"})`, description: c.body, actorName: lead.name, occurredAt: c.createdAt })),
  ].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));

  return {
    lead: item,
    score,
    gate: evaluateMqlGate(lead, rules),
    duplicates,
    duplicateOf: original ? { id: original.id, name: original.name, company: original.company } : undefined,
    client: client ? { id: client.id, tradeName: client.tradeName, status: client.status } : undefined,
    opportunity: opportunity ? { id: opportunity.id, title: opportunity.title, stage: opportunity.stage, ownerName: seller?.name } : undefined,
    history,
  };
}

// ---------------------------------------------------------------------------
// Visão geral
// ---------------------------------------------------------------------------

/** Investimento proporcional: gasto da campanha × fração dos dias ativos dela que cai no período. */
export function campaignSpendInPeriod(campaign: Campaign, startKey: string, endKey: string, todayKey: string): number {
  if (!campaign.spent) return 0;
  const cStart = dateKey(campaign.startDate);
  const cEnd = [campaign.endDate ? dateKey(campaign.endDate) : todayKey, todayKey].sort()[0];
  if (cEnd < cStart) return 0;
  const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS) + 1;
  const overlapStart = cStart > startKey ? cStart : startKey;
  const overlapEnd = cEnd < endKey ? cEnd : endKey;
  if (overlapEnd < overlapStart) return 0;
  return (campaign.spent * days(overlapStart, overlapEnd)) / days(cStart, cEnd);
}

function weekStartKey(key: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  const weekday = (d.getUTCDay() + 6) % 7; // segunda = 0
  return new Date(d.getTime() - weekday * DAY_MS).toISOString().slice(0, 10);
}

export async function getMarketingOverview(period: PeriodKey): Promise<MarketingOverview> {
  const range = periodRange(period);
  const [leads, campaigns] = await Promise.all([loadEnrichedLeads(), list<Campaign>(COLLECTIONS.campaigns)]);
  const today = dateKey(new Date());

  const captured = leads.filter((l) => inPeriod(l.createdAt, range));
  const mqls = leads.filter((l) => inPeriod(l.qualifiedAt, range));
  const disqualified = captured.filter((l) => l.status === "desqualificado");
  const capturedQualified = captured.filter((l) => Boolean(l.qualifiedAt));
  const mqlsWithOpp = mqls.filter((l) => Boolean(l.opportunityId));
  const investment = campaigns.reduce((sum, c) => sum + campaignSpendInPeriod(c, range.startKey, range.endKey, today), 0);
  const noContact = leads.filter((l) => l.noContact);

  const byOriginMap = new Map<string, { name: string; leads: number }>();
  const byCampaignMap = new Map<string, { name: string; leads: number }>();
  const byTemp = new Map(TEMPERATURES.map((t) => [t, 0]));
  for (const l of captured) {
    const o = byOriginMap.get(l.origin) ?? { name: l.originName, leads: 0 };
    o.leads += 1;
    byOriginMap.set(l.origin, o);
    if (l.campaignId) {
      const c = byCampaignMap.get(l.campaignId) ?? { name: l.campaignName ?? "Campanha removida", leads: 0 };
      c.leads += 1;
      byCampaignMap.set(l.campaignId, c);
    }
    byTemp.set(l.temperature, (byTemp.get(l.temperature) ?? 0) + 1);
  }

  // Evolução: um ponto por dia (mês/30d) ou por semana (90d/ano), inclusive os vazios.
  const buckets = new Map<string, { leads: number; mqls: number }>();
  const bucketOf = (key: string) => (range.bucket === "semana" ? weekStartKey(key) : key);
  for (let t = Date.parse(`${range.startKey}T12:00:00Z`); t <= Date.parse(`${range.endKey}T12:00:00Z`); t += DAY_MS) {
    const key = bucketOf(new Date(t).toISOString().slice(0, 10));
    if (!buckets.has(key)) buckets.set(key, { leads: 0, mqls: 0 });
  }
  for (const l of captured) buckets.get(bucketOf(dateKey(l.createdAt)))!.leads += 1;
  for (const l of mqls) {
    const b = buckets.get(bucketOf(dateKey(l.qualifiedAt)));
    if (b) b.mqls += 1;
  }

  const needsAction = leads
    .filter((l) => OPEN_STATUSES.has(l.status) && (!l.ownerId || l.overdue))
    .map((l) => ({
      ...l,
      reasons: [!l.ownerId ? "Sem responsável" : null, l.overdue ? "Próxima ação vencida" : null, l.noContact ? "Sem contato há mais de 24h" : null].filter((r): r is string => r !== null),
    }))
    .sort((a, b) => (a.temperature === b.temperature ? b.score - a.score : TEMPERATURES.indexOf(a.temperature) - TEMPERATURES.indexOf(b.temperature)));

  const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
  return {
    range,
    leads: { value: captured.length, href: leadsHref({ period, sort: "data" }) },
    mqls: { value: mqls.length, href: leadsHref({ period, dateField: "qualificacao" }) },
    disqualified: { value: disqualified.length, href: leadsHref({ period, status: ["desqualificado"] }) },
    leadToMql: ratio(capturedQualified.length, captured.length),
    leadToMqlHref: leadsHref({ period, status: ["qualificado", "convertido"] }),
    mqlToOpportunity: ratio(mqlsWithOpp.length, mqls.length),
    mqlToOpportunityHref: leadsHref({ period, dateField: "qualificacao" }),
    investment,
    cpl: captured.length > 0 && investment > 0 ? investment / captured.length : null,
    noContact24h: { value: noContact.length, href: leadsHref({ noContact: true }) },
    byOrigin: Array.from(byOriginMap.entries())
      .map(([key, v]) => ({ key, name: v.name, leads: v.leads, href: leadsHref({ period, origin: key }) }))
      .sort((a, b) => b.leads - a.leads),
    byCampaign: Array.from(byCampaignMap.entries())
      .map(([id, v]) => ({ id, name: v.name, leads: v.leads, href: leadsHref({ period, campaignId: id }) }))
      .sort((a, b) => b.leads - a.leads),
    byTemperature: TEMPERATURES.map((t) => ({ key: t, name: TEMPERATURE_LABELS[t], leads: byTemp.get(t) ?? 0, href: leadsHref({ period, temperature: t }) })),
    evolution: Array.from(buckets.entries()).map(([key, v]) => ({ key, label: range.bucket === "semana" ? `Sem. ${formatDateKey(key, "dd/MM")}` : formatDateKey(key, "dd/MM"), ...v })),
    needsAction,
  };
}

// ---------------------------------------------------------------------------
// Campanhas
// ---------------------------------------------------------------------------

export async function listCampaigns(): Promise<CampaignRow[]> {
  const [campaigns, leads, users] = await Promise.all([list<Campaign>(COLLECTIONS.campaigns), list<Lead>(COLLECTIONS.leads), userMap()]);
  const stats = new Map<string, { leads: number; mqls: number }>();
  for (const l of leads) {
    if (!l.campaignId) continue;
    const s = stats.get(l.campaignId) ?? { leads: 0, mqls: 0 };
    s.leads += 1;
    if (l.qualifiedAt) s.mqls += 1;
    stats.set(l.campaignId, s);
  }
  const order: Record<Campaign["status"], number> = { ativa: 0, planejada: 1, pausada: 2, encerrada: 3 };
  return campaigns
    .map((c) => {
      const s = stats.get(c.id) ?? { leads: 0, mqls: 0 };
      return {
        ...c,
        ownerName: c.ownerId ? users.get(c.ownerId)?.name : undefined,
        leads: s.leads,
        mqls: s.mqls,
        cpl: s.leads > 0 ? c.spent / s.leads : null,
        conversion: s.leads > 0 ? s.mqls / s.leads : null,
      };
    })
    .sort((a, b) => order[a.status] - order[b.status] || (a.startDate < b.startDate ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Prospecção ativa
// ---------------------------------------------------------------------------

const RESPONDED = new Set<Prospect["status"]>(["contatado", "respondeu", "convertido"]);

function computeTotals(prospects: Prospect[]): ProspectListRow["computed"] {
  return {
    contacts: prospects.length,
    attempts: prospects.reduce((s, p) => s + (p.attempts ?? 0), 0),
    responses: prospects.filter((p) => RESPONDED.has(p.status)).length,
    opportunities: prospects.filter((p) => Boolean(p.opportunityId)).length,
    pending: prospects.filter((p) => p.status === "novo" || p.status === "tentativa").length,
    converted: prospects.filter((p) => p.status === "convertido").length,
  };
}

export async function listProspectLists(): Promise<ProspectListRow[]> {
  const [lists, prospects, users, campaigns] = await Promise.all([list<ProspectList>(COLLECTIONS.prospectLists), list<Prospect>(COLLECTIONS.prospects), userMap(), list<Campaign>(COLLECTIONS.campaigns)]);
  const campaignNames = new Map(campaigns.map((c) => [c.id, c.name]));
  const byList = new Map<string, Prospect[]>();
  for (const p of prospects) byList.set(p.listId, [...(byList.get(p.listId) ?? []), p]);
  const order: Record<ProspectList["status"], number> = { ativa: 0, pausada: 1, encerrada: 2 };
  return lists
    .map((l) => ({
      ...l,
      ownerName: l.ownerId ? users.get(l.ownerId)?.name : undefined,
      campaignName: l.campaignId ? campaignNames.get(l.campaignId) : undefined,
      computed: computeTotals(byList.get(l.id) ?? []),
    }))
    .sort((a, b) => order[a.status] - order[b.status] || (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getProspectListDetail(listId: string): Promise<ProspectListDetail | null> {
  const plist = await getById<ProspectList>(COLLECTIONS.prospectLists, listId);
  if (!plist) return null;
  const [prospects, users, campaign] = await Promise.all([
    list<Prospect>(COLLECTIONS.prospects, { where: [["listId", "==", listId]] }),
    userMap(),
    plist.campaignId ? getById<Campaign>(COLLECTIONS.campaigns, plist.campaignId) : Promise.resolve(null),
  ]);
  const now = new Date().toISOString();
  const statusOrder: Record<Prospect["status"], number> = { respondeu: 0, contatado: 1, tentativa: 2, novo: 3, convertido: 4, descartado: 5 };
  const items: ProspectRowItem[] = prospects
    .map((p) => ({
      ...p,
      ownerName: p.ownerId ? users.get(p.ownerId)?.name : undefined,
      overdue: Boolean(p.nextActionAt) && (p.nextActionAt as string) < now && p.status !== "convertido" && p.status !== "descartado",
    }))
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || (a.nextActionAt ?? "9").localeCompare(b.nextActionAt ?? "9") || a.name.localeCompare(b.name, "pt-BR"));

  const totals = computeTotals(prospects);
  const reached = prospects.filter((p) => (p.attempts ?? 0) > 0).length;
  const leads = prospects.filter((p) => Boolean(p.leadId)).length;
  const byOwnerMap = new Map<string, Prospect[]>();
  for (const p of prospects) {
    const key = p.ownerId ?? "";
    byOwnerMap.set(key, [...(byOwnerMap.get(key) ?? []), p]);
  }
  const byOwner = Array.from(byOwnerMap.entries())
    .map(([ownerId, ps]) => {
      const t = computeTotals(ps);
      return { ownerId, ownerName: ownerId ? (users.get(ownerId)?.name ?? "Usuário removido") : "Sem responsável", contacts: t.contacts, attempts: t.attempts, responses: t.responses, conversions: t.converted, conversion: t.contacts > 0 ? t.converted / t.contacts : null };
    })
    .sort((a, b) => b.attempts - a.attempts);

  return {
    list: { ...plist, ownerName: plist.ownerId ? users.get(plist.ownerId)?.name : undefined, campaignName: campaign?.name, computed: totals },
    prospects: items,
    dashboard: {
      contacts: totals.contacts,
      attempts: totals.attempts,
      reached,
      responses: totals.responses,
      opportunities: totals.opportunities,
      leads,
      conversion: totals.contacts > 0 ? totals.converted / totals.contacts : null,
      responseRate: reached > 0 ? totals.responses / reached : null,
    },
    byOwner,
  };
}

// ---------------------------------------------------------------------------
// Caixa de entrada
// ---------------------------------------------------------------------------

const INBOX_DAYS = 30;
const NEW_LEAD_HOURS = 72;

export async function getInbox(): Promise<InboxData> {
  const [incoming, outgoing, leads] = await Promise.all([
    list<Communication>(COLLECTIONS.communications, { where: [["direction", "==", "entrada"]] }),
    list<Communication>(COLLECTIONS.communications, { where: [["direction", "==", "saida"]] }),
    loadEnrichedLeads(),
  ]);
  const since = new Date(Date.now() - INBOX_DAYS * DAY_MS).toISOString();
  const recent = incoming.filter((c) => (c.channel === "whatsapp" || c.channel === "email") && c.createdAt >= since).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const clientIds = recent.map((c) => c.clientId).filter((id): id is string => Boolean(id));
  const [clients, users] = await Promise.all([getManyByIds<Client>(COLLECTIONS.clients, clientIds), userMap()]);
  const leadById = new Map(leads.map((l) => [l.id, l]));

  // Respondida: marcada como lida ou com mensagem de saída posterior para o mesmo cliente/lead.
  const lastOutgoing = new Map<string, string>();
  for (const o of outgoing) {
    for (const key of [o.clientId ? `c:${o.clientId}` : null, o.entityType === "lead" && o.entityId ? `l:${o.entityId}` : null]) {
      if (key && (lastOutgoing.get(key) ?? "") < o.createdAt) lastOutgoing.set(key, o.createdAt);
    }
  }

  const messages: InboxMessage[] = recent.map((c) => {
    const lead = c.entityType === "lead" && c.entityId ? leadById.get(c.entityId) : undefined;
    const client = c.clientId ? clients.get(c.clientId) : undefined;
    const answeredAt = [c.clientId ? lastOutgoing.get(`c:${c.clientId}`) : undefined, lead ? lastOutgoing.get(`l:${lead.id}`) : undefined].filter(Boolean).sort().pop();
    return {
      id: c.id,
      channel: c.channel,
      body: c.body,
      receivedAt: c.createdAt,
      clientId: client?.id,
      clientName: client?.tradeName,
      leadId: lead?.id,
      leadName: lead?.name,
      from: lead?.phone ?? client?.whatsapp ?? client?.phone ?? lead?.email ?? client?.email,
      assigneeId: c.userId,
      assigneeName: c.userId ? users.get(c.userId)?.name : undefined,
      replied: c.status === "lida" || Boolean(answeredAt && answeredAt > c.createdAt),
    };
  });

  const newSince = new Date(Date.now() - NEW_LEAD_HOURS * 3_600_000).toISOString();
  const newLeads = leads.filter((l) => !l.ownerId && OPEN_STATUSES.has(l.status) && l.createdAt >= newSince).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { messages, newLeads };
}
