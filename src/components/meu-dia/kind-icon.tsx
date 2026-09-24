import { AlertTriangle, Building2, CalendarCheck, CheckSquare, FileSignature, GitBranch, GraduationCap, Handshake, MapPin, MessageSquareReply, RefreshCw, Rocket, Target, Ticket, Timer, UserPlus, type LucideIcon } from "lucide-react";
import type { AgendaKind, PriorityKind } from "./model";
import { cn } from "@/lib/utils";

export const PRIORITY_KIND_ICONS: Record<PriorityKind, LucideIcon> = {
  tarefa: CheckSquare,
  etapa: GitBranch,
  lead: UserPlus,
  oportunidade: Target,
  projeto: Rocket,
  chamado: Ticket,
  cliente: Building2,
  renovacao: RefreshCw,
  sla: Timer,
  retorno: MessageSquareReply,
  contrato: FileSignature,
};

const AGENDA_KIND_ICONS: Record<AgendaKind, LucideIcon> = {
  tarefa: CheckSquare,
  visita: MapPin,
  treinamento: GraduationCap,
  checkpoint: CalendarCheck,
};

/** Cor de fundo do ícone por tipo (semântica de módulo, estável entre telas). */
const KIND_TONE: Record<PriorityKind, string> = {
  tarefa: "bg-info-soft text-info-fg",
  etapa: "bg-secondary-soft text-secondary-fg",
  lead: "bg-brand-soft text-brand-fg",
  oportunidade: "bg-brand-soft text-brand-fg",
  projeto: "bg-info-soft text-info-fg",
  chamado: "bg-danger-soft text-danger-fg",
  cliente: "bg-success-soft text-success-fg",
  renovacao: "bg-warning-soft text-warning-fg",
  sla: "bg-danger-soft text-danger-fg",
  retorno: "bg-warning-soft text-warning-fg",
  contrato: "bg-accent-purple-soft text-accent-purple-fg",
};

export function KindIcon({ kind, className }: { kind: PriorityKind; className?: string }) {
  const Icon = PRIORITY_KIND_ICONS[kind] ?? AlertTriangle;
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md [&_svg]:size-4", KIND_TONE[kind], className)} aria-hidden>
      <Icon />
    </span>
  );
}

export function AgendaIcon({ kind, className }: { kind: AgendaKind; className?: string }) {
  const Icon = AGENDA_KIND_ICONS[kind] ?? Handshake;
  return <Icon className={cn("size-4 shrink-0", className)} aria-hidden />;
}
