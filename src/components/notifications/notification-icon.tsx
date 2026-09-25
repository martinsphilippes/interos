import { AlertTriangle, Bell, Info, ShieldAlert, type LucideIcon } from "lucide-react";
import type { NotificationKind } from "@/domain/constants";
import { cn } from "@/lib/utils";

/** Ícone e cor por tipo: informativa azul, ação laranja, atenção âmbar, crítica vermelha. */
const KIND_STYLE: Record<NotificationKind, { icon: LucideIcon; className: string }> = {
  informativa: { icon: Info, className: "bg-info-soft text-info-fg" },
  acao: { icon: Bell, className: "bg-brand-soft text-brand-fg" },
  atencao: { icon: AlertTriangle, className: "bg-warning-soft text-warning-fg" },
  critica: { icon: ShieldAlert, className: "bg-danger-soft text-danger-fg" },
};

export function NotificationIcon({ kind, size = "md", className }: { kind: NotificationKind; size?: "sm" | "md"; className?: string }) {
  const style = KIND_STYLE[kind] ?? KIND_STYLE.informativa;
  const Icon = style.icon;
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full", size === "sm" ? "size-7 [&_svg]:size-3.5" : "size-9 [&_svg]:size-4", style.className, className)} aria-hidden>
      <Icon />
    </span>
  );
}
