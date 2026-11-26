import Link from "next/link";
import { Boxes, Calculator, ListTree, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductTab } from "./model";

const ITEMS: { value: ProductTab; label: string; href: string; icon: React.ReactNode }[] = [
  { value: "produtos", label: "Produtos", href: "/admin/produtos", icon: <Package /> },
  { value: "modulos", label: "Módulos do ERP", href: "/admin/produtos?aba=modulos", icon: <ListTree /> },
  { value: "pacotes", label: "Pacotes", href: "/admin/produtos?aba=pacotes", icon: <Boxes /> },
  { value: "simulador", label: "Simulador de preço", href: "/admin/produtos?aba=simulador", icon: <Calculator /> },
];

/** Abas de /admin/produtos (?aba=). Navegação real: cada aba busca os próprios dados; só aparecem as permitidas. */
export function ProductsPageTabs({ current, visible }: { current: ProductTab; visible: readonly ProductTab[] }) {
  if (visible.length <= 1) return null;
  return (
    <nav aria-label="Seções de produtos" className="mb-5 flex max-w-full items-center gap-1 overflow-x-auto border-b border-border scrollbar-none">
      {ITEMS.filter((i) => visible.includes(i.value)).map((i) => {
        const active = i.value === current;
        return (
          <Link
            key={i.value}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors [&_svg]:size-4",
              active ? "border-brand text-brand-fg" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {i.icon} {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
