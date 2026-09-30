import Link from "next/link";
import type { AgendaItem } from "@/server/cs/queries";
import { formatDate, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CheckpointDialog } from "./checkpoint-dialog";
import { HealthIndicator } from "./cs-bits";

/**
 * Cartão de um checkpoint agendado (próxima interação da conta de CS). `canCheckpoint`/`clientLink` vêm das
 * capacidades calculadas no servidor (padrão: tudo visível, como antes).
 */
export function AgendaItemCard({ item, showDate, canCheckpoint = true, clientLink = true }: { item: AgendaItem; showDate?: boolean; canCheckpoint?: boolean; clientLink?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-md border p-2.5", item.overdue ? "border-danger/40 bg-danger-soft/40" : "border-border bg-surface")}>
      <div className="flex items-start justify-between gap-2">
        {clientLink ? (
          <Link href={`/clientes/${item.clientId}?aba=cs`} className="min-w-0 truncate text-sm font-medium hover:underline" title={item.tradeName}>
            {item.tradeName}
          </Link>
        ) : (
          <span className="min-w-0 truncate text-sm font-medium" title={item.tradeName}>
            {item.tradeName}
          </span>
        )}
        <HealthIndicator score={item.healthScore} level={item.healthLevel} />
      </div>
      <p className={cn("text-xs", item.overdue ? "font-medium text-danger-fg" : "text-muted")}>
        {showDate || item.overdue ? `${formatDate(item.nextInteractionAt)} · ` : ""}
        {item.overdue ? `vencido ${formatRelative(item.nextInteractionAt)}` : formatDate(item.nextInteractionAt, "HH:mm")}
        {item.owner ? ` · ${item.owner.name.split(" ")[0]}` : ""}
      </p>
      {canCheckpoint ? <CheckpointDialog clientId={item.clientId} clientName={item.tradeName} adoptionPct={item.adoptionPct} variant={item.overdue ? "primary" : "outline"} /> : null}
    </div>
  );
}
