import type { Metadata } from "next";
import { Suspense } from "react";
import { CircleDollarSign, Flag, Target, UserPlus } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getMarketingOptions, listCampaigns } from "@/server/marketing/queries";
import { formatCurrency, formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { CampaignsView, NewCampaignButton } from "@/components/marketing/campaigns-view";

export const metadata: Metadata = { title: "Campanhas" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Campanhas: investimento x resultado (leads, MQLs, CPL, conversão). ?campanha=<id>|nova abre o drawer. */
export default async function CampanhasPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const param = Array.isArray(sp.campanha) ? sp.campanha[0] : sp.campanha;
  const [campaigns, options] = await Promise.all([listCampaigns(), getMarketingOptions()]);
  const canEdit = user.isManager || user.role === "marketing";
  const editing = !canEdit || !param ? null : param === "nova" ? "nova" : (campaigns.find((c) => c.id === param) ?? null);

  const active = campaigns.filter((c) => c.status === "ativa");
  const spent = active.reduce((s, c) => s + c.spent, 0);
  const leads = active.reduce((s, c) => s + c.leads, 0);
  const mqls = active.reduce((s, c) => s + c.mqls, 0);

  return (
    <PageContainer>
      <PageHeader
        title="Campanhas"
        description="Investimento e resultado de cada ação de marketing. Os números vêm dos leads vinculados."
        breadcrumbs={[{ label: "Marketing", href: "/marketing" }, { label: "Campanhas" }]}
        actions={
          canEdit ? (
            <Suspense fallback={null}>
              <NewCampaignButton />
            </Suspense>
          ) : undefined
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Campanhas ativas" value={formatNumber(active.length)} icon={<Flag />} tone="info" hint={`${campaigns.length} no total`} compact />
        <StatCard label="Gasto nas ativas" value={formatCurrency(spent)} icon={<CircleDollarSign />} tone="neutral" hint={`Orçamento: ${formatCurrency(active.reduce((s, c) => s + c.budget, 0))}`} compact />
        <StatCard label="Leads das ativas" value={formatNumber(leads)} icon={<UserPlus />} tone="info" href="/marketing/leads?ordenar=data" hint={leads > 0 ? `CPL médio ${formatCurrency(spent / leads)}` : "Sem leads ainda"} compact />
        <StatCard label="MQLs das ativas" value={formatNumber(mqls)} icon={<Target />} tone="success" hint={leads > 0 ? `${Math.round((mqls / leads) * 100)}% dos leads` : undefined} compact />
      </div>
      <Suspense fallback={null}>
        <CampaignsView campaigns={campaigns} editing={editing} users={options.users} canEdit={canEdit} />
      </Suspense>
    </PageContainer>
  );
}
