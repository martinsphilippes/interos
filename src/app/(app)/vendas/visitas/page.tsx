import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { COLLECTIONS } from "@/domain/types";
import { ACCESS_DENIED_REDIRECT, requireScreen } from "@/server/auth/session";
import { recordExists, salesCapabilities } from "@/server/sales/access";
import { getSalesFormOptions, getVisitDetail, listClientAddresses, listOpenOpportunitiesByClient, listVisits } from "@/server/sales/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { SalesAccessProvider } from "@/components/sales/sales-access";
import { NewVisitButton } from "@/components/sales/visit-form-dialog";
import { VisitDrawer, VisitsList } from "@/components/sales/visits-view";

export const metadata: Metadata = { title: "Visitas" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Visitas comerciais. ?visita=<id> abre o drawer; ?nova=1&cliente=<id>&oportunidade=<id> abre o
 * formulário pré-preenchido (link do drawer da oportunidade). Distâncias vêm de src/server/sales/maps.ts.
 * Tela vendas.visitas: lista e drawer no escopo da tela; agendar/concluir/cancelar/remarcar conforme as chaves;
 * visita fora do escopo por URL = aviso de acesso negado.
 */
export default async function VisitasPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("vendas.visitas");
  const sp = await searchParams;
  const visitId = first(sp.visita);
  const caps = salesCapabilities(user);
  const canCreate = caps.visits.create;
  const [rows, options, addresses, opportunitiesByClient, detail] = await Promise.all([
    listVisits(user),
    canCreate ? getSalesFormOptions() : Promise.resolve(null),
    canCreate ? listClientAddresses() : Promise.resolve({}),
    canCreate ? listOpenOpportunitiesByClient(user) : Promise.resolve({}),
    visitId ? getVisitDetail(user, visitId) : Promise.resolve(null),
  ]);
  if (visitId && !detail && (await recordExists(COLLECTIONS.visits, visitId))) redirect(ACCESS_DENIED_REDIRECT);

  return (
    <SalesAccessProvider value={caps}>
      <PageContainer>
        <PageHeader
          title="Visitas"
          description="Agenda de campo: endereço, objetivo, resultado e distância estimada até a sede."
          breadcrumbs={[{ label: "Vendas", href: "/vendas" }, { label: "Visitas" }]}
          actions={
            options ? (
              <NewVisitButton
                options={{ clients: options.clients, sellers: options.sellers, addresses, opportunitiesByClient }}
                currentUserId={user.id}
                canChooseSeller={caps.visits.assign}
                initiallyOpen={first(sp.nova) === "1"}
                defaults={{ clientId: first(sp.cliente), opportunityId: first(sp.oportunidade) }}
              />
            ) : undefined
          }
        />
        <VisitsList rows={rows} />
        <VisitDrawer detail={detail} />
      </PageContainer>
    </SalesAccessProvider>
  );
}
