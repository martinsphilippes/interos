"use client";

import Link from "next/link";
import { Bell, CircleHelp, Gauge, LayoutGrid } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/menu", label: "Todos os módulos", icon: LayoutGrid },
  { href: "/notificacoes", label: "Notificações", icon: Bell },
  { href: "/performance", label: "Meu desempenho", icon: Gauge },
];

/** Ajuda rápida da top bar: atalhos de teclado e atalhos de navegação. */
export function HelpMenu({ className }: { className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Ajuda e atalhos"
          className={cn("inline-flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-foreground data-[state=open]:bg-surface-hover", className)}
        >
          <CircleHelp className="size-5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b border-border-strong/70 px-4 py-3">
          <p className="text-sm font-semibold">Ajuda rápida</p>
          <p className="text-xs text-muted">Atalhos para trabalhar mais rápido.</p>
        </div>
        <ul className="flex flex-col gap-2 px-4 py-3 text-sm">
          <li className="flex items-center justify-between gap-3">
            <span className="text-muted">Busca global</span>
            <span className="inline-flex gap-0.5">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </span>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span className="text-muted">Navegar nos resultados</span>
            <span className="inline-flex gap-0.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
            </span>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span className="text-muted">Fechar janelas e painéis</span>
            <Kbd>Esc</Kbd>
          </li>
        </ul>
        <ul className="border-t border-border-strong/70 p-1.5">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="flex min-h-10 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors hover:bg-surface-hover">
                <l.icon className="size-4 text-muted" aria-hidden />
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
