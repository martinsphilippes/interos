"use client";

import { Gauge, SlidersHorizontal, Target, Timer } from "lucide-react";
import { ScreenLink } from "@/components/auth/access-provider";

const LINKS = [
  { href: "/performance/metas", label: "Metas do mês (departamento e colaborador)", icon: Target },
  { href: "/admin/indicadores", label: "Indicadores e meta padrão", icon: Gauge },
  { href: "/admin/configuracoes?aba=metas", label: "Metas de referência por departamento", icon: SlidersHorizontal },
  { href: "/admin/configuracoes?aba=sla", label: "Regras de SLA", icon: Timer },
] as const;

/**
 * Atalhos entre as telas de metas, indicadores e SLA (cada uma em um lugar do menu). A tela atual e as que o perfil não
 * vê ficam de fora.
 */
export function GoalsShortcuts({ current }: { current: (typeof LINKS)[number]["href"] }) {
  return (
    <nav aria-label="Metas, indicadores e SLA" className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {LINKS.filter((l) => l.href !== current).map((l) => (
        <ScreenLink key={l.href} href={l.href} className="inline-flex min-h-[44px] items-center gap-1.5 text-brand-fg hover:underline md:min-h-0 [&_svg]:size-4">
          <l.icon aria-hidden /> {l.label}
        </ScreenLink>
      ))}
    </nav>
  );
}
