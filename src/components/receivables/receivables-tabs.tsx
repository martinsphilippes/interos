import Link from "next/link";
import { HandCoins, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

/** Abas controladas por seção (?aba=): só "avulsos"; a aba padrão (cobranças de contrato) é a própria tela. */
export const RECEIVABLES_SECTION_TABS = ["avulsos"] as const;

/**
 * Abas de /financeiro/contas-a-receber (etapa CP/CR 3): "Cobranças de contrato" (o aging de sempre, sem mudança) e
 * "Títulos avulsos" (?aba=avulsos, seção financeiro.contas-a-receber.avulsos.ver). Só aparecem para quem vê a seção.
 */
export function ReceivablesTabs({ current }: { current: "cobrancas" | "avulsos" }) {
  const items = [
    { value: "cobrancas" as const, href: "/financeiro/contas-a-receber", label: "Cobranças de contrato", short: "Cobranças", icon: <Wallet /> },
    { value: "avulsos" as const, href: "/financeiro/contas-a-receber?aba=avulsos", label: "Títulos avulsos", short: "Avulsos", icon: <HandCoins /> },
  ];
  return (
    <nav aria-label="Contas a Receber" className="mb-5 flex max-w-full items-center gap-1 overflow-x-auto border-b border-border scrollbar-none">
      {items.map((i) => {
        const active = i.value === current;
        return (
          <Link
            key={i.value}
            href={i.href}
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
