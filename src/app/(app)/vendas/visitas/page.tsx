import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getSalesFormOptions, getVisitDetail, listClientAddresses, listOpenOpportunitiesByClient, listVisits } from "@/server/sales/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { NewVisitButton } from "@/components/sales/visit-form-dialog";
import { VisitDrawer, VisitsList } from "@/components/sales/visits-view";

export const metadata: Metadata = { title: "Visitas" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Visitas comerciais. ?visita=<id> abre o drawer; ?nova=1&cliente=<id>&oportunidade=<id> abre o
 * formulário pré-preenchido (link do drawer da oportunidade). Distâncias vêm de src/server/sales/maps.ts.
 */
export default async function VisitasPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "vendas")) redirect("/meu-dia?erro=sem-permissao");
  const sp = await searchParams;
  const visitId = first(sp.visita);
  const [rows, options, addresses, opportunitiesByClient, detail] = await Promise.all([
    listVisits(user),
    getSalesFormOptions(),
    listClientAddresses(),
    listOpenOpportunitiesByClient(user),
    visitId ? getVisitDetail(user, visitId) : Promise.resolve(null),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Visitas"
        description="Agenda de campo: endereço, objetivo, resultado e distância estimada até a sede."
        breadcrumbs={[{ label: "Vendas", href: "/vendas" }, { label: "Visitas" }]}
        actions={
          <NewVisitButton
            options={{ clients: options.clients, sellers: options.sellers, addresses, opportunitiesByClient }}
            currentUserId={user.id}
            canChooseSeller={user.isManager}
            initiallyOpen={first(sp.nova) === "1"}
            defaults={{ clientId: first(sp.cliente), opportunityId: first(sp.oportunidade) }}
          />
        }
      />
      <VisitsList rows={rows} />
      <VisitDrawer detail={detail} />
    </PageContainer>
  );
}
