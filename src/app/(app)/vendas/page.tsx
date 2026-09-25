import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarCheck, FileText, Handshake, Percent, UserPlus } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getSalesFormOptions, getVisitDetail } from "@/server/sales/queries";
import { getSalesWorkspace, getWorkspaceOpportunity } from "@/server/sales/workspace-queries";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { NewOpportunityButton } from "@/components/sales/new-opportunity-dialog";
import { SweepButton } from "@/components/sales/sweep-button";
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
 * Gestores alternam o escopo com ?escopo=equipe nas duas visões.
 */
export default async function CentralDeVendasPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "vendas")) redirect("/meu-dia?erro=sem-permissao");
  const sp = await searchParams;
  const view: CentralView = first(sp.view) === "painel" ? "painel" : "workspace";
  const escopo = first(sp.escopo);
  const scopeKind = user.isManager && escopo === "equipe" ? "equipe" : "meu";
  const requested = first(sp.oportunidade);
  const formOptions = await getSalesFormOptions();

  const header = (className?: string) => (
    <PageHeader
      title="Central de Vendas"
      description="Prospecte, comunique e feche negócios em todos os canais"
      breadcrumbs={[{ label: "Vendas" }, { label: "Central de Vendas" }]}
      className={className}
      actions={
        <>
          <CentralViewToggle view={view} />
          {user.isManager ? <ScopeToggle scope={scopeKind} view={view} /> : null}
          {user.isManager && view === "painel" ? <SweepButton /> : null}
          <NewOpportunityButton options={formOptions} currentUserId={user.id} />
        </>
      }
    />
  );

  if (view === "painel") {
    return (
      <PageContainer>
        {header()}
        <SalesPanelView user={user} escopo={escopo} />
      </PageContainer>
    );
  }

  const data = await getSalesWorkspace(user, escopo);
  // Sem seleção na URL, o desktop abre a primeira da fila (o celular mostra a fila).
  const selectedId = requested ?? data.items[0]?.id ?? null;
  const visitId = first(sp.visita);
  const [detail, visitDetail] = await Promise.all([selectedId ? getWorkspaceOpportunity(user, selectedId) : Promise.resolve(null), visitId ? getVisitDetail(user, visitId) : Promise.resolve(null)]);
  const { kpis } = data;
  const scopeQs = scopeKind === "equipe" ? "&escopo=equipe" : "";
  const drill = (fila: string) => `/vendas?fila=${fila}${scopeQs}`;
  // Com uma oportunidade aberta no celular, cabeçalho e KPIs saem da pilha (tela cheia para o trabalho).
  const mobileHidden = requested ? "max-lg:hidden" : undefined;

  return (
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
          href={`/vendas?view=painel${scopeQs}`}
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
        isManager={user.isManager}
        visitDetail={visitDetail}
      />
    </PageContainer>
  );
}
