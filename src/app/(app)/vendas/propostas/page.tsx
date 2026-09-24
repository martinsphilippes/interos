import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getProposalDetail, listOpenOpportunityOptions, listProductOptions, listProposals } from "@/server/sales/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { ProposalDrawer } from "@/components/sales/proposal-drawer";
import { ProposalsTable } from "@/components/sales/proposals-table";

export const metadata: Metadata = { title: "Propostas" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Propostas comerciais. ?proposta=<id> abre o drawer; "vencida" é calculada na leitura pela validade. */
export default async function PropostasPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "vendas")) redirect("/meu-dia?erro=sem-permissao");
  const sp = await searchParams;
  const proposalId = first(sp.proposta);
  const [rows, opportunityOptions, products, detail] = await Promise.all([
    listProposals(user),
    listOpenOpportunityOptions(user),
    listProductOptions(),
    proposalId ? getProposalDetail(user, proposalId) : Promise.resolve(null),
  ]);

  return (
    <PageContainer>
      <PageHeader title="Propostas" description="Rascunho → enviada → visualizada → negociação → aceita ou recusada." breadcrumbs={[{ label: "Vendas", href: "/vendas" }, { label: "Propostas" }]} />
      <ProposalsTable rows={rows} opportunityOptions={opportunityOptions} products={products} />
      <ProposalDrawer detail={detail} />
    </PageContainer>
  );
}
