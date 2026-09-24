import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/server/auth/session";
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

export const metadata: Metadata = { title: "Leads" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Leads: lista ou kanban com filtros na URL; ?lead=<id> abre o drawer. */
export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const filters = parseLeadFilters(sp);
  const leadId = Array.isArray(sp.lead) ? sp.lead[0] : sp.lead;
  const [result, options, detail] = await Promise.all([listLeads(filters), getMarketingOptions(), leadId ? getLead(leadId) : Promise.resolve(null)]);
  const view = filters.view ?? "lista";
  const filtered = Boolean(filters.q || filters.status || filters.temperature || filters.origin || filters.campaignId || filters.ownerId || filters.period || filters.noContact || filters.possibleDuplicate || filters.needsAction);

  return (
    <PageContainer size={view === "kanban" ? "full" : "default"}>
      <PageHeader
        title="Leads"
        description="Captação, contato e qualificação até o MQL."
        breadcrumbs={[{ label: "Marketing", href: "/marketing" }, { label: "Leads" }]}
        actions={
          <>
            <ImportLeadsDialog options={options} />
            <NewLeadDialog options={options} currentUserId={user.id} />
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
  );
}
