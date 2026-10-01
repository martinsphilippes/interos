import Link from "next/link";
import { Landmark, Tags, Target } from "lucide-react";
import { cn } from "@/lib/utils";

export type RegistryTabKey = "contas" | "centros" | "categorias";

const ITEMS: { value: RegistryTabKey; label: string; short: string; icon: React.ReactNode }[] = [
  { value: "contas", label: "Contas financeiras", short: "Contas", icon: <Landmark /> },
  { value: "centros", label: "Centros de custo", short: "Centros", icon: <Target /> },
  { value: "categorias", label: "Categorias", short: "Categorias", icon: <Tags /> },
];

/** Abas da página (cada uma é uma seção do catálogo: financeiro.cadastros.<aba>.ver). */
export const REGISTRY_TABS: readonly RegistryTabKey[] = ITEMS.map((i) => i.value);

/**
 * Abas de /financeiro/cadastros (?aba=). Navegação real (cada aba busca os próprios dados no servidor); cada aba só
 * aparece para quem tem a seção correspondente (decidido no servidor).
 */
export function RegistryTabs({ current, visible }: { current: RegistryTabKey; visible: RegistryTabKey[] }) {
  if (visible.length <= 1) return null;
  return (
    <nav aria-label="Cadastros financeiros" className="mb-5 flex max-w-full items-center gap-1 overflow-x-auto border-b border-border scrollbar-none">
      {ITEMS.filter((i) => visible.includes(i.value)).map((i) => {
        const active = i.value === current;
        return (
          <Link
            key={i.value}
            href={`/financeiro/cadastros?aba=${i.value}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors md:min-h-[40px] [&_svg]:size-4",
              active ? "border-brand text-brand-fg" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {i.icon}
            <span className="sm:hidden">{i.short}</span>
            <span className="hidden sm:inline">{i.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
