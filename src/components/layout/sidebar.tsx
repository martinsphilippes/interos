"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronsLeft, ChevronsRight } from "lucide-react";
import { CURRENT_WAVE, type NavSection } from "@/domain/constants";
import { Tooltip } from "@/components/ui/tooltip";
import { NavIcon } from "./nav-icon";
import { InterosLogo } from "./logo";
import { UserMenu, type ShellUser } from "./user-menu";
import { cn } from "@/lib/utils";

export { InterosLogo, InterosMark } from "./logo";

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

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";

/* Seções recolhidas pelo usuário, em localStorage, expostas como store externa (sem setState em effect). */
const SECTIONS_KEY = "interos.sidebar.sections";
const sectionListeners = new Set<() => void>();
function subscribeSections(listener: () => void) {
  sectionListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    sectionListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
function readSections(): string {
  try {
    return window.localStorage.getItem(SECTIONS_KEY) ?? "";
  } catch {
    return "";
  }
}
function writeSections(keys: string[]) {
  try {
    window.localStorage.setItem(SECTIONS_KEY, keys.join(","));
  } catch {
    /* localStorage indisponível: a preferência não persiste */
  }
  sectionListeners.forEach((listener) => listener());
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

/**
 * Sidebar escura: logo, seções recolhíveis (a seção do item ativo fica sempre aberta), item ativo em
 * laranja preenchido, "Recolher menu", marca Intercert e versão no rodapé.
 */
export function Sidebar({ user, sections, variant = "desktop", collapsed = false, onToggleCollapsed, onNavigate, className }: SidebarProps) {
  const pathname = usePathname();
  const isCollapsed = variant === "desktop" && collapsed;
  const allHrefs = React.useMemo(() => sections.flatMap((s) => s.items.map((i) => i.href)), [sections]);
  const activeHref = resolveActiveHref(pathname, allHrefs);
  const closedRaw = React.useSyncExternalStore(subscribeSections, readSections, () => "");
  const closed = React.useMemo(() => new Set(closedRaw.split(",").filter(Boolean)), [closedRaw]);

  const toggleSection = (key: string) => {
    const next = new Set(closed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    writeSections([...next]);
  };

  return (
    <aside
      data-collapsed={isCollapsed || undefined}
      className={cn(
        "flex h-dvh flex-col bg-sidebar text-sidebar-fg",
        variant === "desktop" && "fixed inset-y-0 left-0 z-40 border-r border-sidebar-border transition-[width] duration-200",
        variant === "desktop" && (isCollapsed ? "w-sidebar-collapsed" : "w-sidebar"),
        variant === "drawer" && "w-sidebar",
        className,
      )}
    >
      {/* Cabeçalho: logo */}
      <div className={cn("flex h-topbar shrink-0 items-center border-b border-sidebar-border", isCollapsed ? "justify-center px-0" : "px-5")}>
        <Link href="/meu-dia" onClick={onNavigate} className="rounded-md focus-visible:outline-brand" aria-label="INTEROS · ir para Meu Dia">
          <InterosLogo collapsed={isCollapsed} />
        </Link>
      </div>

      {/* Navegação */}
      <nav aria-label="Menu principal" className="flex-1 overflow-y-auto overflow-x-hidden py-3 scrollbar-none">
        {sections.map((section, index) => {
          const hasActive = section.items.some((i) => i.href === activeHref);
          const open = isCollapsed || hasActive || !closed.has(section.key);
          const listId = `nav-section-${section.key}`;
          return (
            <div key={section.key} className={cn("px-3", index > 0 && "mt-2")}>
              {isCollapsed ? (
                index > 0 ? <div className="mx-2 mb-2 h-px bg-sidebar-border" aria-hidden /> : null
              ) : (
                <button
                  type="button"
                  onClick={() => toggleSection(section.key)}
                  aria-expanded={open}
                  aria-controls={listId}
                  disabled={hasActive}
                  className="flex h-8 w-full items-center justify-between rounded-md px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-muted transition-colors hover:text-sidebar-fg disabled:cursor-default disabled:hover:text-sidebar-muted"
                >
                  {section.label}
                  {!hasActive ? <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} aria-hidden /> : null}
                </button>
              )}
              {open ? (
                <ul id={listId} className="flex flex-col gap-0.5">
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
                          "group/item flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors md:min-h-10",
                          active ? "bg-sidebar-active text-sidebar-active-fg shadow-brand" : "text-sidebar-fg hover:bg-sidebar-hover hover:text-white",
                          isCollapsed && "justify-center px-0",
                        )}
                      >
                        <NavIcon name={item.icon} className={cn("size-[18px] shrink-0", active ? "text-white" : "text-sidebar-muted group-hover/item:text-white")} />
                        {!isCollapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
                        {!isCollapsed && soon ? (
                          <span className={cn("size-1.5 shrink-0 rounded-full", active ? "bg-white/70" : "bg-sidebar-muted")} aria-label={`Em breve (onda ${item.wave})`} />
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
              ) : null}
            </div>
          );
        })}
      </nav>

      {/* Rodapé: recolher, marca e versão (desktop) · usuário (drawer mobile) */}
      <div className={cn("shrink-0 border-t border-sidebar-border p-3", variant === "drawer" && "safe-bottom")}>
        {variant === "drawer" ? <UserMenu user={user} variant="sidebar" /> : null}
        {variant === "desktop" ? (
          <>
            <Tooltip content={isCollapsed ? "Expandir menu" : null} side="right" enabled={isCollapsed}>
              <button
                type="button"
                onClick={onToggleCollapsed}
                aria-label={isCollapsed ? "Expandir menu" : "Recolher menu"}
                className={cn(
                  "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-fg transition-colors hover:bg-sidebar-hover hover:text-white",
                  isCollapsed && "justify-center px-0",
                )}
              >
                {isCollapsed ? <ChevronsRight className="size-[18px]" /> : <ChevronsLeft className="size-[18px] text-sidebar-muted" />}
                {!isCollapsed ? <span className="flex-1 text-left">Recolher menu</span> : null}
              </button>
            </Tooltip>
            {!isCollapsed ? (
              <div className="mt-2 border-t border-sidebar-border px-3 pt-3">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold tracking-[0.14em] text-white">
                    INTER<span className="text-brand">CERT</span>
                  </span>
                  <span className="text-[11px] tabular-nums text-sidebar-muted">Versão {APP_VERSION}</span>
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-sidebar-muted">Sistemas inteligentes para o seu negócio</p>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </aside>
  );
}
