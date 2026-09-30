import type { Metadata } from "next";
import Link from "next/link";
import { Headset } from "lucide-react";
import { canSeeHref, requireScreen } from "@/server/auth/session";
import { getSupportOptions, getTicket, listTickets } from "@/server/support/queries";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { NewTicketDialog } from "@/components/support/new-ticket-dialog";
import { TicketDrawer } from "@/components/support/ticket-drawer";
import { TicketsTable } from "@/components/support/tickets-table";
import { readTicketFilters } from "@/components/support/filters";

export const metadata: Metadata = { title: "Chamados" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Todos os chamados (abertos, resolvidos e fechados) com filtros na URL. ?chamado=<id> abre o resumo.
 * Acesso: tela suporte.chamados; a lista e o resumo respeitam o escopo de Chamados (A7/A29).
 */
export default async function TicketsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("suporte.chamados");
  const sp = await searchParams;
  const ticketId = Array.isArray(sp.chamado) ? sp.chamado[0] : sp.chamado;
  const [rows, options, detail] = await Promise.all([listTickets({}, user), getSupportOptions(user), ticketId ? getTicket(ticketId, user) : Promise.resolve(null)]);
  const caps = options.capabilities;

  return (
    <PageContainer>
      <PageHeader
        title="Chamados"
        description="Histórico completo de chamados, com SLA, reincidência e avaliação."
        breadcrumbs={[{ label: "Suporte", href: "/suporte" }, { label: "Chamados" }]}
        actions={
          <>
            {canSeeHref(user, "/suporte") ? (
              <Button asChild variant="outline" className="min-h-[44px] md:min-h-0">
                <Link href="/suporte">
                  <Headset /> Central
                </Link>
              </Button>
            ) : null}
            {caps.createTicket ? <NewTicketDialog options={options} openOnUrlFlag /> : null}
          </>
        }
      />
      <TicketsTable rows={rows} mode="todos" team={options.team} products={options.products} currentUserId={user.id} canAssume={caps.assume} initialFilters={readTicketFilters(sp)} />
      <TicketDrawer detail={detail} currentUserId={user.id} canAssume={caps.assume} />
    </PageContainer>
  );
}
