"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, ChevronsUpDown, Gauge, LogOut } from "lucide-react";
import type { DepartmentKey, RoleKey } from "@/domain/constants";
import { DEPARTMENT_LABELS, ROLE_LABELS } from "@/domain/constants";
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
}

export interface UserMenuProps {
  user: ShellUser;
  /** "sidebar": linha completa no rodapé da sidebar · "compact": só avatar (top bar mobile). */
  variant?: "sidebar" | "compact";
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
    variant === "compact" ? (
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
          "flex w-full items-center gap-3 rounded-lg p-2 text-left text-white transition-colors hover:bg-navy-800 data-[state=open]:bg-navy-800",
          collapsed && "justify-center px-0",
          className,
        )}
      >
        <Avatar name={user.name} src={user.avatarUrl} size="md" className="ring-2 ring-navy-700" />
        {!collapsed ? (
          <>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-sm font-medium">{user.name}</span>
              <span className="truncate text-xs text-navy-200">{roleLabel}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-navy-200" aria-hidden />
          </>
        ) : null}
      </button>
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={variant === "compact" ? "end" : "start"} side={variant === "compact" ? "bottom" : "top"} className="w-64">
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
