import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarCheck, FileText, Handshake, LockKeyhole, Percent, UserPlus } from "lucide-react";
import { COLLECTIONS } from "@/domain/types";
import { ACCESS_DENIED_REDIRECT, can, requireScreen } from "@/server/auth/session";
import { recordExists, salesCapabilities } from "@/server/sales/access";
import { getSalesFormOptions, getVisitDetail, hasTeamView } from "@/server/sales/queries";
import { getSalesWorkspace, getWorkspaceOpportunity } from "@/server/sales/workspace-queries";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { NewOpportunityButton } from "@/components/sales/new-opportunity-dialog";
import { SweepButton } from "@/components/sales/sweep-button";
import { SalesAccessProvider } from "@/components/sales/sales-access";
import { SalesWorkspace } from "@/components/sales/workspace/sales-workspace";
import { CentralViewToggle, ScopeToggle, type CentralView } from "@/components/sales/workspace/view-toggle";
import { SalesPanelView } from "./painel-view";

export const metadata: Metadata = { title: "Central de Vendas" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Central de Vendas. Padrão: WORKSPACE do vendedor (fila "Meu funil" | oportunidade com conversa |
 * contexto do cliente), com ?oportunidade=<id> selecionando no workspace, ?fila=<aba> e ?tela=conversa
 * (pilha no celular). ?view=painel mostra o painel de metas, comissão, simulador, funil e histórico.
 * Quem tem escopo maior que "meus" na Central alterna Minha/Equipe com ?escopo=equipe nas duas visões.
 *
 * Acesso (catálogo vendas.central): cada visão é uma seção (workspace / painel); a comissão e as sugestões do
 * assistente são seções do painel. Seção negada: os dados nem são lidos e o controle some. Ações conforme as
 * chaves (SalesAccessProvider); oportunidade fora do escopo por URL = aviso de acesso negado.
 */
export default async function CentralDeVendasPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("vendas.central");
  const sp = await searchParams;
  const caps = salesCapabilities(user);
  const sections = {
    workspace: can(user, "vendas.central.workspace.ver"),
    painel: can(user, "vendas.central.painel.ver"),
    commission: can(user, "vendas.central.comissao.ver"),
    suggestions: can(user, "vendas.central.sugestoes.ver"),
  };
  const wanted: CentralView = first(sp.view) === "painel" ? "painel" : "workspace";
  const view: CentralView | null = sections[wanted] ? wanted : sections.workspace ? "workspace" : sections.painel ? "painel" : null;
  const teamView = await hasTeamView(user, "vendas.central");
  const scopeKind = teamView && first(sp.escopo) === "equipe" ? "equipe" : "meu";
  const scopeParam = scopeKind === "equipe" ? "equipe" : undefined;
  const requested = first(sp.oportunidade);
  const formOptions = caps.opportunities.create ? await getSalesFormOptions() : null;

  const header = (className?: string) => (
    <PageHeader
      title="Central de Vendas"
      description="Prospecte, comunique e feche negócios em todos os canais"
      breadcrumbs={[{ label: "Vendas" }, { label: "Central de Vendas" }]}
      className={className}
      actions={
        <>
          {view && sections.workspace && sections.painel ? <CentralViewToggle view={view} /> : null}
          {view && teamView ? <ScopeToggle scope={scopeKind} view={view} /> : null}
          {caps.sweep && view === "painel" ? <SweepButton /> : null}
          {formOptions ? <NewOpportunityButton options={formOptions} currentUserId={user.id} currentUserName={user.name} canChooseOwner={caps.opportunities.assign} /> : null}
        </>
      }
    />
  );

  if (!view) {
    return (
      <PageContainer>
        {header()}
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState icon={<LockKeyhole />} title="Nenhuma visão da Central liberada" description="Seu perfil não tem acesso ao workspace nem ao painel da Central de Vendas. Fale com o administrador de acessos." />
        </div>
      </PageContainer>
    );
  }

  if (view === "painel") {
    return (
      <SalesAccessProvider value={caps}>
        <PageContainer>
          {header()}
          <SalesPanelView user={user} escopo={scopeParam} sections={{ commission: sections.commission, suggestions: sections.suggestions }} />
        </PageContainer>
      </SalesAccessProvider>
    );
  }

  const data = await getSalesWorkspace(user, scopeParam);
  // Sem seleção na URL, o desktop abre a primeira da fila (o celular mostra a fila).
  const selectedId = requested ?? data.items[0]?.id ?? null;
  const visitId = first(sp.visita);
  const [detail, visitDetail] = await Promise.all([selectedId ? getWorkspaceOpportunity(user, selectedId) : Promise.resolve(null), visitId ? getVisitDetail(user, visitId) : Promise.resolve(null)]);
  // Oportunidade pedida na URL fora do escopo (existe, mas não é visível) = aviso de acesso negado.
  if (requested && !detail && (await recordExists(COLLECTIONS.opportunities, requested))) redirect(ACCESS_DENIED_REDIRECT);
  const { kpis } = data;
  const scopeQs = scopeKind === "equipe" ? "&escopo=equipe" : "";
  const drill = (fila: string) => `/vendas?fila=${fila}${scopeQs}`;
  // Com uma oportunidade aberta no celular, cabeçalho e KPIs saem da pilha (tela cheia para o trabalho).
  const mobileHidden = requested ? "max-lg:hidden" : undefined;

  return (
    <SalesAccessProvider value={caps}>
      <PageContainer size="full" className="2xl:max-w-[1760px]">
        {header(mobileHidden)}
        <KpiStrip columns={5} mobileColumns={2} className={cn("mb-4", mobileHidden)}>
          <StatCard label="Novos leads" value={formatNumber(kpis.newLeads)} icon={<UserPlus />} tone="info" hint="Em qualificação" href={drill("novos")} compact />
          <StatCard label="Em negociação" value={formatNumber(kpis.negotiating)} icon={<Handshake />} tone="secondary" hint="Negociação e fechamento" href={drill("negociacao")} compact />
          <StatCard label="Propostas enviadas" value={formatNumber(kpis.proposalsSent)} icon={<FileText />} tone="purple" hint="Aguardando o cliente" href={drill("proposta")} compact />
          <StatCard label="Visitas agendadas" value={formatNumber(kpis.visitsScheduled)} icon={<CalendarCheck />} tone="warning" hint="De hoje em diante" href={drill("visita")} compact />
          <StatCard
            label="Conversão"
            value={kpis.conversion === null ? "—" : formatPercent(kpis.conversion)}
            icon={<Percent />}
            tone="success"
            hint={`${kpis.wonMonth} ganhas / ${kpis.createdMonth} criadas no mês`}
            href={sections.painel ? `/vendas?view=painel${scopeQs}` : undefined}
            compact
            className="col-span-2 sm:col-span-1"
          />
        </KpiStrip>
        <SalesWorkspace
          items={data.items}
          stages={data.stages}
          detail={detail}
          selectedId={detail?.opportunity.id ?? requested ?? null}
          explicit={Boolean(requested)}
          queueTitle={scopeKind === "equipe" ? "Funil da equipe" : "Meu funil"}
          showOwner={scopeKind === "equipe"}
          currentUserId={user.id}
          currentUserName={user.name}
          visitDetail={visitDetail}
        />
      </PageContainer>
    </SalesAccessProvider>
  );
}
