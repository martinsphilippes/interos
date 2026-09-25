"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, ChevronDown, ChevronsUpDown, Gauge, LogOut } from "lucide-react";
import type { DepartmentKey, RoleKey } from "@/domain/constants";
import { DEPARTMENT_LABELS, ROLE_LABELS } from "@/domain/constants";
import type { UserPresence } from "@/domain/types";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { performLogout } from "@/components/auth/logout-button";
import { cn } from "@/lib/utils";

/** Campos serializáveis do usuário, passados do server layout ao shell. */
export interface ShellUser {
  id: string;
  name: string;
  email: string;
  role: RoleKey;
  departmentId: DepartmentKey;
  avatarUrl?: string;
  jobTitle?: string;
  /** Presença atual (seletor da top bar). */
  presence?: UserPresence;
}

export interface UserMenuProps {
  user: ShellUser;
  /** "topbar": avatar + nome + cargo (top bar desktop) · "sidebar": linha completa no drawer · "compact": só avatar (top bar mobile). */
  variant?: "topbar" | "sidebar" | "compact";
  /** Na sidebar recolhida mostra só o avatar. */
  collapsed?: boolean;
  className?: string;
}

export function UserMenu({ user, variant = "sidebar", collapsed = false, className }: UserMenuProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = React.useState(false);
  const roleLabel = user.jobTitle ?? ROLE_LABELS[user.role];

  const logout = async () => {
    setLoggingOut(true);
    await performLogout();
    router.replace("/login");
    router.refresh();
  };

  const trigger =
    variant === "topbar" ? (
      <button
        type="button"
        aria-label="Menu do usuário"
        className={cn("flex h-11 items-center gap-2.5 rounded-lg pl-1.5 pr-2 text-left transition-colors hover:bg-surface-hover data-[state=open]:bg-surface-hover", className)}
      >
        <Avatar name={user.name} src={user.avatarUrl} size="md" className="ring-2 ring-border-strong" />
        <span className="hidden min-w-0 max-w-[180px] flex-col leading-tight lg:flex">
          <span className="truncate text-sm font-medium text-foreground">{user.name}</span>
          <span className="truncate text-xs text-muted">{roleLabel}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden />
      </button>
    ) : variant === "compact" ? (
      <button
        type="button"
        aria-label="Menu do usuário"
        className={cn("inline-flex size-10 items-center justify-center rounded-full transition-colors hover:bg-surface-hover md:size-9", className)}
      >
        <Avatar name={user.name} src={user.avatarUrl} size="sm" />
      </button>
    ) : (
      <button
        type="button"
        aria-label="Menu do usuário"
        className={cn(
          "flex w-full items-center gap-3 rounded-lg p-2 text-left text-white transition-colors hover:bg-sidebar-hover data-[state=open]:bg-sidebar-hover",
          collapsed && "justify-center px-0",
          className,
        )}
      >
        <Avatar name={user.name} src={user.avatarUrl} size="md" className="ring-2 ring-sidebar-border" />
        {!collapsed ? (
          <>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-sm font-medium">{user.name}</span>
              <span className="truncate text-xs text-sidebar-muted">{roleLabel}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-sidebar-muted" aria-hidden />
          </>
        ) : null}
      </button>
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={variant === "sidebar" ? "start" : "end"} side={variant === "sidebar" ? "top" : "bottom"} className="w-64">
        <div className="flex items-center gap-3 px-2 py-2">
          <Avatar name={user.name} src={user.avatarUrl} size="md" />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
            <p className="truncate text-xs text-muted">
              {ROLE_LABELS[user.role]} · {DEPARTMENT_LABELS[user.departmentId]}
            </p>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/performance">
            <Gauge /> Meu desempenho
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/notificacoes">
            <Bell /> Notificações
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive disabled={loggingOut} onSelect={(e) => { e.preventDefault(); void logout(); }}>
          <LogOut /> {loggingOut ? "Saindo…" : "Sair"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
