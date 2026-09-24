import { Award, Flame, GraduationCap, Handshake, HeartPulse, Package, RefreshCw, Rocket, Star, Timer, TrendingUp, Trophy, Wallet, Zap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = { Award, Flame, GraduationCap, Handshake, HeartPulse, Package, RefreshCw, Rocket, Star, Timer, TrendingUp, Trophy, Wallet, Zap };

/** Ícone da medalha (nome lucide gravado em achievements.icon); desconhecido vira Award. */
export function MedalIcon({ icon, className }: { icon?: string; className?: string }) {
  const Icon = (icon && ICONS[icon]) || Award;
  return (
    <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-fg [&_svg]:size-4", className)}>
      <Icon aria-hidden />
    </span>
  );
}
