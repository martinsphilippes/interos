"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeft, PanelLeftClose } from "lucide-react";
import { CURRENT_WAVE, type NavSection } from "@/domain/constants";
import { Tooltip } from "@/components/ui/tooltip";
import { NavIcon } from "./nav-icon";
import { UserMenu, type ShellUser } from "./user-menu";
import { cn } from "@/lib/utils";

/**
 * Item ativo = o href mais longo que é prefixo do pathname (evita "Visão Geral" /marketing
 * acender junto com /marketing/leads).
 */
export function resolveActiveHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    const match = pathname === href || pathname.startsWith(`${href}/`);
    if (match && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

export function InterosLogo({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)} aria-label="INTEROS">
      <svg viewBox="0 0 48 48" className="size-8 shrink-0" aria-hidden>
        <polygon points="24,3 42,13.5 42,34.5 24,45 6,34.5 6,13.5" fill="#F26A21" />
        <rect x="21" y="14" width="6" height="20" rx="1.2" fill="#FFFFFF" />
      </svg>
      {!collapsed ? <span className="text-[17px] font-bold tracking-[0.18em] text-white">INTEROS</span> : null}
    </span>
  );
}

export interface SidebarProps {
  user: ShellUser;
  sections: NavSection[];
  /** "desktop": fixa, colapsável · "drawer": conteúdo do menu mobile. */
  variant?: "desktop" | "drawer";
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Chamado ao clicar em um item (fecha o drawer no mobile). */
  onNavigate?: () => void;
  className?: string;
}

export function Sidebar({ user, sections, variant = "desktop", collapsed = false, onToggleCollapsed, onNavigate, className }: SidebarProps) {
  const pathname = usePathname();
  const isCollapsed = variant === "desktop" && collapsed;
  const allHrefs = React.useMemo(() => sections.flatMap((s) => s.items.map((i) => i.href)), [sections]);
  const activeHref = resolveActiveHref(pathname, allHrefs);

  return (
    <aside
      data-collapsed={isCollapsed || undefined}
      className={cn(
        "flex h-dvh flex-col bg-navy-900 text-navy-100",
        variant === "desktop" && "fixed inset-y-0 left-0 z-40 border-r border-navy-800 transition-[width] duration-200",
        variant === "desktop" && (isCollapsed ? "w-sidebar-collapsed" : "w-sidebar"),
        variant === "drawer" && "w-sidebar",
        className,
      )}
    >
      {/* Cabeçalho: logo + recolher */}
      <div className={cn("flex h-topbar shrink-0 items-center border-b border-navy-800", isCollapsed ? "justify-center px-0" : "justify-between pl-4 pr-2")}>
        <Link href="/meu-dia" onClick={onNavigate} className="rounded-md focus-visible:outline-brand">
          <InterosLogo collapsed={isCollapsed} />
        </Link>
        {variant === "desktop" && !isCollapsed ? (
          <Tooltip content="Recolher menu" side="right">
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Recolher menu"
              className="inline-flex size-8 items-center justify-center rounded-md text-navy-200 transition-colors hover:bg-navy-800 hover:text-white"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </Tooltip>
        ) : null}
      </div>

      {/* Navegação */}
      <nav aria-label="Menu principal" className="flex-1 overflow-y-auto overflow-x-hidden py-3 scrollbar-none">
        {sections.map((section, index) => (
          <div key={section.key} className={cn("px-2", index > 0 && "mt-3")}>
            {isCollapsed ? (
              index > 0 ? <div className="mx-3 mb-2 h-px bg-navy-800" aria-hidden /> : null
            ) : (
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-navy-200/70">{section.label}</p>
            )}
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active = item.href === activeHref;
                const soon = (item.wave ?? 1) > CURRENT_WAVE;
                const tooltip = isCollapsed ? (soon ? `${item.label} · em breve (onda ${item.wave})` : item.label) : soon ? `Em breve · onda ${item.wave}` : null;
                const link = (
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group/item flex min-h-[40px] items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors md:min-h-9",
                      active ? "bg-brand text-white shadow-card" : "text-navy-100 hover:bg-navy-800 hover:text-white",
                      isCollapsed && "justify-center px-0",
                    )}
                  >
                    <NavIcon name={item.icon} className={cn("size-[18px] shrink-0", active ? "text-white" : "text-navy-200 group-hover/item:text-white")} />
                    {!isCollapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
                    {!isCollapsed && soon ? (
                      <span
                        className={cn("size-1.5 shrink-0 rounded-full", active ? "bg-white/70" : "bg-navy-500")}
                        aria-label={`Em breve (onda ${item.wave})`}
                      />
                    ) : null}
                  </Link>
                );
                return (
                  <li key={item.href}>
                    {tooltip ? (
                      <Tooltip content={tooltip} side="right">
                        {link}
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Rodapé: expandir + usuário */}
      <div className={cn("shrink-0 border-t border-navy-800 p-2", variant === "drawer" && "safe-bottom")}>
        {variant === "desktop" && isCollapsed ? (
          <Tooltip content="Expandir menu" side="right">
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Expandir menu"
              className="mb-1 flex h-9 w-full items-center justify-center rounded-md text-navy-200 transition-colors hover:bg-navy-800 hover:text-white"
            >
              <PanelLeft className="size-4" />
            </button>
          </Tooltip>
        ) : null}
        <UserMenu user={user} variant="sidebar" collapsed={isCollapsed} />
      </div>
    </aside>
  );
}
