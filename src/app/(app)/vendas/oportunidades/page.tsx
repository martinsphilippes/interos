import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Kanban } from "lucide-react";
import { COLLECTIONS } from "@/domain/types";
import { ACCESS_DENIED_REDIRECT, can, requireScreen } from "@/server/auth/session";
import { opportunityScope, recordExists, salesCapabilities } from "@/server/sales/access";
import { currentCompetence, getOpportunityDetail, getSalesFormOptions, listOpportunities } from "@/server/sales/queries";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { NewOpportunityButton } from "@/components/sales/new-opportunity-dialog";
import { OpportunitiesTable } from "@/components/sales/opportunities-table";
import { OpportunityDrawer } from "@/components/sales/opportunity-drawer";
import { SalesAccessProvider } from "@/components/sales/sales-access";

export const metadata: Metadata = { title: "Oportunidades" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const DESCRIPTION_BY_SCOPE: Record<string, string> = {
  meus: "Oportunidades sob sua responsabilidade ou originadas por você.",
  equipe: "Oportunidades da sua equipe.",
  departamento: "Oportunidades do seu departamento.",
  empresa: "Todas as oportunidades do time comercial.",
  unidades: "Todas as oportunidades do time comercial.",
};

/**
 * Todas as oportunidades visíveis, com filtros/ordenação na URL. ?oportunidade=<id> abre o drawer. Tela
 * vendas.oportunidades (dona da entidade): lista e drawer no escopo da tela; ações conforme as chaves (sem edição =
 * drawer só leitura); oportunidade fora do escopo por URL = aviso de acesso negado.
 */
export default async function OportunidadesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("vendas.oportunidades");
  const sp = await searchParams;
  const oppId = first(sp.oportunidade);
  const caps = salesCapabilities(user);
  const [data, options, detail, scope] = await Promise.all([
    listOpportunities(user),
    caps.opportunities.create ? getSalesFormOptions() : Promise.resolve(null),
    oppId ? getOpportunityDetail(user, oppId) : Promise.resolve(null),
    opportunityScope(user),
  ]);
  if (oppId && !detail && (await recordExists(COLLECTIONS.opportunities, oppId))) redirect(ACCESS_DENIED_REDIRECT);

  return (
    <SalesAccessProvider value={caps}>
      <PageContainer>
        <PageHeader
          title="Oportunidades"
          description={DESCRIPTION_BY_SCOPE[scope.kind]}
          breadcrumbs={[{ label: "Vendas", href: "/vendas" }, { label: "Oportunidades" }]}
          actions={
            <>
              {can(user, "vendas.pipeline.ver") ? (
                <Button variant="outline" asChild className="min-h-[44px] md:min-h-0">
                  <Link href="/vendas/pipeline">
                    <Kanban /> Pipeline
                  </Link>
                </Button>
              ) : null}
              {options ? <NewOpportunityButton options={options} currentUserId={user.id} currentUserName={user.name} canChooseOwner={caps.opportunities.assign} openOnUrlFlag /> : null}
            </>
          }
        />
        <OpportunitiesTable rows={data.rows} stages={data.stages} sellers={data.sellers} products={data.products} currentUserId={user.id} competence={currentCompetence()} />
        <OpportunityDrawer detail={detail} />
      </PageContainer>
    </SalesAccessProvider>
  );
}
