"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

export function NotificationsBell({ unreadCount, className }: { unreadCount: number; className?: string }) {
  const pathname = usePathname();
  const active = pathname.startsWith("/notificacoes");
  const label = unreadCount > 0 ? `Notificações: ${unreadCount} não lida${unreadCount > 1 ? "s" : ""}` : "Notificações";
  return (
    <Link
      href="/notificacoes"
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-foreground",
        active && "bg-surface-hover text-foreground",
        className,
      )}
    >
      <Bell className="size-5" />
      {unreadCount > 0 ? (
        <span className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-canvas">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </Link>
  );
}
