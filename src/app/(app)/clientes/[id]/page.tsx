import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ACCESS_DENIED_REDIRECT, can, getCurrentUser, requireScreen } from "@/server/auth/session";
import { canSeeClient, canSeeClientId, clientCapabilities, clientSectionAccess } from "@/server/clients/access";
import { getClient, getClient360, getClientFormOptions } from "@/server/clients/queries";
import { getCommunicationChannelStatus } from "@/server/integrations/status";
import { PageContainer } from "@/components/layout/page-container";
import { ClientHeader, ClientKpis } from "@/components/clients/client-header";
import { CLIENT_TABS, ClientTabs, parseClientTab, type ClientTab } from "@/components/clients/client-tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { TabVisao } from "@/components/clients/tab-visao";
import { TabTimeline } from "@/components/clients/tab-timeline";
import { TabComercial } from "@/components/clients/tab-comercial";
import { TabProdutos } from "@/components/clients/tab-produtos";
import { TabFinanceiro } from "@/components/clients/tab-financeiro";
import { TabImplantacao } from "@/components/clients/tab-implantacao";
import { TabCs } from "@/components/clients/tab-cs";
import { TabSuporte } from "@/components/clients/tab-suporte";
import { TabDocumentos } from "@/components/clients/tab-documentos";
import { TabTarefas } from "@/components/clients/tab-tarefas";
import { getClientCs } from "@/server/cs/queries";
import { csCapabilities, csLinks } from "@/server/cs/access";
import { getSupportOptions } from "@/server/support/queries";
import { ClientCsPanel } from "@/components/cs/client-cs-panel";
import { NewTicketDialog } from "@/components/support/new-ticket-dialog";
import { AgentSuggestions } from "@/components/automations/agent-suggestions";
import { PortalLinksCard } from "@/components/portal/portal-links-card";
import { listPortalLinks } from "@/server/portal/service";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/** A30: permissão e escopo ANTES de ler o cliente; sem acesso, título genérico (não revela o nome). */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !(await canSeeClientId(user, id))) return { title: "Cliente 360º" };
  const client = await getClient(id);
  return { title: client ? client.tradeName : "Cliente não encontrado" };
}

const OPEN_TASKS = new Set(["aberta", "em_andamento", "aguardando"]);
const OPEN_TICKETS = new Set(["aberto", "em_atendimento", "aguardando_cliente", "reaberto"]);

/**
 * Ficha 360º do cliente (padrão 12): cabeçalho, indicadores, Visão geral e abas por área. Cada aba é uma seção do
 * catálogo (operacao.clientes.<aba>.ver): aba negada não aparece e os dados dela não são carregados; cliente fora do
 * escopo do usuário = acesso negado.
 */
export default async function ClientePage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const user = await requireScreen("operacao.clientes");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const client = await getClient(id);
  if (!client) notFound();
  if (!(await canSeeClient(user, client))) redirect(ACCESS_DENIED_REDIRECT);

  const sections = clientSectionAccess(user);
  const caps = clientCapabilities(user);
  const visibleTabs = CLIENT_TABS.map((t) => t.key).filter((key) => sections[key]);
  const requested = parseClientTab(query.aba);
  const tab: ClientTab | null = sections[requested] ? requested : (visibleTabs[0] ?? null);

  const [data, options] = await Promise.all([getClient360(id, { sections, withAvailableProducts: caps.createOpportunity, user }), getClientFormOptions()]);
  if (!data) notFound();

  // Dados dos módulos carregados só na aba que os usa. As opções de chamado alimentam a ação
  // principal "Novo atendimento" do cabeçalho, então carregam sempre que o usuário pode abrir chamado.
  const canSupport = can(user, "suporte.chamados.criar");
  const [csData, supportOptions] = await Promise.all([tab === "cs" ? getClientCs(id, user) : Promise.resolve(null), canSupport ? getSupportOptions(user) : Promise.resolve(null)]);
  // Portal do cliente (D31) na aba Financeiro: seção financeiro.contratos.portal.ver; links lidos só nessa aba e só
  // quando o cliente tem contrato (o portal mostra contratos e cobranças).
  const showPortal = tab === "financeiro" && can(user, "financeiro.contratos.portal.ver") && data.contracts.length > 0;
  const portal = showPortal ? await listPortalLinks(id) : null;
  const ticketOptions = supportOptions ? { clients: supportOptions.clients, products: supportOptions.products, team: supportOptions.team, categories: supportOptions.categories, slaRules: supportOptions.slaRules } : null;
  const originName = data.client.origin ? (options.leadSources.find((s) => s.key === data.client.origin)?.name ?? data.client.origin) : undefined;
  const counts: Partial<Record<ClientTab, number>> = {
    timeline: data.timeline.length,
    comercial: data.opportunities.filter((o) => o.stage !== "ganho" && o.stage !== "perdido").length,
    produtos: data.products.filter((p) => p.status !== "cancelado").length,
    financeiro: data.financial.overdueCount,
    implantacao: data.projects.filter((p) => p.status !== "concluida" && p.status !== "cancelada").length,
    cs: data.successPlans.filter((p) => p.status === "ativo").length,
    suporte: data.tickets.filter((t) => OPEN_TICKETS.has(t.status)).length,
    documentos: data.documents.length,
    tarefas: data.tasks.filter((t) => OPEN_TASKS.has(t.status)).length,
  };

  const content: Record<ClientTab, React.ReactNode> = {
    visao: <TabVisao data={data} originName={originName} ticketOptions={ticketOptions} sections={sections} can={caps} />,
    timeline: <TabTimeline data={data} canRegister={caps.register} />,
    comercial: <TabComercial data={data} options={options} canCreateOpportunity={caps.createOpportunity} />,
    produtos: <TabProdutos data={data} canCreateOpportunity={caps.createOpportunity} />,
    financeiro: (
      <TabFinanceiro
        data={data}
        portal={
          portal ? (
            <PortalLinksCard
              clientId={data.client.id}
              clientName={data.client.tradeName}
              links={portal.active}
              inactiveCount={portal.inactiveCount}
              canCreate={can(user, "financeiro.contratos.portal.gerar") && data.contracts.some((c) => c.status !== "cancelado")}
              canRevoke={can(user, "financeiro.contratos.portal.revogar")}
            />
          ) : null
        }
      />
    ),
    implantacao: <TabImplantacao data={data} />,
    cs: (
      <TabCs
        data={data}
        panel={
          csData ? (
            <div className="flex flex-col gap-4">
              {can(user, "cs.carteira.sugestoes.ver") && data.client.status !== "cancelado" ? <AgentSuggestions kind="cs" subjectId={data.client.id} title="Sugestões do assistente de CS" limit={3} /> : null}
              <ClientCsPanel clientId={data.client.id} clientName={data.client.tradeName} data={csData} capabilities={csCapabilities(user)} links={csLinks(user)} />
            </div>
          ) : null
        }
      />
    ),
    suporte: <TabSuporte data={data} action={ticketOptions ? <NewTicketDialog options={ticketOptions} fixedClient={{ id: data.client.id, name: data.client.tradeName }} /> : null} />,
    documentos: <TabDocumentos data={data} canAttach={caps.attachDocument} />,
    tarefas: <TabTarefas data={data} canCreate={caps.createTask} />,
  };

  return (
    <PageContainer size="full">
      <ClientHeader data={data} options={options} ticketOptions={ticketOptions} channels={getCommunicationChannelStatus()} can={caps} />
      <ClientKpis data={data} sections={sections} showValues={can(user, "financeiro.valores.ver")} />
      {tab ? (
        <>
          <ClientTabs clientId={data.client.id} active={tab} counts={counts} visible={visibleTabs} />
          <div className="mt-4 min-w-0">{content[tab]}</div>
        </>
      ) : (
        <EmptyState className="mt-4" title="Nenhuma seção liberada" description="Seu perfil vê o cadastro deste cliente, mas nenhuma seção da ficha. Fale com o administrador se precisar de acesso." />
      )}
    </PageContainer>
  );
}
