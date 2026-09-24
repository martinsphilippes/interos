/**
 * Tipos, rótulos e helpers PUROS do módulo de Marketing, compartilhados entre servidor (queries) e
 * Client Components. Sem firebase e sem React aqui.
 */
import type { Campaign, Communication, Lead, LeadStatus, LeadTemperature, Prospect, ProspectList } from "@/domain/types";
import type { DepartmentKey } from "@/domain/constants";
import { dateKey } from "@/lib/format";
import type { LeadScoreResult, MqlGateResult } from "@/server/marketing/scoring";

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  novo: "Novo",
  em_contato: "Em contato",
  qualificado: "Qualificado (MQL)",
  convertido: "Convertido",
  desqualificado: "Desqualificado",
};
/** Colunas do funil no kanban; "desqualificado" fica separado no fim. */
export const LEAD_FUNNEL: LeadStatus[] = ["novo", "em_contato", "qualificado", "convertido"];
export const LEAD_STATUSES: LeadStatus[] = [...LEAD_FUNNEL, "desqualificado"];

export const TEMPERATURE_LABELS: Record<LeadTemperature, string> = { quente: "Quente", morno: "Morno", frio: "Frio" };
export const TEMPERATURES: LeadTemperature[] = ["quente", "morno", "frio"];
/** Cores de série (paleta de dados validada) para gráficos de temperatura. */
export const TEMPERATURE_COLORS: Record<LeadTemperature, string> = { quente: "#eb6834", morno: "#eda100", frio: "#2a78d6" };

export const CAMPAIGN_STATUS_LABELS: Record<Campaign["status"], string> = { planejada: "Planejada", ativa: "Ativa", pausada: "Pausada", encerrada: "Encerrada" };
export const CAMPAIGN_CHANNELS: { value: string; label: string }[] = [
  { value: "anuncio", label: "Anúncios (Meta/Google)" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "site", label: "Site" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "E-mail marketing" },
  { value: "indicacao", label: "Indicação" },
  { value: "contador", label: "Contadores parceiros" },
  { value: "evento", label: "Evento / feira" },
  { value: "outro", label: "Outro" },
];
export function campaignChannelLabel(value: string | undefined): string {
  return CAMPAIGN_CHANNELS.find((c) => c.value === value)?.label ?? value ?? "—";
}

export const PROSPECT_STATUS_LABELS: Record<Prospect["status"], string> = {
  novo: "Novo",
  tentativa: "Em tentativa",
  contatado: "Contatado",
  respondeu: "Interessado",
  convertido: "Convertido",
  descartado: "Descartado",
};
export const PROSPECT_LIST_STATUS_LABELS: Record<ProspectList["status"], string> = { ativa: "Ativa", pausada: "Pausada", encerrada: "Encerrada" };

export const CONTACT_CHANNEL_LABELS = { ligacao: "Ligação", whatsapp: "WhatsApp", email: "E-mail" } as const;
export type ContactChannel = keyof typeof CONTACT_CHANNEL_LABELS;
export const ATTEMPT_RESULT_LABELS = { sem_resposta: "Sem resposta", respondeu: "Respondeu", interessado: "Interessado", descartado: "Descartado" } as const;
export type AttemptResult = keyof typeof ATTEMPT_RESULT_LABELS;

export const COMMUNICATION_CHANNEL_LABELS: Record<Communication["channel"], string> = { whatsapp: "WhatsApp", email: "E-mail", voip: "Ligação", interno: "Interno" };

// ---------------------------------------------------------------------------
// Período
// ---------------------------------------------------------------------------

export type PeriodKey = "mes" | "30d" | "90d" | "ano";
export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: "mes", label: "Mês atual" },
  { value: "30d", label: "Últimos 30 dias" },
  { value: "90d", label: "Últimos 90 dias" },
  { value: "ano", label: "Ano atual" },
];

export function parsePeriod(value: string | undefined | null): PeriodKey {
  return PERIOD_OPTIONS.some((p) => p.value === value) ? (value as PeriodKey) : "mes";
}

export interface PeriodRange {
  key: PeriodKey;
  label: string;
  /** Datas AAAA-MM-DD (fuso de São Paulo), inclusivas. */
  startKey: string;
  endKey: string;
  /** Agrupamento dos gráficos de evolução. */
  bucket: "dia" | "semana";
}

export function periodRange(key: PeriodKey, now: Date = new Date()): PeriodRange {
  const endKey = dateKey(now);
  const [y, m] = endKey.split("-");
  const daysBack = (n: number) => dateKey(new Date(now.getTime() - n * 86_400_000));
  const label = PERIOD_OPTIONS.find((p) => p.value === key)?.label ?? "";
  switch (key) {
    case "30d":
      return { key, label, startKey: daysBack(29), endKey, bucket: "dia" };
    case "90d":
      return { key, label, startKey: daysBack(89), endKey, bucket: "semana" };
    case "ano":
      return { key, label, startKey: `${y}-01-01`, endKey, bucket: "semana" };
    default:
      return { key: "mes", label, startKey: `${y}-${m}-01`, endKey, bucket: "dia" };
  }
}

export function inPeriod(iso: string | undefined | null, range: Pick<PeriodRange, "startKey" | "endKey">): boolean {
  if (!iso) return false;
  const key = dateKey(iso);
  return key >= range.startKey && key <= range.endKey;
}

// ---------------------------------------------------------------------------
// Filtros de leads (URL)
// ---------------------------------------------------------------------------

export type LeadSort = "score" | "data";
export type LeadView = "lista" | "kanban";

export interface LeadFilters {
  q?: string;
  status?: LeadStatus[];
  temperature?: LeadTemperature;
  origin?: string;
  campaignId?: string;
  /** Id do responsável ou "nenhum" (sem responsável). */
  ownerId?: string;
  period?: PeriodKey;
  /** Data usada pelo filtro de período: criação (padrão) ou qualificação (MQLs). */
  dateField?: "criacao" | "qualificacao";
  noContact?: boolean;
  possibleDuplicate?: boolean;
  /** Próxima ação vencida ou sem responsável (tabela "precisam de ação"). */
  needsAction?: boolean;
  sort?: LeadSort;
  view?: LeadView;
}

type RawParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseLeadFilters(params: RawParams): LeadFilters {
  const status = first(params.status)
    ?.split(",")
    .filter((s): s is LeadStatus => (LEAD_STATUSES as string[]).includes(s));
  const temperature = first(params.temperatura);
  const period = first(params.periodo);
  return {
    q: first(params.q)?.trim() || undefined,
    status: status && status.length > 0 ? status : undefined,
    temperature: TEMPERATURES.includes(temperature as LeadTemperature) ? (temperature as LeadTemperature) : undefined,
    origin: first(params.origem) || undefined,
    campaignId: first(params.campanha) || undefined,
    ownerId: first(params.responsavel) || undefined,
    period: period ? parsePeriod(period) : undefined,
    dateField: first(params.data) === "qualificacao" ? "qualificacao" : undefined,
    noContact: first(params.semContato) === "1" || undefined,
    possibleDuplicate: first(params.duplicidade) === "1" || undefined,
    needsAction: first(params.acao) === "1" || undefined,
    sort: first(params.ordenar) === "data" ? "data" : undefined,
    view: first(params.view) === "kanban" ? "kanban" : undefined,
  };
}

/** Serializa filtros para a URL de /marketing/leads (drill-down dos indicadores). */
export function leadsHref(filters: LeadFilters): string {
  const p = new URLSearchParams();
  if (filters.q) p.set("q", filters.q);
  if (filters.status?.length) p.set("status", filters.status.join(","));
  if (filters.temperature) p.set("temperatura", filters.temperature);
  if (filters.origin) p.set("origem", filters.origin);
  if (filters.campaignId) p.set("campanha", filters.campaignId);
  if (filters.ownerId) p.set("responsavel", filters.ownerId);
  if (filters.period) p.set("periodo", filters.period);
  if (filters.dateField === "qualificacao") p.set("data", "qualificacao");
  if (filters.noContact) p.set("semContato", "1");
  if (filters.possibleDuplicate) p.set("duplicidade", "1");
  if (filters.needsAction) p.set("acao", "1");
  if (filters.sort === "data") p.set("ordenar", "data");
  if (filters.view === "kanban") p.set("view", "kanban");
  const qs = p.toString();
  return qs ? `/marketing/leads?${qs}` : "/marketing/leads";
}

// ---------------------------------------------------------------------------
// Tipos de visão (servidor → cliente)
// ---------------------------------------------------------------------------

export interface UserOption {
  id: string;
  name: string;
  avatarUrl?: string;
  departmentId?: DepartmentKey;
}

export interface MarketingOptions {
  users: UserOption[];
  sellers: UserOption[];
  sources: { key: string; name: string }[];
  campaigns: { id: string; name: string; status: Campaign["status"] }[];
  products: { id: string; name: string; category: string }[];
}

export interface LeadListItem extends Lead {
  ownerName?: string;
  campaignName?: string;
  originName: string;
  possibleDuplicate: boolean;
  /** Nunca contatado e criado há mais de 24h. */
  noContact: boolean;
  /** Próxima ação vencida. */
  overdue: boolean;
}

export interface LeadListResult {
  items: LeadListItem[];
  total: number;
  countsByStatus: Record<LeadStatus, number>;
}

export interface LeadTimelineItem {
  id: string;
  type: string;
  title: string;
  description?: string;
  actorName: string;
  occurredAt: string;
}

export interface LeadDetail {
  lead: LeadListItem;
  score: LeadScoreResult;
  gate: MqlGateResult;
  duplicates: { id: string; name: string; company?: string; status: LeadStatus; reasons: string[] }[];
  duplicateOf?: { id: string; name: string; company?: string };
  client?: { id: string; tradeName: string; status: string };
  opportunity?: { id: string; title: string; stage: string; ownerName?: string };
  history: LeadTimelineItem[];
}

export interface OverviewStat {
  value: number;
  href: string;
}

export interface MarketingOverview {
  range: PeriodRange;
  leads: OverviewStat;
  mqls: OverviewStat;
  disqualified: OverviewStat;
  /** Frações 0–1 (null quando não há base). */
  leadToMql: number | null;
  leadToMqlHref: string;
  mqlToOpportunity: number | null;
  mqlToOpportunityHref: string;
  investment: number;
  cpl: number | null;
  noContact24h: OverviewStat;
  byOrigin: { key: string; name: string; leads: number; href: string }[];
  byCampaign: { id: string; name: string; leads: number; href: string }[];
  byTemperature: { key: LeadTemperature; name: string; leads: number; href: string }[];
  evolution: { key: string; label: string; leads: number; mqls: number }[];
  needsAction: (LeadListItem & { reasons: string[] })[];
}

export interface CampaignRow extends Campaign {
  ownerName?: string;
  leads: number;
  mqls: number;
  cpl: number | null;
  conversion: number | null;
}

export interface ProspectListRow extends ProspectList {
  ownerName?: string;
  campaignName?: string;
  computed: ProspectList["totals"] & { pending: number; converted: number };
}

export interface ProspectRowItem extends Prospect {
  ownerName?: string;
  overdue: boolean;
}

export interface ProspectListDetail {
  list: ProspectListRow;
  prospects: ProspectRowItem[];
  dashboard: { contacts: number; attempts: number; reached: number; responses: number; opportunities: number; leads: number; conversion: number | null; responseRate: number | null };
  byOwner: { ownerId: string; ownerName: string; contacts: number; attempts: number; responses: number; conversions: number; conversion: number | null }[];
}

export interface InboxMessage {
  id: string;
  channel: Communication["channel"];
  body?: string;
  receivedAt: string;
  clientId?: string;
  clientName?: string;
  leadId?: string;
  leadName?: string;
  from?: string;
  assigneeId?: string;
  assigneeName?: string;
  replied: boolean;
}

export interface InboxData {
  messages: InboxMessage[];
  newLeads: LeadListItem[];
}
