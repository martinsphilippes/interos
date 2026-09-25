"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { MOBILE_NAV, type NavSection } from "@/domain/constants";
import { GlobalSearch } from "./global-search";
import { HelpMenu } from "./help-menu";
import { NotificationsBell } from "./notifications-bell";
import { PresenceSelect } from "./presence-select";
import { UserMenu, type ShellUser } from "./user-menu";
import { InterosMark } from "./logo";
import { resolveActiveHref } from "./sidebar";
import { cn } from "@/lib/utils";

export interface TopBarProps {
  user: ShellUser;
  unreadCount: number;
  /** Abre o menu lateral no celular (mantido por compatibilidade; o mobile usa a barra inferior). */
  onOpenMenu?: () => void;
  /** Seções da navegação (título da tela no cabeçalho mobile). */
  sections?: NavSection[];
  /** Mostra o seletor de presença (papéis operacionais e gestores). */
  showPresence?: boolean;
  className?: string;
}

const ROOT_PATHS = new Set(MOBILE_NAV.map((i) => i.href));
const EXTRA_TITLES: Record<string, string> = { "/menu": "Menu", "/notificacoes": "Notificações", "/meu-dia": "Meu Dia" };

/** Título da tela no cabeçalho mobile: item de navegação mais específico que casa com a rota. */
function mobileTitle(pathname: string, sections: NavSection[]): string {
  const items = sections.flatMap((s) => s.items);
  const href = resolveActiveHref(pathname, [...items.map((i) => i.href), ...Object.keys(EXTRA_TITLES)]);
  if (!href) return "INTEROS";
  return EXTRA_TITLES[href] ?? items.find((i) => i.href === href)?.label ?? "INTEROS";
}

/** Rota "pai" para o botão voltar quando não há histórico (link aberto direto). */
function parentPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  return parts.length > 1 ? `/${parts.slice(0, -1).join("/")}` : "/meu-dia";
}

/**
 * Top bar escura. Desktop: busca em pílula (Ctrl+K), presença, ajuda, sino com contador e bloco do usuário.
 * Mobile: voltar (fora das abas raiz) ou símbolo, título da tela, busca, sino e avatar.
 */
export function TopBar({ user, unreadCount, sections = [], showPresence = false, className }: TopBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isRoot = ROOT_PATHS.has(pathname);
  const title = mobileTitle(pathname, sections);

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(parentPath(pathname));
  };

  return (
    <header className={cn("sticky top-0 z-30 shrink-0 border-b border-border bg-canvas/90 backdrop-blur-md safe-top", className)}>
      <div className="flex h-14 items-center gap-1 px-2 md:h-topbar md:gap-2 md:px-6">
        {/* Mobile: voltar ou símbolo + título */}
        <div className="flex min-w-0 flex-1 items-center gap-1 md:hidden">
          {isRoot ? (
            <span className="inline-flex size-10 items-center justify-center" aria-hidden>
              <InterosMark className="size-7" />
            </span>
          ) : (
            <button
              type="button"
              onClick={goBack}
              aria-label="Voltar"
              className="inline-flex size-11 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-surface-hover"
            >
              <ArrowLeft className="size-5" />
            </button>
          )}
          <p className="truncate text-base font-semibold text-foreground">{title}</p>
        </div>

        {/* Busca: ícone no mobile, pílula no desktop */}
        <div className="flex items-center md:flex-1">
          <GlobalSearch />
        </div>

        <div className="flex items-center gap-1 md:gap-2">
          {showPresence ? <PresenceSelect value={user.presence} className="hidden md:inline-flex" /> : null}
          <HelpMenu className="hidden md:inline-flex" />
          <NotificationsBell unreadCount={unreadCount} />
          <span className="mx-1 hidden h-8 w-px bg-border md:block" aria-hidden />
          <UserMenu user={user} variant="topbar" className="hidden md:flex" />
          <UserMenu user={user} variant="compact" className="md:hidden" />
        </div>
      </div>
    </header>
  );
}
