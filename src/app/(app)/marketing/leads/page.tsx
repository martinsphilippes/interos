import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ACCESS_DENIED_REDIRECT, requireScreen } from "@/server/auth/session";
import { leadAccess, leadExists, marketingCapabilities } from "@/server/marketing/access";
import { getLead, getMarketingOptions, listLeads } from "@/server/marketing/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { ImportLeadsDialog } from "@/components/marketing/import-leads-dialog";
import { LeadDrawer } from "@/components/marketing/lead-drawer";
import { LeadsFilters } from "@/components/marketing/leads-filters";
import { LeadsKanban } from "@/components/marketing/leads-kanban";
import { LeadsTable } from "@/components/marketing/leads-table";
import { LeadsViewSwitch } from "@/components/marketing/leads-view-switch";
import { NewLeadDialog } from "@/components/marketing/new-lead-dialog";
import { parseLeadFilters } from "@/components/marketing/marketing-model";
import { MarketingAccessProvider } from "@/components/marketing/marketing-access";

export const metadata: Metadata = { title: "Leads" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Leads: lista ou kanban com filtros na URL; ?lead=<id> abre o drawer. Tela marketing.leads (A14); lista e ficha no
 * escopo da tela (lead fora do escopo = aviso de acesso negado); ações conforme as chaves (sem edição = ficha só
 * leitura).
 */
export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("marketing.leads");
  const sp = await searchParams;
  const filters = parseLeadFilters(sp);
  const leadId = Array.isArray(sp.lead) ? sp.lead[0] : sp.lead;
  const caps = marketingCapabilities(user);
  const access = await leadAccess(user);
  const [result, options, detail] = await Promise.all([listLeads(filters, access), getMarketingOptions(), leadId ? getLead(leadId, access) : Promise.resolve(null)]);
  if (leadId && !detail && (await leadExists(leadId))) redirect(ACCESS_DENIED_REDIRECT);
  const view = filters.view ?? "lista";
  const filtered = Boolean(filters.q || filters.status || filters.temperature || filters.origin || filters.campaignId || filters.ownerId || filters.period || filters.noContact || filters.possibleDuplicate || filters.needsAction);

  return (
    <MarketingAccessProvider value={caps}>
      <PageContainer size={view === "kanban" ? "full" : "default"}>
        <PageHeader
          title="Leads"
          description="Captação, contato e qualificação até o MQL."
          breadcrumbs={[{ label: "Marketing", href: "/marketing" }, { label: "Leads" }]}
          actions={
            <>
              {caps.leads.import ? <ImportLeadsDialog options={options} /> : null}
              {caps.leads.create ? <NewLeadDialog options={options} currentUserId={user.id} openOnUrlFlag /> : null}
            </>
          }
        >
          <Suspense fallback={null}>
            <LeadsViewSwitch view={view} />
          </Suspense>
        </PageHeader>

        <div className="flex flex-col gap-4">
          <Suspense fallback={null}>
            <LeadsFilters filters={filters} options={options} total={result.total} />
          </Suspense>
          <Suspense fallback={null}>{view === "kanban" ? <LeadsKanban items={result.items} sellers={options.sellers} /> : <LeadsTable items={result.items} filtered={filtered} />}</Suspense>
        </div>

        <Suspense fallback={null}>
          <LeadDrawer detail={detail} options={options} />
        </Suspense>
      </PageContainer>
    </MarketingAccessProvider>
  );
}
