import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { List } from "lucide-react";
import { COLLECTIONS } from "@/domain/types";
import { ACCESS_DENIED_REDIRECT, can, requireScreen } from "@/server/auth/session";
import { recordExists, salesCapabilities } from "@/server/sales/access";
import { currentCompetence, getOpportunityDetail, getSalesFormOptions, listOpportunities } from "@/server/sales/queries";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { NewOpportunityButton } from "@/components/sales/new-opportunity-dialog";
import { OpportunityDrawer } from "@/components/sales/opportunity-drawer";
import { PipelineBoard } from "@/components/sales/pipeline-board";
import { SalesAccessProvider } from "@/components/sales/sales-access";

export const metadata: Metadata = { title: "Pipeline" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Kanban do funil de vendas. Filtros na URL (aplicados no cliente); ?oportunidade=<id> abre o drawer. Tela
 * vendas.pipeline; lista e drawer no escopo da tela (mesmo de Oportunidades); arrastar/ganhar/perder conforme as
 * chaves (sem edição = quadro só leitura); oportunidade fora do escopo por URL = aviso de acesso negado.
 */
export default async function PipelinePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("vendas.pipeline");
  const sp = await searchParams;
  const oppId = first(sp.oportunidade);
  const caps = salesCapabilities(user);
  const [data, options, detail] = await Promise.all([
    listOpportunities(user, "vendas.pipeline"),
    caps.opportunities.create ? getSalesFormOptions() : Promise.resolve(null),
    oppId ? getOpportunityDetail(user, oppId, "vendas.pipeline") : Promise.resolve(null),
  ]);
  if (oppId && !detail && (await recordExists(COLLECTIONS.opportunities, oppId))) redirect(ACCESS_DENIED_REDIRECT);

  return (
    <SalesAccessProvider value={caps}>
      <PageContainer size="full">
        <PageHeader
          title="Pipeline"
          description="Arraste os cards entre as etapas. Solte em Ganho ou Perdido para encerrar."
          breadcrumbs={[{ label: "Vendas", href: "/vendas" }, { label: "Pipeline" }]}
          actions={
            <>
              {caps.opportunities.view ? (
                <Button variant="outline" asChild className="min-h-[44px] md:min-h-0">
                  <Link href="/vendas/oportunidades">
                    <List /> Lista
                  </Link>
                </Button>
              ) : null}
              {options ? <NewOpportunityButton options={options} currentUserId={user.id} currentUserName={user.name} canChooseOwner={caps.opportunities.assign} canCreateClient={can(user, "operacao.clientes.criar")} /> : null}
            </>
          }
        />
        <PipelineBoard rows={data.rows} stages={data.stages} sellers={data.sellers} products={data.products} currentUserId={user.id} competence={currentCompetence()} />
        <OpportunityDrawer detail={detail} />
      </PageContainer>
    </SalesAccessProvider>
  );
}
