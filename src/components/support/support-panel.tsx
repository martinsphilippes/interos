import { AlarmClock, CheckCircle2, Hourglass, Inbox, Layers, MessageSquareWarning, PauseCircle, Repeat, ShieldAlert, Smile } from "lucide-react";
import type { SupportOptions, SupportOverview } from "@/server/support/queries";
import { formatNumber, formatPercent } from "@/lib/format";
import { StatCard } from "@/components/ui/stat-card";
import { csatTone } from "./format";
import { TicketsTable } from "./tickets-table";
import type { TicketFilterState } from "./filters";

/**
 * Painel de qualidade da Central (?view=painel): indicadores de fila, SLA, CSAT e reincidência com drill-down
 * para a lista de chamados, e a fila em tabela com filtros.
 */
export function SupportPanel({ overview, options, currentUserId, filters }: { overview: SupportOverview; options: SupportOptions; currentUserId: string; filters: TicketFilterState }) {
  const { stats } = overview;
  const mine = overview.scope === "minha" ? "&atendente=meus" : "";
  const list = (qs: string) => `/suporte/chamados?${qs}`;
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard compact label="Abertos" value={formatNumber(stats.open)} icon={<Inbox />} tone={stats.open > 0 ? "info" : "neutral"} href={list("status=aberto,reaberto")} hint="aguardando atendimento" />
        <StatCard compact label="Em atendimento" value={formatNumber(stats.inProgress)} icon={<Hourglass />} tone="info" href={list(`status=em_atendimento${mine}`)} />
        <StatCard compact label="Aguardando cliente" value={formatNumber(stats.waiting)} icon={<PauseCircle />} tone={stats.waiting > 0 ? "warning" : "neutral"} href={list(`status=aguardando_cliente${mine}`)} hint="SLA pausado" />
        <StatCard compact label="SLA em risco" value={formatNumber(stats.atRisk)} icon={<AlarmClock />} tone={stats.atRisk > 0 ? "warning" : "success"} href={list(`sla=em_risco${mine}`)} />
        <StatCard compact label="SLA violado" value={formatNumber(stats.breached)} icon={<ShieldAlert />} tone={stats.breached > 0 ? "danger" : "success"} href={list(`sla=violado${mine}`)} />
        <StatCard compact label="1ª resposta pendente" value={formatNumber(stats.responsePending)} icon={<MessageSquareWarning />} tone={stats.responsePending > 0 ? "warning" : "success"} href={list("resposta=pendente")} />
        <StatCard compact label="Resolvidos hoje" value={formatNumber(stats.resolvedToday)} icon={<CheckCircle2 />} tone="success" href={list(`status=resolvido,fechado&periodo=hoje${mine}`)} />
        <StatCard
          compact
          label="CSAT do mês"
          value={stats.csatAverage !== undefined ? stats.csatAverage.toFixed(1).replace(".", ",") : "—"}
          icon={<Smile />}
          tone={csatTone(stats.csatAverage, stats.csatTarget)}
          href="/suporte/sla#csat"
          hint={stats.csatCount > 0 ? `${stats.csatCount} avaliações · meta ${stats.csatTarget.toFixed(1).replace(".", ",")}` : "sem avaliações no mês"}
        />
        <StatCard
          compact
          label="Reincidência do mês"
          value={stats.reopenRate !== undefined ? formatPercent(stats.reopenRate) : "—"}
          icon={<Repeat />}
          tone={stats.reopenRate === undefined ? "neutral" : stats.reopenRate <= stats.reopenTarget ? "success" : "danger"}
          href={list(`reaberto=1&periodo=mes${mine}`)}
          hint={`${stats.reopenedMonth} reabertos / ${stats.resolvedMonth} resolvidos · meta ≤ ${formatPercent(stats.reopenTarget)}`}
        />
        <StatCard compact label="Backlog" value={formatNumber(stats.backlog)} icon={<Layers />} tone="neutral" href={list("status=abertos")} hint="todos os chamados em aberto" />
      </div>

      <h2 className="mb-3 text-base font-semibold">Fila de atendimento</h2>
      <TicketsTable rows={overview.rows} mode="fila" team={options.team} products={options.products} currentUserId={currentUserId} canOperate={options.canOperate} initialFilters={filters} />
    </>
  );
}
