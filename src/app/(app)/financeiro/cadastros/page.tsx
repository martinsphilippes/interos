import type { Metadata } from "next";
import Link from "next/link";
import { History, Landmark, Tags, Target, TriangleAlert } from "lucide-react";
import { requireScreen } from "@/server/auth/session";
import { getRegistryWorkspace } from "@/server/finance-registry/queries";
import { PageContainer } from "@/components/layout/page-container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Timeline } from "@/components/timeline/timeline";
import { AccountsPanel } from "@/components/finance-registry/accounts-panel";
import { CentersPanel } from "@/components/finance-registry/centers-panel";
import { CategoriesPanel } from "@/components/finance-registry/categories-panel";
import { ImportButton } from "@/components/finance-registry/import-button";
import { RegistryTabs } from "@/components/finance-registry/registry-tabs";

export const metadata: Metadata = { title: "Cadastros financeiros" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/**
 * Financeiro › Cadastros financeiros (etapa CP/CR 1): contas financeiras, centros de custo e categorias de
 * receita/despesa com subcategoria (?aba=contas|centros|categorias; ?item=<id> filtra o histórico). Tela
 * financeiro.cadastros; cada aba é uma seção; cada botão pela sua chave (calculada no servidor; as actions revalidam).
 * Saldo sob "Visualizar valores". Histórico = eventos de auditoria ("de → para" e motivo).
 */
export default async function FinanceRegistryPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("financeiro.cadastros");
  const sp = await searchParams;
  const item = first(sp.item);
  const ws = await getRegistryWorkspace(user, { tab: first(sp.aba), item });
  const importButton = ws.importPlan && ws.can.import ? <ImportButton plan={ws.importPlan} /> : null;

  return (
    <PageContainer size="full" className="max-w-[1680px]">
      <PageHeader
        title="Cadastros financeiros"
        description="Contas financeiras, centros de custo e categorias (com subcategorias) que classificam títulos e lançamentos"
        breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Cadastros financeiros" }]}
        actions={ws.tab !== "contas" && importButton ? importButton : undefined}
      />

      <KpiStrip columns={4} mobileColumns={2}>
        {ws.visibleTabs.includes("contas") ? <StatCard label="Contas ativas" value={ws.counts.accounts} icon={<Landmark />} tone="info" href="/financeiro/cadastros?aba=contas" compact /> : null}
        {ws.visibleTabs.includes("centros") ? <StatCard label="Centros ativos" value={ws.counts.centers} icon={<Target />} tone="secondary" href="/financeiro/cadastros?aba=centros" compact /> : null}
        {ws.visibleTabs.includes("categorias") ? <StatCard label="Categorias ativas" value={ws.counts.categories} hint={`${ws.counts.subcategories} subcategoria(s)`} icon={<Tags />} tone="brand" href="/financeiro/cadastros?aba=categorias" compact /> : null}
        {ws.visibleTabs.includes("categorias") ? <StatCard label="Sem centro de custo" value={ws.counts.withoutCenter} icon={<TriangleAlert />} tone={ws.counts.withoutCenter ? "warning" : "success"} valueTone={ws.counts.withoutCenter > 0} href="/financeiro/cadastros?aba=categorias" compact /> : null}
      </KpiStrip>

      <RegistryTabs current={ws.tab} visible={ws.visibleTabs} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          {ws.tab === "contas" ? <AccountsPanel rows={ws.accounts} can={{ values: ws.can.values, ...ws.can.accounts }} /> : null}
          {ws.tab === "centros" ? <CentersPanel rows={ws.centers} can={ws.can.centers} canImport={Boolean(importButton)} /> : null}
          {ws.tab === "categorias" ? <CategoriesPanel rows={ws.categories} centers={ws.centers} withoutCenter={ws.counts.withoutCenter} can={ws.can.categories} canImport={Boolean(importButton)} /> : null}
        </div>
        <Card className="min-w-0 self-start" data-testid="registry-history">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <History className="size-4" /> Histórico
            </CardTitle>
            {item ? (
              <Link href={`/financeiro/cadastros?aba=${ws.tab}`} className="text-sm text-brand-fg hover:underline">
                Ver tudo
              </Link>
            ) : null}
          </CardHeader>
          <CardContent className="pt-0">
            <Timeline events={ws.history} showFilters={false} pageSize={10} emptyTitle="Sem alterações registradas" emptyDescription="Cadastros, alterações, arquivamentos e mesclagens aparecem aqui com o valor anterior e o novo." />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
