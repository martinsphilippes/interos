import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Kanban } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { currentCompetence, getOpportunityDetail, getSalesFormOptions, listOpportunities } from "@/server/sales/queries";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { NewOpportunityButton } from "@/components/sales/new-opportunity-dialog";
import { OpportunitiesTable } from "@/components/sales/opportunities-table";
import { OpportunityDrawer } from "@/components/sales/opportunity-drawer";

export const metadata: Metadata = { title: "Oportunidades" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Todas as oportunidades visíveis, com filtros/ordenação na URL. ?oportunidade=<id> abre o drawer. */
export default async function OportunidadesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "vendas")) redirect("/meu-dia?erro=sem-permissao");
  const sp = await searchParams;
  const oppId = first(sp.oportunidade);
  const [data, options, detail] = await Promise.all([listOpportunities(user), getSalesFormOptions(), oppId ? getOpportunityDetail(user, oppId) : Promise.resolve(null)]);

  return (
    <PageContainer>
      <PageHeader
        title="Oportunidades"
        description={user.isManager ? "Todas as oportunidades do time comercial." : "Oportunidades sob sua responsabilidade ou originadas por você."}
        breadcrumbs={[{ label: "Vendas", href: "/vendas" }, { label: "Oportunidades" }]}
        actions={
          <>
            <Button variant="outline" asChild className="min-h-[44px] md:min-h-0">
              <Link href="/vendas/pipeline">
                <Kanban /> Pipeline
              </Link>
            </Button>
            <NewOpportunityButton options={options} currentUserId={user.id} openOnUrlFlag />
          </>
        }
      />
      <OpportunitiesTable rows={data.rows} stages={data.stages} sellers={data.sellers} products={data.products} currentUserId={user.id} competence={currentCompetence()} />
      <OpportunityDrawer detail={detail} />
    </PageContainer>
  );
}
