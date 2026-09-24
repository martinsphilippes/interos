import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlarmClock, CheckCircle2, Hourglass, Inbox, Layers, MessageSquareWarning, PauseCircle, Repeat, ShieldAlert, Smile, Timer, User, Users } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getSupportOptions, getSupportOverview, type OverviewScope } from "@/server/support/queries";
import { maybeRunSlaAlerts } from "@/server/support/service";
import { after } from "next/server";
import { runDueSweeps } from "@/server/automations/lazy";
import { formatNumber, formatPercent } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { NewTicketDialog } from "@/components/support/new-ticket-dialog";
import { TicketsTable } from "@/components/support/tickets-table";
import { readTicketFilters } from "@/components/support/filters";
import { csatTone } from "@/components/support/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Central de Atendimento" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function ScopeToggle({ scope }: { scope: OverviewScope }) {
  const options = [
    { value: "minha", label: "Minha fila", icon: <User />, href: "/suporte?escopo=minha" },
    { value: "equipe", label: "Equipe", icon: <Users />, href: "/suporte?escopo=equipe" },
  ];
  return (
    <div role="radiogroup" aria-label="Escopo da Central" className="inline-flex items-center gap-0.5 rounded-lg bg-surface-hover p-0.5">
      {options.map((o) => (
        <Link
          key={o.value}
          href={o.href}
          role="radio"
          aria-checked={o.value === scope}
          className={cn("inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors md:h-8 [&_svg]:size-4", o.value === scope ? "bg-surface text-foreground shadow-card" : "text-muted hover:text-foreground")}
        >
          {o.icon}
          {o.label}
        </Link>
      ))}
    </div>
  );
}

/**
 * Central de Atendimento: fila operacional do atendente (sua fila + chamados sem atendente) ou da equipe
 * (padrão para gestores). Os cards levam à lista de chamados já filtrada. Ao abrir, roda a varredura de
 * alertas de SLA (no máximo a cada 10 minutos).
 */
export default async function SupportCentralPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "suporte")) redirect("/meu-dia?erro=sem-permissao");
  const sp = await searchParams;
  const scopeParam = Array.isArray(sp.escopo) ? sp.escopo[0] : sp.escopo;
  const scope: OverviewScope | undefined = scopeParam === "minha" || scopeParam === "equipe" ? scopeParam : undefined;

  // Chamados: alertas de SLA a cada 10 minutos (serviço do Suporte). Demais SLAs (tarefas, etapas, projetos):
  // varredura central de alertas, depois da resposta para não atrasar a tela.
  try {
    await maybeRunSlaAlerts();
  } catch (error) {
    console.error("[suporte] falha na varredura de SLA", error);
  }
  after(() => runDueSweeps(["sla_alerts"]));
  const [overview, options] = await Promise.all([getSupportOverview(user, scope), getSupportOptions(user)]);
  const { stats } = overview;
  const mine = overview.scope === "minha" ? "&atendente=meus" : "";
  const list = (qs: string) => `/suporte/chamados?${qs}`;

  return (
    <PageContainer>
      <PageHeader
        title="Central de Atendimento"
        description={overview.scope === "equipe" ? "Fila de toda a equipe de suporte, ordenada por SLA e criticidade." : "Seus chamados e os que estão na fila sem atendente, ordenados por SLA e criticidade."}
        breadcrumbs={[{ label: "Suporte" }, { label: "Central de Atendimento" }]}
        actions={
          <>
            <ScopeToggle scope={overview.scope} />
            <Button asChild variant="outline" className="min-h-[44px] md:min-h-0">
              <Link href="/suporte/sla">
                <Timer /> SLA e qualidade
              </Link>
            </Button>
            <NewTicketDialog options={options} />
          </>
        }
      />

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
      <TicketsTable rows={overview.rows} mode="fila" team={options.team} products={options.products} currentUserId={user.id} canOperate={options.canOperate} initialFilters={readTicketFilters(sp)} />
    </PageContainer>
  );
}
