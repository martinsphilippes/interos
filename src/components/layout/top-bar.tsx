"use client";

import { Menu } from "lucide-react";
import { GlobalSearch } from "./global-search";
import { NotificationsBell } from "./notifications-bell";
import { UserMenu, type ShellUser } from "./user-menu";
import { InterosLogo } from "./sidebar";
import { cn } from "@/lib/utils";

export interface TopBarProps {
  user: ShellUser;
  unreadCount: number;
  onOpenMenu: () => void;
  className?: string;
}

/** Barra superior (56px). O título da página vem do PageHeader dentro do conteúdo. */
export function TopBar({ user, unreadCount, onOpenMenu, className }: TopBarProps) {
  return (
    <header className={cn("sticky top-0 z-30 flex h-topbar shrink-0 items-center gap-2 border-b border-border bg-surface/95 px-3 backdrop-blur md:px-6", className)}>
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Abrir menu"
        className="inline-flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-foreground md:hidden"
      >
        <Menu className="size-5" />
      </button>
      <span className="flex items-center rounded-md bg-navy-900 px-2 py-1 md:hidden">
        <InterosLogo collapsed className="[&_svg]:size-6" />
      </span>
      <div className="flex flex-1 items-center justify-end md:justify-start">
        <GlobalSearch />
      </div>
      <div className="flex items-center gap-1">
        <NotificationsBell unreadCount={unreadCount} />
        <UserMenu user={user} variant="compact" className="md:hidden" />
      </div>
    </header>
  );
}
