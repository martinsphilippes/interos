import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getClient, getClient360, getClientFormOptions } from "@/server/clients/queries";
import { PageContainer } from "@/components/layout/page-container";
import { ClientHeader } from "@/components/clients/client-header";
import { ClientTabs, parseClientTab, type ClientTab } from "@/components/clients/client-tabs";
import { ContactsCard } from "@/components/clients/contacts-card";
import { TabTimeline } from "@/components/clients/tab-timeline";
import { TabComercial } from "@/components/clients/tab-comercial";
import { TabProdutos } from "@/components/clients/tab-produtos";
import { TabFinanceiro } from "@/components/clients/tab-financeiro";
import { TabImplantacao } from "@/components/clients/tab-implantacao";
import { TabCs } from "@/components/clients/tab-cs";
import { TabSuporte } from "@/components/clients/tab-suporte";
import { TabDocumentos } from "@/components/clients/tab-documentos";
import { TabTarefas } from "@/components/clients/tab-tarefas";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const client = await getClient(id);
  return { title: client ? client.tradeName : "Cliente não encontrado" };
}

const OPEN_TASKS = new Set(["aberta", "em_andamento", "aguardando"]);
const OPEN_TICKETS = new Set(["aberto", "em_atendimento", "aguardando_cliente", "reaberto"]);

/** Ficha 360º do cliente: cabeçalho, abas por área e contatos. */
export default async function ClientePage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await requireUser();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [data, options] = await Promise.all([getClient360(id), getClientFormOptions()]);
  if (!data) notFound();

  const tab = parseClientTab(query.aba);
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
    timeline: <TabTimeline data={data} />,
    comercial: <TabComercial data={data} options={options} />,
    produtos: <TabProdutos data={data} />,
    financeiro: <TabFinanceiro data={data} />,
    implantacao: <TabImplantacao data={data} />,
    cs: <TabCs data={data} />,
    suporte: <TabSuporte data={data} />,
    documentos: <TabDocumentos data={data} />,
    tarefas: <TabTarefas data={data} />,
  };

  return (
    <PageContainer size="full">
      <ClientHeader data={data} options={options} />
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <ClientTabs clientId={data.client.id} active={tab} counts={counts} />
          <div className="mt-4">{content[tab]}</div>
        </div>
        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[calc(var(--spacing-topbar)+16px)] lg:self-start">
          <ContactsCard clientId={data.client.id} contacts={data.contacts} />
        </aside>
      </div>
    </PageContainer>
  );
}
