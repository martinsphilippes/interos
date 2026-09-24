import {
  AlertTriangle,
  Award,
  Bell,
  Building2,
  CheckSquare,
  Circle,
  FileSignature,
  FileText,
  GitBranch,
  Headset,
  HeartPulse,
  MapPin,
  MessageCircle,
  MessageSquare,
  Paperclip,
  Phone,
  Receipt,
  RefreshCw,
  Rocket,
  Route,
  StickyNote,
  Target,
  Timer,
  TrendingUp,
  UserPlus,
  UserRound,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { EventType } from "@/domain/constants";
import { cn } from "@/lib/utils";

/**
 * Categorias de evento para filtro e ícone na timeline. A categoria é derivada do prefixo do
 * tipo (`<entidade>.<acao>`), então tipos novos caem automaticamente na categoria da entidade.
 */
export type EventCategory =
  | "cliente"
  | "contato"
  | "nota"
  | "documento"
  | "tarefa"
  | "workflow"
  | "sla"
  | "lead"
  | "oportunidade"
  | "proposta"
  | "visita"
  | "comunicacao"
  | "contrato"
  | "financeiro"
  | "implantacao"
  | "cs"
  | "suporte"
  | "performance"
  | "automacao"
  | "outro";

export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  cliente: "Cliente",
  contato: "Contatos",
  nota: "Notas e comentários",
  documento: "Documentos",
  tarefa: "Tarefas",
  workflow: "Workflow",
  sla: "SLA",
  lead: "Lead",
  oportunidade: "Oportunidades",
  proposta: "Propostas",
  visita: "Visitas",
  comunicacao: "Ligações e WhatsApp",
  contrato: "Contratos",
  financeiro: "Financeiro",
  implantacao: "Implantação",
  cs: "Customer Success",
  suporte: "Suporte",
  performance: "Performance",
  automacao: "Automações",
  outro: "Outros",
};

const PREFIX_CATEGORY: Record<string, EventCategory> = {
  client: "cliente",
  user: "cliente",
  contact: "contato",
  note: "nota",
  comment: "nota",
  document: "documento",
  task: "tarefa",
  workflow: "workflow",
  sla: "sla",
  notification: "outro",
  lead: "lead",
  prospect: "lead",
  opportunity: "oportunidade",
  upsell: "oportunidade",
  proposal: "proposta",
  visit: "visita",
  whatsapp: "comunicacao",
  call: "comunicacao",
  contract: "contrato",
  billing: "financeiro",
  payment: "financeiro",
  financial: "financeiro",
  implementation: "implantacao",
  customer: "cs",
  success_plan: "cs",
  renewal: "cs",
  churn: "cs",
  support: "suporte",
  kpi: "performance",
  goal: "performance",
  commission: "performance",
  bonus: "performance",
  gamification: "performance",
  achievement: "performance",
  automation: "automacao",
};

export function eventCategory(type: EventType | string): EventCategory {
  const prefix = type.split(".")[0];
  return PREFIX_CATEGORY[prefix] ?? "outro";
}

const CATEGORY_ICON: Record<EventCategory, LucideIcon> = {
  cliente: Building2,
  contato: UserRound,
  nota: StickyNote,
  documento: Paperclip,
  tarefa: CheckSquare,
  workflow: GitBranch,
  sla: Timer,
  lead: UserPlus,
  oportunidade: Target,
  proposta: FileText,
  visita: MapPin,
  comunicacao: MessageCircle,
  contrato: FileSignature,
  financeiro: Receipt,
  implantacao: Rocket,
  cs: HeartPulse,
  suporte: Headset,
  performance: Award,
  automacao: Zap,
  outro: Circle,
};

/** Ícones específicos que fogem do padrão da categoria. */
const TYPE_ICON: Partial<Record<EventType, LucideIcon>> = {
  "call.completed": Phone,
  "comment.added": MessageSquare,
  "upsell.created": TrendingUp,
  "success_plan.created": Route,
  "renewal.due": RefreshCw,
  "renewal.completed": RefreshCw,
  "churn.registered": AlertTriangle,
  "customer.risk.detected": AlertTriangle,
  "notification.sent": Bell,
  "user.created": Users,
  "user.updated": Users,
};

export type EventTone = "success" | "warning" | "danger" | "info" | "brand" | "muted";

const TYPE_TONE: Partial<Record<EventType, EventTone>> = {
  "opportunity.won": "success",
  "proposal.accepted": "success",
  "contract.signed": "success",
  "payment.approved": "success",
  "financial.released": "success",
  "implementation.go_live": "success",
  "customer.activated": "success",
  "support.ticket.resolved": "success",
  "task.completed": "success",
  "workflow.stage.completed": "success",
  "workflow.completed": "success",
  "renewal.completed": "success",
  "goal.achieved": "success",
  "sla.at_risk": "warning",
  "payment.overdue": "warning",
  "payment.pending": "warning",
  "customer.risk.detected": "warning",
  "opportunity.stalled": "warning",
  "opportunity.followup_overdue": "warning",
  "implementation.waiting_client": "warning",
  "workflow.stage.blocked": "warning",
  "support.ticket.reopened": "warning",
  "sla.breached": "danger",
  "opportunity.lost": "danger",
  "proposal.rejected": "danger",
  "churn.registered": "danger",
  "workflow.gate.rejected": "danger",
  "bonus.blocked": "danger",
  "lead.disqualified": "muted",
  "note.added": "brand",
  "comment.added": "brand",
  "upsell.created": "brand",
};

export function eventTone(type: EventType | string): EventTone {
  return TYPE_TONE[type as EventType] ?? "info";
}

const toneClass: Record<EventTone, string> = {
  success: "bg-success-soft text-success-fg",
  warning: "bg-warning-soft text-warning-fg",
  danger: "bg-danger-soft text-danger-fg",
  info: "bg-info-soft text-info-fg",
  brand: "bg-brand-soft text-brand-fg",
  muted: "bg-surface-hover text-muted",
};

export interface EventIconProps {
  type: EventType | string;
  size?: "sm" | "md";
  className?: string;
}

/** Círculo com o ícone do evento, colorido pela semântica (sucesso, atenção, crítico, informação). */
export function EventIcon({ type, size = "md", className }: EventIconProps) {
  const Icon = TYPE_ICON[type as EventType] ?? CATEGORY_ICON[eventCategory(type)];
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-full", size === "sm" ? "size-7 [&_svg]:size-3.5" : "size-9 [&_svg]:size-4", toneClass[eventTone(type)], className)}
      aria-hidden
    >
      <Icon />
    </span>
  );
}
