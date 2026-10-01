import {
  AlertTriangle,
  Archive,
  ArrowLeftRight,
  ArchiveRestore,
  Download,
  Landmark,
  Merge,
  Tags,
  Award,
  BadgeCheck,
  BadgePercent,
  Bell,
  Building2,
  CheckSquare,
  Circle,
  CircleDollarSign,
  FileCheck2,
  FilePlus2,
  FileSignature,
  FileText,
  FileX2,
  FileDiff,
  Truck,
  GitBranch,
  Handshake,
  Link2,
  Link2Off,
  ExternalLink,
  Headset,
  HeartPulse,
  MapPin,
  MessageCircle,
  MessageSquare,
  Package,
  Paperclip,
  Phone,
  Receipt,
  RefreshCw,
  Rocket,
  Route,
  Send,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  StickyNote,
  Target,
  Timer,
  TrendingUp,
  Undo2,
  UserPlus,
  UserRound,
  Users,
  Wallet,
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
  commission_rule: "financeiro",
  payable: "financeiro",
  bonus: "performance",
  gamification: "performance",
  achievement: "performance",
  automation: "automacao",
  supplier: "financeiro",
  portal: "financeiro",
  financial_account: "financeiro",
  cost_center: "financeiro",
  finance_category: "financeiro",
  finance_registry: "financeiro",
  cash_entry: "financeiro",
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

/** Ícones específicos que fogem do padrão da categoria (marcos do circuito de receita com ícone próprio). */
const TYPE_ICON: Partial<Record<EventType, LucideIcon>> = {
  "call.completed": Phone,
  "comment.added": MessageSquare,
  "upsell.created": TrendingUp,
  "opportunity.won": Handshake,
  "contract.created": FilePlus2,
  "contract.sent_for_signature": Send,
  "contract.signed": FileCheck2,
  "contract.cancelled": FileX2,
  "contract.updated": FileDiff,
  "contract.amendment_created": FileDiff,
  "contract.amendment_sent": Send,
  "contract.amendment_signed": FileCheck2,
  "contract.amendment_applied": FileDiff,
  "contract.amendment_cancelled": FileX2,
  "contract.renewed": RefreshCw,
  "supplier.created": Truck,
  "supplier.updated": Truck,
  "billing.created": Receipt,
  "billing.updated": Receipt,
  "billing.reminder_due": Bell,
  "payment.approved": CircleDollarSign,
  "payment.reversed": Undo2,
  "payment.overdue": AlertTriangle,
  "financial.released": BadgeCheck,
  "implementation.created": Rocket,
  "commission.calculated": BadgePercent,
  "commission.released": BadgePercent,
  "commission.paid": BadgePercent,
  "commission.cancelled": BadgePercent,
  "commission.reversed": BadgePercent,
  "commission_rule.changed": BadgePercent,
  "payable.created": Wallet,
  "payable.approved": Wallet,
  "payable.scheduled": Wallet,
  "payable.paid": Wallet,
  "payable.cancelled": Wallet,
  "success_plan.created": Route,
  "renewal.due": RefreshCw,
  "renewal.completed": RefreshCw,
  "churn.registered": AlertTriangle,
  "customer.risk.detected": AlertTriangle,
  "notification.sent": Bell,
  "user.created": Users,
  "user.updated": Users,
  "permissions.updated": ShieldCheck,
  "permissions.blocked": ShieldAlert,
  "billing.cancelled": Receipt,
  "contract.pendency_resolved": BadgeCheck,
  "product.updated": Package,
  "settings.updated": Settings2,
  "portal.link_created": Link2,
  "portal.link_revoked": Link2Off,
  "portal.accessed": ExternalLink,
  "financial_account.created": Landmark,
  "financial_account.updated": Landmark,
  "financial_account.archived": Archive,
  "financial_account.reactivated": ArchiveRestore,
  "cost_center.created": Target,
  "cost_center.updated": Target,
  "cost_center.archived": Archive,
  "cost_center.reactivated": ArchiveRestore,
  "finance_category.created": Tags,
  "finance_category.updated": Tags,
  "finance_category.archived": Archive,
  "finance_category.reactivated": ArchiveRestore,
  "finance_category.merged": Merge,
  "finance_category.bulk_updated": Tags,
  "finance_registry.imported": Download,
  "cash_entry.created": ArrowLeftRight,
  "cash_entry.deleted": ArrowLeftRight,
  "payable.payment_undone": Undo2,
};

export type EventTone = "success" | "warning" | "danger" | "info" | "brand" | "muted";

const TYPE_TONE: Partial<Record<EventType, EventTone>> = {
  "opportunity.won": "success",
  "proposal.accepted": "success",
  "contract.signed": "success",
  "payment.approved": "success",
  "financial.released": "success",
  "implementation.created": "success",
  "commission.released": "success",
  "commission.paid": "success",
  "payable.paid": "success",
  "commission.cancelled": "muted",
  "commission.reversed": "danger",
  "payable.cancelled": "muted",
  "payable.payment_undone": "warning",
  "cash_entry.deleted": "muted",
  "contract.sent_for_signature": "brand",
  "implementation.go_live": "success",
  "customer.activated": "success",
  "support.ticket.resolved": "success",
  "task.completed": "success",
  "workflow.stage.completed": "success",
  "workflow.completed": "success",
  "renewal.completed": "success",
  "contract.renewed": "success",
  "contract.amendment_applied": "success",
  "contract.amendment_signed": "success",
  "contract.amendment_sent": "brand",
  "contract.amendment_cancelled": "muted",
  "goal.achieved": "success",
  "sla.at_risk": "warning",
  "payment.overdue": "warning",
  "payment.pending": "warning",
  "payment.reversed": "danger",
  "billing.reminder_due": "brand",
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
  "contract.cancelled": "danger",
  "workflow.gate.rejected": "danger",
  "bonus.blocked": "danger",
  "permissions.blocked": "danger",
  "permissions.updated": "brand",
  "billing.cancelled": "muted",
  "contract.pendency_resolved": "success",
  "contract.updated": "brand",
  "portal.link_created": "brand",
  "portal.link_revoked": "muted",
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

/** Componente de ícone do evento (para listas compactas como o TimelineList do design system). */
export function eventIconComponent(type: EventType | string): LucideIcon {
  return TYPE_ICON[type as EventType] ?? CATEGORY_ICON[eventCategory(type)];
}
