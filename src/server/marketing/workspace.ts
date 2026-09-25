import "server-only";
/**
 * Leitura da tela Marketing e Captação (/marketing, referência 01): indicadores com variação vs. o
 * período anterior, origem e desempenho por canal, caixa de entrada de leads com a última interação,
 * automações de captação e a lista de prospecção ativa em destaque. Tudo agregado em memória a partir
 * das coleções da organização.
 */
import { list } from "@/server/db";
import { canAccessModule } from "@/server/auth/session";
import { eventTypeLabel } from "@/domain/event-labels";
import { COLLECTIONS, type AutomationRule, type Campaign, type Communication, type CurrentUser, type DomainEvent, type LeadSource, type Product, type Prospect, type ProspectList, type User } from "@/domain/types";
import { dateKey, formatDateKey } from "@/lib/format";
import { inPeriod, leadsHref, periodRange, type PeriodKey, type UserOption } from "@/components/marketing/marketing-model";
import type { CaptureAutomation, InboxLead, LastInteraction, MarketingWorkspace, ProspectHighlight, SourcePerformance } from "@/components/marketing/workspace-model";
import { campaignSpendInPeriod, loadEnrichedLeads } from "./queries";

const DAY_MS = 86_400_000;

function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Período imediatamente anterior com o mesmo número de dias. */
function previousRange(startKey: string, endKey: string): { startKey: string; endKey: string } {
  const days = Math.round((Date.parse(`${endKey}T00:00:00Z`) - Date.parse(`${startKey}T00:00:00Z`)) / DAY_MS) + 1;
  const prevEnd = shiftKey(startKey, -1);
  return { startKey: shiftKey(prevEnd, -(days - 1)), endKey: prevEnd };
}

/** Gatilhos que caracterizam uma automação de captação. */
const CAPTURE_EVENTS = new Set(["lead.created", "lead.updated", "lead.qualified", "lead.disqualified", "lead.contacted", "whatsapp.message.received", "prospect.contacted"]);
const ACTION_LABELS: Record<AutomationRule["actions"][number]["type"], string> = {
  criar_tarefa: "Criar tarefa",
  notificar: "Notificar",
  mudar_status: "Mudar status",
  iniciar_sla: "Iniciar SLA",
  criar_handoff: "Distribuir para vendas",
  criar_plano_sucesso: "Plano de sucesso",
  webhook: "Webhook",
};

function isCaptureRule(rule: AutomationRule): boolean {
  const t = rule.trigger;
  if (t.type === "evento") return Boolean(t.eventType && CAPTURE_EVENTS.has(t.eventType));
  return t.entity === "lead" || Boolean(t.sweep && t.sweep.includes("lead"));
}

function toAutomation(rule: AutomationRule): CaptureAutomation {
  const t = rule.trigger;
  const triggerLabel = t.type === "evento" ? (t.eventType ? eventTypeLabel(t.eventType) : "Evento") : "Varredura de leads";
  const actions = Array.from(new Set(rule.actions.map((a) => ACTION_LABELS[a.type] ?? a.type)));
  return { id: rule.id, name: rule.name, description: rule.description, triggerLabel, flow: `${triggerLabel} → ${actions.join(", ") || "sem ação"}`, active: rule.active, runCount: rule.runCount ?? 0 };
}

const COMM_CHANNEL: Record<Communication["channel"], LastInteraction["channel"]> = { whatsapp: "whatsapp", voip: "ligacao", email: "email", interno: "outro" };

export async function getMarketingWorkspace(user: CurrentUser, period: PeriodKey): Promise<MarketingWorkspace> {
  const range = periodRange(period);
  const prev = previousRange(range.startKey, range.endKey);
  const today = dateKey(new Date());
  const [leads, sources, campaigns, communications, contactEvents, rules, lists, prospects, users, products] = await Promise.all([
    loadEnrichedLeads(),
    list<LeadSource>(COLLECTIONS.leadSources),
    list<Campaign>(COLLECTIONS.campaigns),
    list<Communication>(COLLECTIONS.communications, { where: [["entityType", "==", "lead"]] }),
    list<DomainEvent>(COLLECTIONS.events, { where: [["type", "==", "lead.contacted"]] }),
    list<AutomationRule>(COLLECTIONS.automationRules),
    list<ProspectList>(COLLECTIONS.prospectLists),
    list<Prospect>(COLLECTIONS.prospects),
    list<User>(COLLECTIONS.users),
    list<Product>(COLLECTIONS.products),
  ]);
  const userById = new Map(users.map((u) => [u.id, u]));
  const productName = new Map(products.map((p) => [p.id, p.name]));
  const live = leads.filter((l) => !l.duplicateOfId);

  // -------------------------------------------------------------------------
  // Indicadores (período atual x anterior)
  // -------------------------------------------------------------------------
  const metrics = (r: { startKey: string; endKey: string }) => {
    const captured = live.filter((l) => inPeriod(l.createdAt, r));
    const qualified = live.filter((l) => inPeriod(l.qualifiedAt, r));
    const converted = captured.filter((l) => Boolean(l.opportunityId));
    const spend = campaigns.reduce((s, c) => s + campaignSpendInPeriod(c, r.startKey, r.endKey, today), 0);
    return {
      captured: captured.length,
      qualified: qualified.length,
      cpl: captured.length > 0 && spend > 0 ? spend / captured.length : null,
      conversion: captured.length > 0 ? converted.length / captured.length : null,
    };
  };
  const cur = metrics(range);
  const before = metrics(prev);

  // -------------------------------------------------------------------------
  // Desempenho por canal: investimento das campanhas rateado pelos leads de cada origem.
  // -------------------------------------------------------------------------
  const capturedNow = live.filter((l) => inPeriod(l.createdAt, range));
  const spendBySource = new Map<string, number>();
  for (const c of campaigns) {
    const spend = campaignSpendInPeriod(c, range.startKey, range.endKey, today);
    if (spend <= 0) continue;
    const campaignLeads = capturedNow.filter((l) => l.campaignId === c.id);
    if (campaignLeads.length === 0) continue;
    for (const l of campaignLeads) spendBySource.set(l.origin, (spendBySource.get(l.origin) ?? 0) + spend / campaignLeads.length);
  }
  const sourcePerf: SourcePerformance[] = sources
    .filter((s) => s.active !== false)
    .map((s) => {
      const mine = capturedNow.filter((l) => l.origin === s.key);
      const qualified = mine.filter((l) => Boolean(l.qualifiedAt)).length;
      const spend = spendBySource.get(s.key) ?? 0;
      return {
        key: s.key,
        name: s.name,
        channel: s.channel,
        leads: mine.length,
        qualified,
        qualificationRate: mine.length > 0 ? qualified / mine.length : null,
        spend,
        cpl: spend > 0 && mine.length > 0 ? spend / mine.length : null,
        href: leadsHref({ period, origin: s.key }),
      };
    })
    .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name, "pt-BR"));

  // -------------------------------------------------------------------------
  // Caixa de entrada: última interação (contato registrado ou mensagem) por lead.
  // -------------------------------------------------------------------------
  const lastByLead = new Map<string, LastInteraction>();
  const consider = (leadId: string | undefined, item: LastInteraction) => {
    if (!leadId) return;
    const current = lastByLead.get(leadId);
    if (!current || current.at < item.at) lastByLead.set(leadId, item);
  };
  for (const c of communications) consider(c.entityId, { at: c.createdAt, channel: COMM_CHANNEL[c.channel], direction: c.direction, text: c.body });
  for (const e of contactEvents) {
    if (e.entityType !== "lead") continue;
    const ch = String(e.payload?.channel ?? "");
    consider(e.entityId, { at: e.occurredAt, channel: ch === "whatsapp" ? "whatsapp" : ch === "ligacao" ? "ligacao" : ch === "email" ? "email" : "outro", direction: "saida", text: e.description });
  }
  const sourceChannel = new Map(sources.map((s) => [s.key, s.channel]));
  const dayAgo = new Date(Date.now() - DAY_MS).toISOString();
  const inbox: InboxLead[] = live
    .map((l) => {
      const last = lastByLead.get(l.id);
      const recentAt = [l.createdAt, l.lastContactAt, last?.at].filter(Boolean).sort().pop() ?? l.createdAt;
      return {
        ...l,
        originChannel: sourceChannel.get(l.origin) ?? "manual",
        lastInteraction: last,
        recent: recentAt >= dayAgo,
        awaitingReply: last?.direction === "entrada",
        productNames: (l.productInterestIds ?? []).map((id) => productName.get(id)).filter((n): n is string => Boolean(n)),
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // -------------------------------------------------------------------------
  // Prospecção ativa em destaque: a lista ativa com mais contatos.
  // -------------------------------------------------------------------------
  const active = lists.filter((l) => l.status === "ativa");
  const byList = new Map<string, Prospect[]>();
  for (const p of prospects) byList.set(p.listId, [...(byList.get(p.listId) ?? []), p]);
  const main = [...active].sort((a, b) => (byList.get(b.id)?.length ?? 0) - (byList.get(a.id)?.length ?? 0))[0];
  let prospect: ProspectHighlight | null = null;
  if (main) {
    const ps = byList.get(main.id) ?? [];
    const worked = ps.filter((p) => (p.attempts ?? 0) > 0 || p.status !== "novo").length;
    const ownerIds = Array.from(new Set([main.ownerId, ...ps.map((p) => p.ownerId)].filter((id): id is string => Boolean(id))));
    prospect = {
      id: main.id,
      name: main.name,
      status: main.status,
      segment: main.segment,
      objective: main.objective,
      startDate: main.startDate,
      endDate: main.endDate,
      optOut: main.optOut,
      contacts: ps.length,
      worked,
      interested: ps.filter((p) => p.status === "respondeu").length,
      // Reunião = interessado com próxima ação agendada ou contato que virou oportunidade.
      meetings: ps.filter((p) => (p.status === "respondeu" && Boolean(p.nextActionAt)) || Boolean(p.opportunityId)).length,
      conversions: ps.filter((p) => p.status === "convertido").length,
      progress: ps.length > 0 ? Math.round((worked / ps.length) * 100) : 0,
      owners: ownerIds
        .map((id) => userById.get(id))
        .filter((u): u is User => Boolean(u))
        .map((u) => ({ id: u.id, name: u.name, avatarUrl: u.avatarUrl, jobTitle: u.jobTitle })),
    };
  }

  const sellers: UserOption[] = users
    .filter((u) => u.active !== false && u.departmentId === "vendas")
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map((u) => ({ id: u.id, name: u.name, avatarUrl: u.avatarUrl, departmentId: u.departmentId }));

  return {
    range,
    previousLabel: `${formatDateKey(prev.startKey, "dd/MM")} a ${formatDateKey(prev.endKey, "dd/MM")}`,
    captured: { value: cur.captured, previous: before.captured },
    qualified: { value: cur.qualified, previous: before.qualified },
    cpl: { value: cur.cpl, previous: before.cpl },
    conversion: { value: cur.conversion, previous: before.conversion },
    hrefs: {
      captured: leadsHref({ period, sort: "data" }),
      qualified: leadsHref({ period, dateField: "qualificacao" }),
      conversion: leadsHref({ period, status: ["convertido", "qualificado"] }),
    },
    sources: sourcePerf,
    inbox,
    automations: rules.filter(isCaptureRule).map(toAutomation).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "pt-BR")),
    canToggleAutomations: user.isAdmin && canAccessModule(user, "admin"),
    prospect,
    otherActiveLists: Math.max(0, active.length - 1),
    sellers,
  };
}
