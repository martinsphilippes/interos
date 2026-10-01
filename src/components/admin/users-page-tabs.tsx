import Link from "next/link";
import { Puzzle, ShieldCheck, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export type UsersPageTab = "usuarios" | "perfis" | "modulos";

const ITEMS: { value: UsersPageTab; label: string; href: string; icon: React.ReactNode }[] = [
  { value: "usuarios", label: "Usuários", href: "/admin/usuarios", icon: <Users /> },
  { value: "perfis", label: "Perfis e acessos", href: "/admin/usuarios?aba=perfis", icon: <ShieldCheck /> },
  { value: "modulos", label: "Módulos da empresa", href: "/admin/usuarios?aba=modulos", icon: <Puzzle /> },
];

/**
 * Abas de /admin/usuarios (?aba=, A10). Navegação real (cada aba busca os próprios dados no servidor); as abas de
 * acessos só aparecem para quem pode vê-las (decidido no servidor).
 */
export function UsersPageTabs({ current, visible }: { current: UsersPageTab; visible: UsersPageTab[] }) {
  if (visible.length <= 1) return null;
  return (
    <nav aria-label="Seções de usuários e acessos" className="mb-5 flex max-w-full items-center gap-1 overflow-x-auto border-b border-border scrollbar-none">
      {ITEMS.filter((i) => visible.includes(i.value)).map((i) => {
        const active = i.value === current;
        return (
          <Link
            key={i.value}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors [&_svg]:size-4",
              active ? "border-brand text-brand-fg" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {i.icon} {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
