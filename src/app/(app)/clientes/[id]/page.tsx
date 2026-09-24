import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getClient, getClient360, getClientFormOptions } from "@/server/clients/queries";
import { getCommunicationChannelStatus } from "@/server/integrations/status";
import { PageContainer } from "@/components/layout/page-container";
import { ClientHeader, ClientKpis } from "@/components/clients/client-header";
import { ClientTabs, parseClientTab, type ClientTab } from "@/components/clients/client-tabs";
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
import { getSupportOptions } from "@/server/support/queries";
import { ClientCsPanel } from "@/components/cs/client-cs-panel";
import { NewTicketDialog } from "@/components/support/new-ticket-dialog";
import { AgentSuggestions } from "@/components/automations/agent-suggestions";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const client = await getClient(id);
  return { title: client ? client.tradeName : "Cliente não encontrado" };
}

const OPEN_TASKS = new Set(["aberta", "em_andamento", "aguardando"]);
const OPEN_TICKETS = new Set(["aberto", "em_atendimento", "aguardando_cliente", "reaberto"]);

/** Ficha 360º do cliente (padrão 12): cabeçalho, indicadores, Visão geral e abas por área. */
export default async function ClientePage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const user = await requireUser();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [data, options] = await Promise.all([getClient360(id), getClientFormOptions()]);
  if (!data) notFound();

  const tab = parseClientTab(query.aba);
  // Dados dos módulos carregados só na aba que os usa. As opções de chamado alimentam a ação
  // principal "Novo atendimento" do cabeçalho, então carregam sempre que o usuário acessa o Suporte.
  const canSupport = canAccessModule(user, "suporte");
  const [csData, supportOptions] = await Promise.all([tab === "cs" ? getClientCs(id) : Promise.resolve(null), canSupport ? getSupportOptions(user) : Promise.resolve(null)]);
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
    visao: <TabVisao data={data} originName={originName} ticketOptions={ticketOptions} />,
    timeline: <TabTimeline data={data} />,
    comercial: <TabComercial data={data} options={options} />,
    produtos: <TabProdutos data={data} />,
    financeiro: <TabFinanceiro data={data} />,
    implantacao: <TabImplantacao data={data} />,
    cs: (
      <TabCs
        data={data}
        panel={
          csData ? (
            <div className="flex flex-col gap-4">
              {canAccessModule(user, "cs") && data.client.status !== "cancelado" ? <AgentSuggestions kind="cs" subjectId={data.client.id} title="Sugestões do assistente de CS" limit={3} /> : null}
              <ClientCsPanel clientId={data.client.id} clientName={data.client.tradeName} data={csData} />
            </div>
          ) : null
        }
      />
    ),
    suporte: <TabSuporte data={data} action={ticketOptions ? <NewTicketDialog options={ticketOptions} fixedClient={{ id: data.client.id, name: data.client.tradeName }} /> : null} />,
    documentos: <TabDocumentos data={data} />,
    tarefas: <TabTarefas data={data} />,
  };

  return (
    <PageContainer size="full">
      <ClientHeader data={data} options={options} ticketOptions={ticketOptions} channels={getCommunicationChannelStatus()} />
      <ClientKpis data={data} />
      <ClientTabs clientId={data.client.id} active={tab} counts={counts} />
      <div className="mt-4 min-w-0">{content[tab]}</div>
    </PageContainer>
  );
}
