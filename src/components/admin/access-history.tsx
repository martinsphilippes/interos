import { ShieldAlert, ShieldCheck, UserCog } from "lucide-react";
import type { AccessHistoryItem } from "@/server/admin/access";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Histórico de acesso (A16): alterações de perfil/exceção/módulos, bloqueios e mudanças de cadastro que afetam o
 * acesso, com o "de → para" de cada item em rótulos de negócio.
 */
export function AccessHistoryList({ items, emptyText = "Nenhuma alteração de acesso registrada." }: { items: AccessHistoryItem[]; emptyText?: string }) {
  if (items.length === 0) return <p className="py-4 text-center text-sm text-muted">{emptyText}</p>;
  return (
    <ol className="flex flex-col gap-3">
      {items.map((item) => {
        const blocked = item.type === "permissions.blocked";
        const Icon = blocked ? ShieldAlert : item.type.startsWith("permissions.") ? ShieldCheck : UserCog;
        return (
          <li key={item.id} className="flex min-w-0 gap-3">
            <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4", blocked ? "bg-danger-soft text-danger-fg" : "bg-brand-soft text-brand-fg")} aria-hidden>
              <Icon />
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-medium">{item.title}</p>
              <p className="text-xs text-muted">
                {item.actorName} · <span className="tabular-nums">{formatDateTime(item.occurredAt)}</span>
              </p>
              {blocked && item.description ? <p className="mt-1 break-words text-xs text-danger-fg">{item.description}</p> : null}
              {item.changes.length ? (
                <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                  {item.changes.map((c, i) => (
                    <li key={`${item.id}-${i}`} className="break-words">
                      <span className="text-muted">{c.label}:</span> <span className="text-muted-light line-through decoration-muted-light/60">{c.from}</span> → <span className="font-medium text-foreground">{c.to}</span>
                    </li>
                  ))}
                </ul>
              ) : !blocked && item.description ? (
                <p className="mt-1 break-words text-xs text-muted">{item.description}</p>
              ) : null}
              {item.reason ? <p className="mt-1 break-words text-xs text-muted">Motivo: {item.reason}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
