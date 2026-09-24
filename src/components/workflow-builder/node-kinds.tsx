import { Bell, CircleCheck, CircleHelp, ClipboardList, Hourglass, Play, Puzzle, UserCheck, type LucideIcon } from "lucide-react";
import type { Tone } from "@/components/ui/tone";
import type { ProcessNodeType } from "@/domain/workflow-graph";

/** Identidade visual de cada tipo de bloco (paleta, canvas e minimapa usam a mesma). */
export const NODE_KINDS: Record<ProcessNodeType, { icon: LucideIcon; tone: Tone; box: string; iconBox: string }> = {
  inicio: { icon: Play, tone: "brand", box: "border-brand/70 bg-brand/20", iconBox: "bg-brand text-white" },
  tarefa: { icon: ClipboardList, tone: "info", box: "border-info/60 bg-info/15", iconBox: "bg-info text-white" },
  aprovacao: { icon: UserCheck, tone: "purple", box: "border-accent-purple/60 bg-accent-purple/15", iconBox: "bg-accent-purple text-white" },
  condicao: { icon: CircleHelp, tone: "warning", box: "border-warning/70 bg-warning/15", iconBox: "bg-warning text-canvas" },
  espera: { icon: Hourglass, tone: "purple", box: "border-accent-purple/50 bg-accent-purple/10", iconBox: "bg-accent-purple/80 text-white" },
  notificacao: { icon: Bell, tone: "secondary", box: "border-secondary/60 bg-secondary/15", iconBox: "bg-secondary text-white" },
  integracao: { icon: Puzzle, tone: "secondary", box: "border-secondary/50 bg-secondary/10", iconBox: "bg-secondary/80 text-white" },
  fim: { icon: CircleCheck, tone: "success", box: "border-success/70 bg-success/15", iconBox: "bg-success text-white" },
};

/** Cor sólida para o minimapa (SVG). */
export const NODE_MINIMAP_COLOR: Record<ProcessNodeType, string> = {
  inicio: "var(--color-brand)",
  tarefa: "var(--color-info)",
  aprovacao: "var(--color-accent-purple)",
  condicao: "var(--color-warning)",
  espera: "var(--color-accent-purple)",
  notificacao: "var(--color-secondary)",
  integracao: "var(--color-secondary)",
  fim: "var(--color-success)",
};
