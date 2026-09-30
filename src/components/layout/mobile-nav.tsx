"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import type { NavItem, QuickAction } from "@/domain/constants";
import { NavIcon } from "./nav-icon";
import { QuickActionsSheet } from "./quick-actions-sheet";
import { cn } from "@/lib/utils";

export interface MobileNavProps {
  /** Itens da barra (MOBILE_NAV) já filtrados no servidor pelas permissões efetivas. */
  items: NavItem[];
  /** Ações do "+" já filtradas no servidor. Sem ações, o botão central não aparece. */
  quickActions?: QuickAction[];
  className?: string;
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
        active ? "text-brand-fg" : "text-sidebar-muted hover:text-foreground",
      )}
    >
      <NavIcon name={item.icon} className="size-[22px]" strokeWidth={active ? 2.25 : 1.9} />
      <span className="leading-none">{item.label}</span>
    </Link>
  );
}

/**
 * Barra inferior fixa (< md): Início · Tarefas · [+] · Clientes · Mais. O "+" laranja flutuante abre a
 * folha de ações rápidas. Respeita a safe-area; o AppShell reserva o espaço para o conteúdo não ficar atrás.
 */
export function MobileNav({ items, quickActions = [], className }: MobileNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const half = Math.ceil(items.length / 2);
  const left = items.slice(0, half);
  const right = items.slice(half);
  const hasActions = quickActions.length > 0;
  // Uma coluna por item visível (+ o botão central): a barra se ajusta quando um módulo está oculto.
  const columns = items.length + (hasActions ? 1 : 0);

  return (
    <>
      <nav
        aria-label="Navegação principal"
        className={cn("fixed inset-x-0 bottom-0 z-40 border-t border-sidebar-border bg-sidebar/95 backdrop-blur-md safe-bottom md:hidden", className)}
      >
        <ul className="grid h-mobile-nav" style={{ gridTemplateColumns: `repeat(${Math.max(columns, 1)}, minmax(0, 1fr))` }}>
          {left.map((item) => (
            <li key={item.href} className="flex">
              <NavLink item={item} pathname={pathname} />
            </li>
          ))}
          {hasActions ? (
            <li className="flex items-start justify-center">
              <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label="Ações rápidas"
                aria-haspopup="dialog"
                aria-expanded={open}
                className="-mt-5 inline-flex size-14 items-center justify-center rounded-full bg-brand text-white shadow-brand ring-4 ring-canvas transition-transform active:scale-95"
              >
                <Plus className="size-7" strokeWidth={2.5} />
              </button>
            </li>
          ) : null}
          {right.map((item) => (
            <li key={item.href} className="flex">
              <NavLink item={item} pathname={pathname} />
            </li>
          ))}
        </ul>
      </nav>
      {hasActions ? <QuickActionsSheet open={open} onOpenChange={setOpen} actions={quickActions} /> : null}
    </>
  );
}
