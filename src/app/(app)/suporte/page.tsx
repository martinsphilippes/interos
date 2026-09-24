import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { AlertTriangle, CircleCheckBig, ClipboardList, Clock3, Gauge, Headset, LayoutGrid, User, Users } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getSupportOptions, getSupportOverview, getTicket, listArticles, type OverviewScope } from "@/server/support/queries";
import { maybeRunSlaAlerts } from "@/server/support/service";
import { getSupportChannelStatus } from "@/server/support/integrations";
import { canEditArticles } from "@/server/support/schemas";
import { runDueSweeps } from "@/server/automations/lazy";
import { formatNumber, formatPercent } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { NewTicketDialog } from "@/components/support/new-ticket-dialog";
import { SupportPanel } from "@/components/support/support-panel";
import { SupportWorkspace } from "@/components/support/support-workspace";
import { readTicketFilters } from "@/components/support/filters";
import { isQueueTab, type QueueTab } from "@/components/support/workspace-model";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Central de Suporte" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function ScopeToggle({ scope, view }: { scope: OverviewScope; view?: string }) {
  const extra = view ? `&view=${view}` : "";
  const options = [
    { value: "minha", label: "Minha fila", icon: <User />, href: `/suporte?escopo=minha${extra}` },
    { value: "equipe", label: "Equipe", icon: <Users />, href: `/suporte?escopo=equipe${extra}` },
  ];
  return (
    <div role="radiogroup" aria-label="Escopo da fila" className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-muted p-0.5">
      {options.map((o) => (
        <Link
          key={o.value}
          href={o.href}
          role="radio"
          aria-checked={o.value === scope}
          className={cn("inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors md:h-8 [&_svg]:size-4", o.value === scope ? "bg-brand text-white shadow-brand" : "text-muted hover:bg-surface-hover hover:text-foreground")}
        >
          {o.icon}
          {o.label}
        </Link>
      ))}
    </div>
  );
}

/**
 * Central de Suporte. Padrão: WORKSPACE do atendente (fila | chamado com conversa e composer | contexto do
 * cliente), com seleção por ?chamado=<id> e aba da fila por ?fila=. ?view=painel mostra o painel de qualidade
 * (indicadores de SLA, CSAT, reincidência e a fila em tabela). Ao abrir, roda a varredura de alertas de SLA
 * (no máximo a cada 10 minutos).
 */
export default async function SupportCentralPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "suporte")) redirect("/meu-dia?erro=sem-permissao");
  const sp = await searchParams;
  const scopeParam = first(sp.escopo);
  const scope: OverviewScope | undefined = scopeParam === "minha" || scopeParam === "equipe" ? scopeParam : undefined;
  const view = first(sp.view) === "painel" ? "painel" : undefined;

  // Chamados: alertas de SLA a cada 10 minutos (serviço do Suporte). Demais SLAs: varredura central depois da resposta.
  try {
    await maybeRunSlaAlerts();
  } catch (error) {
    console.error("[suporte] falha na varredura de SLA", error);
  }
  after(() => runDueSweeps(["sla_alerts"]));

  const [overview, options] = await Promise.all([getSupportOverview(user, scope), getSupportOptions(user)]);
  const { stats } = overview;
  const scopeQuery = scope ? `escopo=${scope}&` : "";

  const header = (compactOnMobile: boolean) => (
    <PageHeader
      title="Central de Suporte"
      description={view ? "Painel de qualidade: fila, SLA, CSAT e reincidência." : "Atenda, acompanhe e resolva chamados em todos os canais."}
      className={compactOnMobile ? "hidden lg:flex" : undefined}
      actions={
        <>
          <ScopeToggle scope={overview.scope} view={view} />
          {view ? (
            <Button asChild variant="outline" className="min-h-[44px] md:min-h-0">
              <Link href={`/suporte${scope ? `?escopo=${scope}` : ""}`}>
                <Headset /> Workspace
              </Link>
            </Button>
          ) : (
            <Button asChild variant="outline" className="min-h-[44px] md:min-h-0">
              <Link href={`/suporte?${scopeQuery}view=painel`}>
                <LayoutGrid /> Painel de qualidade
              </Link>
            </Button>
          )}
          <NewTicketDialog options={options} openAfterCreate openOnUrlFlag={!view} />
        </>
      }
    />
  );

  if (view === "painel") {
    return (
      <PageContainer>
        {header(false)}
        <SupportPanel overview={overview} options={options} currentUserId={user.id} filters={readTicketFilters(sp)} />
      </PageContainer>
    );
  }

  // Workspace: chamado escolhido (?chamado=) ou, no desktop, o primeiro da fila.
  const chosen = first(sp.chamado);
  const selectedId = chosen ?? overview.rows[0]?.id;
  const filaParam = first(sp.fila);
  const initialTab: QueueTab = isQueueTab(filaParam) ? filaParam : "todos";
  const [detail, kb, channels] = await Promise.all([selectedId ? getTicket(selectedId, user) : Promise.resolve(null), listArticles({ includeDrafts: true }), getSupportChannelStatus()]);
  const explicit = Boolean(chosen && detail);
  const riskTotal = stats.atRisk + stats.breached;
  const drill = (fila: QueueTab) => `/suporte?${scopeQuery}fila=${fila}`;

  return (
    <PageContainer size="full" className="lg:pb-4">
      {header(explicit)}
      <KpiStrip columns={5} mobileColumns={2} className={cn("mb-4 md:gap-3", explicit && "hidden lg:grid")}>
        <StatCard compact label="Novos" value={formatNumber(stats.open)} icon={<ClipboardList />} tone="info" href={drill("novos")} hint="aguardando atendimento" />
        <StatCard compact label="Em atendimento" value={formatNumber(stats.inProgress)} icon={<Headset />} tone="secondary" href={drill("atendimento")} />
        <StatCard compact label="Aguardando cliente" value={formatNumber(stats.waiting)} icon={<Clock3 />} tone="warning" href={drill("aguardando")} hint="SLA pausado" />
        <StatCard
          compact
          label="Em risco"
          value={formatNumber(riskTotal)}
          icon={<AlertTriangle />}
          tone={riskTotal > 0 ? "danger" : "success"}
          valueTone={riskTotal > 0}
          href={drill("risco")}
          hint={stats.breached > 0 ? `${stats.breached} já violado${stats.breached === 1 ? "" : "s"}` : "nenhum violado"}
        />
        <StatCard
          compact
          label="SLA cumprido"
          value={stats.slaCompliance !== undefined ? formatPercent(stats.slaCompliance) : "—"}
          icon={stats.slaCompliance !== undefined && stats.slaCompliance < stats.slaTarget ? <Gauge /> : <CircleCheckBig />}
          tone={stats.slaCompliance === undefined ? "neutral" : stats.slaCompliance >= stats.slaTarget ? "success" : stats.slaCompliance >= stats.slaTarget * 0.9 ? "warning" : "danger"}
          href={`/suporte?${scopeQuery}view=painel`}
          hint={stats.slaEvaluated > 0 ? `${stats.slaMet}/${stats.slaEvaluated} no prazo · meta ${formatPercent(stats.slaTarget)}` : "sem chamados avaliados no mês"}
        />
      </KpiStrip>
      <SupportWorkspace
        rows={overview.rows}
        detail={detail}
        explicit={explicit}
        queueTitle={overview.scope === "equipe" ? "Fila da equipe" : "Minha fila"}
        initialTab={initialTab}
        baseQuery={scope ? { escopo: scope } : {}}
        channels={channels}
        currentUserId={user.id}
        canOperate={options.canOperate}
        canWriteArticles={canEditArticles(user)}
        articleCategories={kb.categories}
        articleModules={kb.modules}
        renderedAt={overview.generatedAt}
      />
    </PageContainer>
  );
}
