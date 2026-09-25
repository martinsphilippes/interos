import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Abas da ficha. As chaves são contrato de URL usado por outros módulos (?aba=suporte, ?aba=timeline…);
 * mudam só os rótulos. "visao" é a padrão (sem ?aba).
 */
export const CLIENT_TABS = [
  { key: "visao", label: "Visão geral" },
  { key: "produtos", label: "Produtos contratados" },
  { key: "financeiro", label: "Financeiro" },
  { key: "suporte", label: "Atendimentos" },
  { key: "tarefas", label: "Tarefas" },
  { key: "timeline", label: "Histórico" },
  { key: "documentos", label: "Documentos" },
  { key: "comercial", label: "Comercial" },
  { key: "implantacao", label: "Implantação" },
  { key: "cs", label: "CS" },
] as const;

export type ClientTab = (typeof CLIENT_TABS)[number]["key"];

export function parseClientTab(raw: string | string[] | undefined): ClientTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return CLIENT_TABS.some((t) => t.key === value) ? (value as ClientTab) : "visao";
}

export interface ClientTabsProps {
  clientId: string;
  active: ClientTab;
  /** Contadores exibidos ao lado do rótulo (só quando > 0). */
  counts?: Partial<Record<ClientTab, number>>;
  className?: string;
}

/** Abas da Ficha 360º controladas pela URL (?aba=), para links diretos entre módulos. */
export function ClientTabs({ clientId, active, counts = {}, className }: ClientTabsProps) {
  return (
    <nav aria-label="Seções da ficha do cliente" className={cn("-mx-4 overflow-x-auto border-b border-border px-4 scrollbar-none md:mx-0 md:px-0", className)}>
      <ul className="flex min-w-max items-center gap-1">
        {CLIENT_TABS.map((tab) => {
          const isActive = tab.key === active;
          const count = counts[tab.key];
          return (
            <li key={tab.key}>
              <Link
                href={tab.key === "visao" ? `/clientes/${clientId}` : `/clientes/${clientId}?aba=${tab.key}`}
                aria-current={isActive ? "page" : undefined}
                scroll={false}
                className={cn(
                  "-mb-px inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[15px] font-medium transition-colors md:min-h-[44px] md:px-4",
                  isActive ? "border-brand text-brand-fg" : "border-transparent text-muted hover:text-foreground",
                )}
              >
                {tab.label}
                {count ? <span className={cn("rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums leading-none", isActive ? "bg-brand-soft text-brand-fg" : "bg-surface-hover text-muted")}>{count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
