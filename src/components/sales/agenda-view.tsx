import Link from "next/link";
import { CheckSquare, MapPin, PhoneOutgoing } from "lucide-react";
import type { AgendaData, AgendaItem } from "@/server/sales/queries";
import { formatDateKey, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<AgendaItem["kind"], React.ReactNode> = {
  visita: <MapPin />,
  tarefa: <CheckSquare />,
  followup: <PhoneOutgoing />,
};
const KIND_TONE: Record<AgendaItem["kind"], string> = {
  visita: "border-l-secondary",
  tarefa: "border-l-info",
  followup: "border-l-brand",
};
export const AGENDA_KIND_LABELS: Record<AgendaItem["kind"], string> = { visita: "Visita", tarefa: "Tarefa", followup: "Follow-up" };

function Item({ item, compact }: { item: AgendaItem; compact?: boolean }) {
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-start gap-1.5 rounded-md border border-border border-l-[3px] bg-surface px-2 py-1.5 text-xs shadow-card transition-colors hover:bg-surface-hover [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted",
        KIND_TONE[item.kind],
        item.done && "opacity-60",
      )}
      title={`${AGENDA_KIND_LABELS[item.kind]}: ${item.title}${item.subtitle ? ` — ${item.subtitle}` : ""}`}
    >
      {KIND_ICON[item.kind]}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate font-medium", item.done && "line-through", item.overdue && "text-danger-fg")}>
          <span className="tabular-nums">{formatTime(item.at)}</span> {item.title}
        </span>
        {!compact && (item.subtitle || item.ownerName) ? <span className="block truncate text-muted">{[item.subtitle, item.ownerName].filter(Boolean).join(" · ")}</span> : null}
      </span>
    </Link>
  );
}

/** Agenda semanal (colunas por dia; lista no celular) ou mensal (grade). Cada item leva ao detalhe. */
export function AgendaView({ data, today }: { data: AgendaData; today: string }) {
  const byDay = new Map<string, AgendaItem[]>();
  for (const item of data.items) byDay.set(item.day, [...(byDay.get(item.day) ?? []), item]);
  const month = data.anchor.slice(0, 7);

  if (data.view === "semana") {
    return (
      <div className="grid gap-2 md:grid-cols-7">
        {data.days.map((day) => {
          const items = byDay.get(day) ?? [];
          return (
            <section key={day} className={cn("flex min-h-[120px] flex-col gap-1.5 rounded-lg border border-border bg-surface-muted p-2", day === today && "border-brand ring-1 ring-brand/30")}>
              <h3 className={cn("text-xs font-semibold uppercase tracking-wide", day === today ? "text-brand-fg" : "text-muted")}>{formatDateKey(day, "EEE dd/MM")}</h3>
              {items.length === 0 ? <p className="text-xs text-muted-light md:py-2">—</p> : items.map((i) => <Item key={i.id} item={i} />)}
            </section>
          );
        })}
      </div>
    );
  }

  const weekdays = data.days.slice(0, 7);
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <div className="grid min-w-[760px] grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
        {weekdays.map((d) => (
          <div key={d} className="bg-surface-muted px-2 py-1.5 text-center text-xs font-semibold uppercase text-muted">
            {formatDateKey(d, "EEE")}
          </div>
        ))}
        {data.days.map((day) => {
          const items = byDay.get(day) ?? [];
          const outside = day.slice(0, 7) !== month;
          return (
            <div key={day} className={cn("flex min-h-[108px] flex-col gap-1 bg-surface p-1.5", outside && "bg-surface-muted")}>
              <span className={cn("self-end rounded-full px-1.5 text-xs tabular-nums", day === today ? "bg-brand text-white" : outside ? "text-muted-light" : "text-muted")}>{Number(day.slice(8))}</span>
              {items.slice(0, 3).map((i) => (
                <Item key={i.id} item={i} compact />
              ))}
              {items.length > 3 ? (
                <Link href={`?visao=semana&data=${day}`} className="text-[11px] font-medium text-secondary hover:underline">
                  +{items.length - 3} itens
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
