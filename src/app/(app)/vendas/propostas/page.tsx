import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { COLLECTIONS } from "@/domain/types";
import { ACCESS_DENIED_REDIRECT, requireScreen } from "@/server/auth/session";
import { recordExists, salesCapabilities } from "@/server/sales/access";
import { getProposalDetail, listOpenOpportunityOptions, listProductOptions, listProposals } from "@/server/sales/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { ProposalDrawer } from "@/components/sales/proposal-drawer";
import { ProposalsTable } from "@/components/sales/proposals-table";
import { SalesAccessProvider } from "@/components/sales/sales-access";

export const metadata: Metadata = { title: "Propostas" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Propostas comerciais. ?proposta=<id> abre o drawer; "vencida" é calculada na leitura pela validade. Tela
 * vendas.propostas: lista e drawer no escopo da tela; criar/editar/enviar/aceite conforme as chaves; proposta fora
 * do escopo por URL = aviso de acesso negado.
 */
export default async function PropostasPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("vendas.propostas");
  const sp = await searchParams;
  const proposalId = first(sp.proposta);
  const caps = salesCapabilities(user);
  const [rows, opportunityOptions, products, detail] = await Promise.all([
    listProposals(user),
    caps.proposals.create ? listOpenOpportunityOptions(user) : Promise.resolve([]),
    listProductOptions(),
    proposalId ? getProposalDetail(user, proposalId) : Promise.resolve(null),
  ]);
  if (proposalId && !detail && (await recordExists(COLLECTIONS.proposals, proposalId))) redirect(ACCESS_DENIED_REDIRECT);

  return (
    <SalesAccessProvider value={caps}>
      <PageContainer>
        <PageHeader title="Propostas" description="Rascunho → enviada → visualizada → negociação → aceita ou recusada." breadcrumbs={[{ label: "Vendas", href: "/vendas" }, { label: "Propostas" }]} />
        <ProposalsTable rows={rows} opportunityOptions={opportunityOptions} products={products} />
        <ProposalDrawer detail={detail} />
      </PageContainer>
    </SalesAccessProvider>
  );
}
