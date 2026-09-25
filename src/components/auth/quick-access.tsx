"use client";

import { Loader2, Zap } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { DEPARTMENT_LABELS, ROLE_LABELS } from "@/domain/constants";
import { cn } from "@/lib/utils";

/** Usuário exibido no acesso rápido (espelha DemoUser de src/server/auth/demo.ts, sem importar código de servidor). */
export interface QuickAccessUser {
  id: string;
  name: string;
  email: string;
  role: keyof typeof ROLE_LABELS;
  departmentId: keyof typeof DEPARTMENT_LABELS;
  jobTitle?: string;
}

export interface QuickAccessProps {
  users: QuickAccessUser[];
  /** Id do usuário cujo login está em andamento. */
  pendingId: string | null;
  disabled: boolean;
  onSelect: (user: QuickAccessUser) => void;
  className?: string;
}

/** Cards de login com um clique da fase de testes (NEXT_PUBLIC_DEMO_MODE=true). */
export function QuickAccess({ users, pendingId, disabled, onSelect, className }: QuickAccessProps) {
  if (users.length === 0) return null;
  return (
    <section aria-labelledby="acesso-rapido" className={cn("w-full", className)}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="acesso-rapido" className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          <Zap className="size-4 text-brand-fg" aria-hidden />
          Acesso rápido · ambiente de testes
        </h2>
        <p className="text-xs text-muted">Toque em um usuário para entrar com o perfil dele.</p>
      </div>
      <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {users.map((user) => {
          const pending = pendingId === user.id;
          return (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => onSelect(user)}
                disabled={disabled}
                aria-busy={pending}
                data-quick-login={user.email}
                title={`Entrar como ${user.name} — ${user.jobTitle ?? ROLE_LABELS[user.role]} · ${DEPARTMENT_LABELS[user.departmentId]}`}
                className={cn(
                  "flex w-full min-h-[64px] items-center gap-3 rounded-xl border border-border-strong bg-surface/75 px-3 py-2.5 text-left backdrop-blur transition-colors",
                  "hover:border-brand/60 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                  pending && "border-brand/70 opacity-100",
                )}
              >
                <Avatar name={user.name} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {user.jobTitle ?? ROLE_LABELS[user.role]} · {DEPARTMENT_LABELS[user.departmentId]}
                  </span>
                  <span className="block truncate text-[11px] text-muted-light">{user.email}</span>
                </span>
                {pending ? <Loader2 className="size-4 shrink-0 animate-spin text-brand-fg" aria-hidden /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
