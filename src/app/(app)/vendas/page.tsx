import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlarmClock, CalendarX2, CircleDollarSign, Gauge, PauseCircle, Percent, Receipt, Target, Trophy, User, Users } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getOpportunityDetail, getSalesFormOptions, getSalesOverview, type SalesOverview } from "@/server/sales/queries";
import { formatCompetence, formatCurrency, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { CommissionSimulator } from "@/components/sales/commission-simulator";
import { ContactNowList } from "@/components/sales/contact-now-list";
import { REVENUE_TYPE_LABELS, REVENUE_TYPES } from "@/components/sales/model";
import { NewOpportunityButton } from "@/components/sales/new-opportunity-dialog";
import { OpportunityDrawer } from "@/components/sales/opportunity-drawer";
import { FunnelChart, WonHistoryChart } from "@/components/sales/sales-charts";
import { SweepButton } from "@/components/sales/sweep-button";
import { AgentSuggestions } from "@/components/automations/agent-suggestions";

export const metadata: Metadata = { title: "Central de Vendas" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function ScopeToggle({ scope }: { scope: SalesOverview["scope"]["kind"] }) {
  const options = [
    { value: "meu", label: "Minhas vendas", icon: <User />, href: "/vendas" },
    { value: "equipe", label: "Equipe", icon: <Users />, href: "/vendas?escopo=equipe" },
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

function progressTone(att: number | null): "success" | "warning" | "danger" | "secondary" {
  if (att === null) return "secondary";
  if (att >= 1) return "success";
  if (att >= 0.85) return "warning";
  return "danger";
}

/**
 * Central de Vendas: a "sala de comando" do vendedor (ou da equipe, para gestores via ?escopo=equipe).
 * Todo número vem do banco; os cards levam à lista de oportunidades já filtrada.
 */
export default async function CentralDeVendasPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "vendas")) redirect("/meu-dia?erro=sem-permissao");
  const sp = await searchParams;
  const oppId = first(sp.oportunidade);
  const [data, options, detail] = await Promise.all([getSalesOverview(user, first(sp.escopo)), getSalesFormOptions(), oppId ? getOpportunityDetail(user, oppId) : Promise.resolve(null)]);
  const { stats, commission } = data;
  const team = data.scope.kind === "equipe";

  const drill = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params);
    if (data.sellerParam) qs.set("vendedor", data.sellerParam);
    return `/vendas/oportunidades?${qs.toString()}`;
  };

  return (
    <PageContainer>
      <PageHeader
        title="Central de Vendas"
        description={`${data.scope.label} · ${formatCompetence(data.competence)}`}
        breadcrumbs={[{ label: "Vendas" }, { label: "Central de Vendas" }]}
        actions={
          <>
            {user.isManager ? <ScopeToggle scope={data.scope.kind} /> : null}
            {user.isManager ? <SweepButton /> : null}
            <NewOpportunityButton options={options} currentUserId={user.id} />
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Pipeline aberto" value={`${formatCurrency(stats.pipelineMonthly, true)}/mês`} hint={`+ ${formatCurrency(stats.pipelineSetup)} adesão`} icon={<CircleDollarSign />} tone="info" href={drill({})} compact />
        <StatCard label="Oportunidades abertas" value={formatNumber(stats.openCount)} icon={<Target />} href={drill({})} compact />
        <StatCard label="Follow-ups atrasados" value={formatNumber(stats.overdueCount)} icon={<AlarmClock />} tone={stats.overdueCount > 0 ? "danger" : "success"} href={drill({ filtro: "atrasadas" })} compact />
        <StatCard label="Sem próxima ação" value={formatNumber(stats.noNextActionCount)} icon={<CalendarX2 />} tone={stats.noNextActionCount > 0 ? "danger" : "success"} href={drill({ filtro: "sem_proxima" })} compact />
        <StatCard label="Paradas" value={formatNumber(stats.stalledCount)} icon={<PauseCircle />} tone={stats.stalledCount > 0 ? "warning" : "success"} hint={`Sem atividade há mais de ${data.settings.diasSemMovimentoParaParada} dias`} href={drill({ filtro: "paradas" })} compact />
        <StatCard label="Ganhas no mês" value={formatNumber(stats.wonMonthCount)} icon={<Trophy />} tone="success" hint={`${formatCurrency(stats.wonMonthMonthly)}/mês · ${formatCurrency(stats.wonMonthSetup)} adesão`} href={drill({ situacao: "ganhas", filtro: "ganhas_mes" })} compact />
        <StatCard label="Conversão do funil" value={stats.conversion === null ? "—" : formatPercent(stats.conversion)} icon={<Percent />} hint={`${stats.wonMonthCount} ganhas / ${stats.createdMonthCount} criadas no mês`} compact />
        <StatCard label="Ticket médio" value={stats.avgTicket === null ? "—" : formatCurrency(stats.avgTicket)} icon={<Receipt />} hint="Mensalidade média das ganhas no mês" compact />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Contatar agora</CardTitle>
            <CardDescription>Follow-up vencido, sem próxima ação, paradas e quentes de valor alto — nesta ordem.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ContactNowList items={data.contactNow} showOwner={team} />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gauge className="size-4 text-muted" /> Meta do mês
              </CardTitle>
              <CardDescription>Vendido por tipo de receita {team ? "(soma da equipe)" : ""}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-0">
              {REVENUE_TYPES.map((t) => {
                const att = commission.attainment[t];
                return (
                  <div key={t}>
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                      <span>{REVENUE_TYPE_LABELS[t]}</span>
                      <span className="tabular-nums text-muted">
                        <span className="font-semibold text-foreground">{formatCurrency(commission.sold[t])}</span>
                        {commission.goals[t] > 0 ? ` / ${formatCurrency(commission.goals[t])}` : " · sem meta"}
                      </span>
                    </div>
                    <Progress value={att === null ? 0 : att * 100} tone={progressTone(att)} showValue={att !== null} aria-label={`Atingimento ${REVENUE_TYPE_LABELS[t]}`} />
                  </div>
                );
              })}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Comissão do mês</CardTitle>
              <CardDescription>Calculada nas vendas ganhas em {formatCompetence(data.competence)}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <dl className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-surface-hover p-2">
                  <dt className="text-xs text-muted">Prevista</dt>
                  <dd className="font-semibold tabular-nums">{formatCurrency(commission.commission.prevista)}</dd>
                </div>
                <div className="rounded-lg bg-success-soft p-2">
                  <dt className="text-xs text-success-fg">Liberada</dt>
                  <dd className="font-semibold tabular-nums">{formatCurrency(commission.commission.liberada)}</dd>
                </div>
                <div className="rounded-lg bg-info-soft p-2">
                  <dt className="text-xs text-info-fg">Futura</dt>
                  <dd className="font-semibold tabular-nums">{formatCurrency(commission.commission.futura)}</dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-muted">Prevista: adesão/hardware aguardando pagamento. Futura: recorrência liberada na parcela definida na regra.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {!team ? <AgentSuggestions kind="comercial" subjectId={user.id} title="Sugestões do assistente comercial" className="mb-6" /> : null}

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Funil por etapa</CardTitle>
            <CardDescription>Oportunidades abertas (quantidade; valores no detalhe)</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <FunnelChart data={data.funnel} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Vendas ganhas — últimos 6 meses</CardTitle>
            <CardDescription>Mensalidade vendida por mês</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <WonHistoryChart data={data.wonHistory} />
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Simulador de comissão</CardTitle>
          <CardDescription>Quanto rende um negócio com as regras vigentes.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <CommissionSimulator rules={data.rules} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted">
        Varredura de follow-up: {data.lastSweep.ranAt ? `última execução ${formatDateTime(data.lastSweep.ranAt)}` : "ainda não executada"}
        {data.lastSweep.result ? ` · ${data.lastSweep.result.followupTasksCreated} tarefas criadas, ${data.lastSweep.result.stalledFlagged} paradas sinalizadas` : ""}. Roda automaticamente no máximo 1× por hora ao abrir esta página.
      </p>

      <OpportunityDrawer detail={detail} />
    </PageContainer>
  );
}
