import type { Metadata } from "next";
import { Suspense } from "react";
import { CircleDollarSign, Flag, Target, UserPlus } from "lucide-react";
import { canSeeHref, requireScreen } from "@/server/auth/session";
import { MARKETING_SCREENS, marketingCapabilities, screenScope } from "@/server/marketing/access";
import { getMarketingOptions, listCampaigns } from "@/server/marketing/queries";
import { formatCurrency, formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { CampaignsView, NewCampaignButton } from "@/components/marketing/campaigns-view";
import { MarketingAccessProvider } from "@/components/marketing/marketing-access";

export const metadata: Metadata = { title: "Campanhas" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Campanhas: investimento x resultado (leads, MQLs, CPL, conversão). ?campanha=<id>|nova abre o drawer.
 * Tela marketing.campanhas (A14); lista no escopo da tela; criar e editar pelas chaves próprias (antes o mesmo
 * predicado "gestor ou Marketing" copiado em três lugares); sem as chaves a tela é só leitura.
 */
export default async function CampanhasPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("marketing.campanhas");
  const sp = await searchParams;
  const param = Array.isArray(sp.campanha) ? sp.campanha[0] : sp.campanha;
  const scope = await screenScope(user, MARKETING_SCREENS.campaigns);
  const [campaigns, options] = await Promise.all([listCampaigns(scope), getMarketingOptions()]);
  const caps = marketingCapabilities(user);
  const canCreate = caps.campaigns.create;
  const canEdit = caps.campaigns.edit;
  const editing = !param ? null : param === "nova" ? (canCreate ? "nova" : null) : canEdit ? (campaigns.find((c) => c.id === param) ?? null) : null;
  const leadsHref = "/marketing/leads?ordenar=data";

  const active = campaigns.filter((c) => c.status === "ativa");
  const spent = active.reduce((s, c) => s + c.spent, 0);
  const leads = active.reduce((s, c) => s + c.leads, 0);
  const mqls = active.reduce((s, c) => s + c.mqls, 0);

  return (
    <MarketingAccessProvider value={caps}>
      <PageContainer>
        <PageHeader
          title="Campanhas"
          description="Investimento e resultado de cada ação de marketing. Os números vêm dos leads vinculados."
          breadcrumbs={[{ label: "Marketing", href: "/marketing" }, { label: "Campanhas" }]}
          actions={
            canCreate ? (
              <Suspense fallback={null}>
                <NewCampaignButton />
              </Suspense>
            ) : undefined
          }
        />
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Campanhas ativas" value={formatNumber(active.length)} icon={<Flag />} tone="info" hint={`${campaigns.length} no total`} compact />
          <StatCard label="Gasto nas ativas" value={formatCurrency(spent)} icon={<CircleDollarSign />} tone="neutral" hint={`Orçamento: ${formatCurrency(active.reduce((s, c) => s + c.budget, 0))}`} compact />
          <StatCard label="Leads das ativas" value={formatNumber(leads)} icon={<UserPlus />} tone="info" href={canSeeHref(user, leadsHref) ? leadsHref : undefined} hint={leads > 0 ? `CPL médio ${formatCurrency(spent / leads)}` : "Sem leads ainda"} compact />
          <StatCard label="MQLs das ativas" value={formatNumber(mqls)} icon={<Target />} tone="success" hint={leads > 0 ? `${Math.round((mqls / leads) * 100)}% dos leads` : undefined} compact />
        </div>
        <Suspense fallback={null}>
          <CampaignsView campaigns={campaigns} editing={editing} users={options.users} canEdit={canEdit} canCreate={canCreate} />
        </Suspense>
      </PageContainer>
    </MarketingAccessProvider>
  );
}
