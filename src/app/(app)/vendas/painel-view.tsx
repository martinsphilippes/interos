import { AlarmClock, CalendarX2, CircleDollarSign, Gauge, PauseCircle, Percent, Receipt, Target, Trophy } from "lucide-react";
import type { CurrentUser } from "@/domain/types";
import { getSalesOverview } from "@/server/sales/queries";
import { formatCompetence, formatCurrency, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatCard } from "@/components/ui/stat-card";
import { CommissionSimulator } from "@/components/sales/commission-simulator";
import { ContactNowList } from "@/components/sales/contact-now-list";
import { REVENUE_TYPE_LABELS, REVENUE_TYPES } from "@/components/sales/model";
import { FunnelChart, WonHistoryChart } from "@/components/sales/sales-charts";
import { AgentSuggestions } from "@/components/automations/agent-suggestions";

function progressTone(att: number | null): "success" | "warning" | "danger" | "secondary" {
  if (att === null) return "secondary";
  if (att >= 1) return "success";
  if (att >= 0.85) return "warning";
  return "danger";
}

/**
 * Visão "Painel" da Central de Vendas (?view=painel): metas, comissão, simulador, funil, histórico de
 * ganhos e varredura. Todo número vem do banco; os cards levam à lista de oportunidades já filtrada.
 */
export async function SalesPanelView({ user, escopo }: { user: CurrentUser; escopo?: string }) {
  const data = await getSalesOverview(user, escopo);
  const { stats, commission } = data;
  const team = data.scope.kind === "equipe";

  const drill = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params);
    if (data.sellerParam) qs.set("vendedor", data.sellerParam);
    return `/vendas/oportunidades?${qs.toString()}`;
  };

  return (
    <>
      <p className="-mt-2 mb-4 text-sm text-muted">
        {data.scope.label} · {formatCompetence(data.competence)}
      </p>
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
        {data.lastSweep.result ? ` · ${data.lastSweep.result.followupTasksCreated} tarefas criadas, ${data.lastSweep.result.stalledFlagged} paradas sinalizadas` : ""}. Roda automaticamente no máximo 1× por hora ao abrir a Central.
      </p>
    </>
  );
}
