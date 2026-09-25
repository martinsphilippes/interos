"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { MOBILE_NAV, type NavItem, type QuickAction } from "@/domain/constants";
import { NavIcon } from "./nav-icon";
import { QuickActionsSheet } from "./quick-actions-sheet";
import { cn } from "@/lib/utils";

export interface MobileNavProps {
  /** Ações do "+" já filtradas por papel. Sem ações, o botão central não aparece. */
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
export function MobileNav({ quickActions = [], className }: MobileNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const half = Math.ceil(MOBILE_NAV.length / 2);
  const left = MOBILE_NAV.slice(0, half);
  const right = MOBILE_NAV.slice(half);
  const hasActions = quickActions.length > 0;

  return (
    <>
      <nav
        aria-label="Navegação principal"
        className={cn("fixed inset-x-0 bottom-0 z-40 border-t border-sidebar-border bg-sidebar/95 backdrop-blur-md safe-bottom md:hidden", className)}
      >
        <ul className={cn("grid h-mobile-nav", hasActions ? "grid-cols-5" : "grid-cols-4")}>
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
