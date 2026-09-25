/**
 * Tipos da tela Marketing e Captação (/marketing), montados em src/server/marketing/workspace.ts.
 * Puros (sem servidor), compartilhados com os Client Components.
 */
import type { LeadSource } from "@/domain/types";
import type { LeadListItem, PeriodRange, UserOption } from "./marketing-model";

export interface WorkspaceMetric {
  /** Valor do período (fração 0–1 para taxas). null quando não há base. */
  value: number | null;
  previous: number | null;
}

export interface SourcePerformance {
  key: string;
  name: string;
  channel: LeadSource["channel"];
  leads: number;
  qualified: number;
  /** Qualificados / leads (0–1); null sem leads. */
  qualificationRate: number | null;
  /** Investimento atribuído no período (campanhas ligadas aos leads da origem). */
  spend: number;
  /** null = orgânico (sem investimento atribuído). */
  cpl: number | null;
  href: string;
}

export interface LastInteraction {
  at: string;
  channel: "whatsapp" | "ligacao" | "email" | "outro";
  direction: "entrada" | "saida";
  text?: string;
}

export interface InboxLead extends LeadListItem {
  originChannel: LeadSource["channel"];
  lastInteraction?: LastInteraction;
  /** Atividade nas últimas 24h (criação, contato ou mensagem recebida). */
  recent: boolean;
  /** Mensagem recebida ainda sem resposta. */
  awaitingReply: boolean;
  productNames: string[];
}

export interface CaptureAutomation {
  id: string;
  name: string;
  description?: string;
  /** "Lead criado → Criar tarefa, Notificar". */
  flow: string;
  triggerLabel: string;
  active: boolean;
  runCount: number;
}

export interface ProspectHighlight {
  id: string;
  name: string;
  status: "ativa" | "pausada" | "encerrada";
  segment?: string;
  objective?: string;
  startDate?: string;
  endDate?: string;
  optOut?: boolean;
  contacts: number;
  worked: number;
  interested: number;
  meetings: number;
  conversions: number;
  /** Trabalhados / contatos (0–100). */
  progress: number;
  owners: { id: string; name: string; avatarUrl?: string; jobTitle?: string }[];
}

export interface MarketingWorkspace {
  range: PeriodRange;
  previousLabel: string;
  captured: WorkspaceMetric;
  qualified: WorkspaceMetric;
  cpl: WorkspaceMetric;
  /** Leads do período que viraram oportunidade (0–1). */
  conversion: WorkspaceMetric;
  hrefs: { captured: string; qualified: string; conversion: string };
  sources: SourcePerformance[];
  inbox: InboxLead[];
  automations: CaptureAutomation[];
  canToggleAutomations: boolean;
  prospect: ProspectHighlight | null;
  otherActiveLists: number;
  sellers: UserOption[];
}

/** Abas da caixa de entrada: status do lead agrupados como na referência. */
export const INBOX_TABS = [
  { key: "todos", label: "Todos", statuses: null },
  { key: "novo", label: "Novo", statuses: ["novo"] },
  { key: "qualificacao", label: "Em qualificação", statuses: ["em_contato"] },
  { key: "qualificado", label: "Qualificado", statuses: ["qualificado", "convertido"] },
  { key: "descartado", label: "Descartado", statuses: ["desqualificado"] },
] as const;
export type InboxTab = (typeof INBOX_TABS)[number]["key"];
