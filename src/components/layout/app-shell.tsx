"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { NavSection } from "@/domain/constants";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { MobileNav } from "./mobile-nav";
import type { ShellUser } from "./user-menu";
import { cn } from "@/lib/utils";

export type { ShellUser } from "./user-menu";

const COLLAPSED_KEY = "interos.sidebar.collapsed";

/* Preferência "sidebar recolhida" em localStorage, exposta como store externa (sem setState em effect). */
const collapsedListeners = new Set<() => void>();
function subscribeCollapsed(listener: () => void) {
  collapsedListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    collapsedListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}
function writeCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    /* localStorage indisponível: a preferência não persiste */
  }
  collapsedListeners.forEach((listener) => listener());
}

export interface AppShellProps {
  user: ShellUser;
  /** Seções de NAVIGATION já filtradas por permissão no servidor. */
  sections: NavSection[];
  unreadCount: number;
  children: React.ReactNode;
}

/**
 * Shell autenticado: sidebar fixa (desktop, colapsável), drawer de menu + barra inferior (mobile),
 * top bar com busca/notificações. O conteúdo da página usa PageContainer + PageHeader.
 */
export function AppShell({ user, sections, unreadCount, children }: AppShellProps) {
  const pathname = usePathname();
  // No servidor (e na hidratação) a sidebar começa expandida; o cliente aplica a preferência salva.
  const collapsed = React.useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [prevPathname, setPrevPathname] = React.useState(pathname);

  const toggleCollapsed = () => writeCollapsed(!collapsed);

  // Fecha o drawer ao navegar (ajuste de estado durante a renderização).
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMobileOpen(false);
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-dvh bg-canvas">
        <Sidebar user={user} sections={sections} variant="desktop" collapsed={collapsed} onToggleCollapsed={toggleCollapsed} className="hidden md:flex" />

        {/* Menu mobile (drawer à esquerda) */}
        <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-navy-950/50 backdrop-blur-[2px] animate-fade-in md:hidden" />
            <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-sidebar max-w-[85vw] shadow-drawer animate-slide-in-left focus:outline-none md:hidden">
              <DialogPrimitive.Title className="sr-only">Menu</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">Navegação principal do INTEROS.</DialogPrimitive.Description>
              <Sidebar user={user} sections={sections} variant="drawer" onNavigate={() => setMobileOpen(false)} className="w-full" />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>

        <div className={cn("flex min-h-dvh flex-col transition-[padding] duration-200", collapsed ? "md:pl-sidebar-collapsed" : "md:pl-sidebar")}>
          <TopBar user={user} unreadCount={unreadCount} onOpenMenu={() => setMobileOpen(true)} />
          <main id="conteudo" className="flex flex-1 flex-col pb-[calc(var(--spacing-mobile-nav)+env(safe-area-inset-bottom))] md:pb-0">
            {children}
          </main>
        </div>

        <MobileNav />
      </div>
    </TooltipProvider>
  );
}
