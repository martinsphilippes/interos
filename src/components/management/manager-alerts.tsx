import Link from "next/link";
import { ChevronRight, Clock, Layers, Rocket, Target, UserRoundX } from "lucide-react";
import type { ManagerAlert } from "@/server/management/queries";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { IconTile } from "@/components/ui/icon-tile";

const ICONS: Record<ManagerAlert["kind"], React.ReactNode> = {
  sla: <Clock />,
  capacidade: <UserRoundX />,
  implantacao: <Rocket />,
  backlog: <Layers />,
  meta: <Target />,
};

/** "Alertas do gestor": SLAs vencendo em até 1 hora, sobrecarga, implantações atrasadas, backlog e metas abaixo. */
export function ManagerAlerts({ alerts, limit = 6 }: { alerts: ManagerAlert[]; limit?: number }) {
  if (alerts.length === 0) return <EmptyState size="sm" title="Nenhum alerta agora" description="Sem SLAs vencendo, sobrecarga, implantações atrasadas ou metas críticas." />;
  return (
    <ul className="flex flex-col gap-2">
      {alerts.slice(0, limit).map((a) => (
        <li key={a.key}>
          <Link
            href={a.href}
            className={cn(
              "flex min-h-[48px] items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
              a.tone === "danger" ? "border-danger/30 bg-danger-soft/40 hover:bg-danger-soft/70" : "border-warning/30 bg-warning-soft/30 hover:bg-warning-soft/60",
            )}
          >
            <IconTile icon={ICONS[a.kind]} tone={a.tone} size="xs" shape="circle" />
            <span className="min-w-0 flex-1">
              <span className={cn("block truncate text-sm font-medium", a.tone === "danger" ? "text-danger-fg" : "text-warning-fg")}>{a.title}</span>
              {a.detail ? <span className="block truncate text-xs text-muted">{a.detail}</span> : null}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-light" aria-hidden />
          </Link>
        </li>
      ))}
      {alerts.length > limit ? <li className="text-xs text-muted">+{alerts.length - limit} alerta(s)</li> : null}
    </ul>
  );
}
