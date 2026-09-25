import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { List } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { currentCompetence, getOpportunityDetail, getSalesFormOptions, listOpportunities } from "@/server/sales/queries";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { NewOpportunityButton } from "@/components/sales/new-opportunity-dialog";
import { OpportunityDrawer } from "@/components/sales/opportunity-drawer";
import { PipelineBoard } from "@/components/sales/pipeline-board";

export const metadata: Metadata = { title: "Pipeline" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Kanban do funil de vendas. Filtros na URL (aplicados no cliente); ?oportunidade=<id> abre o drawer. */
export default async function PipelinePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "vendas")) redirect("/meu-dia?erro=sem-permissao");
  const sp = await searchParams;
  const oppId = first(sp.oportunidade);
  const [data, options, detail] = await Promise.all([listOpportunities(user), getSalesFormOptions(), oppId ? getOpportunityDetail(user, oppId) : Promise.resolve(null)]);

  return (
    <PageContainer size="full">
      <PageHeader
        title="Pipeline"
        description="Arraste os cards entre as etapas. Solte em Ganho ou Perdido para encerrar."
        breadcrumbs={[{ label: "Vendas", href: "/vendas" }, { label: "Pipeline" }]}
        actions={
          <>
            <Button variant="outline" asChild className="min-h-[44px] md:min-h-0">
              <Link href="/vendas/oportunidades">
                <List /> Lista
              </Link>
            </Button>
            <NewOpportunityButton options={options} currentUserId={user.id} />
          </>
        }
      />
      <PipelineBoard rows={data.rows} stages={data.stages} sellers={data.sellers} products={data.products} currentUserId={user.id} competence={currentCompetence()} />
      <OpportunityDrawer detail={detail} />
    </PageContainer>
  );
}
