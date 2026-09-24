"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MOBILE_NAV } from "@/domain/constants";
import { NavIcon } from "./nav-icon";
import { cn } from "@/lib/utils";

/** Barra inferior fixa (< md) com os 5 itens de MOBILE_NAV. */
export function MobileNav({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Navegação principal"
      className={cn("fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur safe-bottom md:hidden", className)}
    >
      <ul className="grid h-mobile-nav grid-cols-5">
        {MOBILE_NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="flex">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  active ? "text-brand" : "text-muted hover:text-foreground",
                )}
              >
                <NavIcon name={item.icon} className="size-[22px]" strokeWidth={active ? 2.25 : 2} />
                <span className="leading-none">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
