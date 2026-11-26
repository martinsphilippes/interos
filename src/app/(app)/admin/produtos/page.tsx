import type { Metadata } from "next";
import { Suspense } from "react";
import { Layers, Package, PackageCheck, Repeat } from "lucide-react";
import { can, requireScreen } from "@/server/auth/session";
import { listProductsForAdmin } from "@/server/admin/queries";
import { loadProductManagement } from "@/server/products/queries";
import { formatCurrency, formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { ProductsWorkspace } from "@/components/admin/products-workspace";
import { ProductsPageTabs } from "@/components/products/products-page-tabs";
import { ModulesWorkspace } from "@/components/products/modules-workspace";
import { PackagesWorkspace } from "@/components/products/packages-workspace";
import { PriceSimulator } from "@/components/products/price-simulator";
import type { ProductTab } from "@/components/products/model";

export const metadata: Metadata = { title: "Produtos" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const DESCRIPTIONS: Record<ProductTab, string> = {
  produtos: "Catálogo usado em propostas, contratos, comissões e projetos de implantação.",
  modulos: "Ficha comercial e preço de cada módulo do ERP: o que é vendido, por quanto e desde quando.",
  pacotes: "Pacotes por segmento com versões: módulos incluídos, mensalidade e implantação a partir de uma data.",
  simulador: "Pacote + módulos avulsos com as quantidades, pelo preço vigente na data e sem cobrança dupla.",
};

/**
 * Produtos (Administração): o catálogo de produtos (aba padrão) e a Gestão de Produtos (fases 7 e 8 da Central de
 * Produtos) nas abas Módulos do ERP, Pacotes e Simulador (?aba=), cada uma pela sua seção do catálogo de acessos.
 */
export default async function ProdutosPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("admin.produtos");
  const sp = await searchParams;
  const requested = typeof sp.aba === "string" ? sp.aba : undefined;
  const visible: ProductTab[] = [
    "produtos",
    ...(can(user, "admin.produtos.modulos.ver") ? (["modulos"] as const) : []),
    ...(can(user, "admin.produtos.pacotes.ver") ? (["pacotes"] as const) : []),
    ...(can(user, "admin.produtos.simulador.ver") ? (["simulador"] as const) : []),
  ];
  const tab: ProductTab = visible.includes(requested as ProductTab) ? (requested as ProductTab) : "produtos";
  const header = <PageHeader title="Produtos" description={DESCRIPTIONS[tab]} breadcrumbs={[{ label: "Administração", href: "/admin" }, { label: "Produtos" }]} />;

  if (tab !== "produtos") {
    const view = await loadProductManagement();
    return (
      <PageContainer size="full">
        {header}
        <ProductsPageTabs current={tab} visible={visible} />
        {tab === "modulos" ? <ModulesWorkspace view={view} permissions={{ edit: can(user, "admin.produtos.modulos.editar"), price: can(user, "admin.produtos.modulos.precificar") }} /> : null}
        {tab === "pacotes" ? <PackagesWorkspace view={view} permissions={{ edit: can(user, "admin.produtos.pacotes.editar") }} /> : null}
        {tab === "simulador" ? <PriceSimulator view={view} /> : null}
      </PageContainer>
    );
  }

  const permissions = { create: can(user, "admin.produtos.criar"), edit: can(user, "admin.produtos.editar"), toggle: can(user, "admin.produtos.ativar") };
  const { products, templates } = await listProductsForAdmin();

  const active = products.filter((p) => p.active);
  const recurring = active.filter((p) => p.billingType !== "unico");
  const categories = new Set(active.map((p) => p.category)).size;
  const withTemplate = active.filter((p) => p.implementationTemplateId).length;
  const avgMonthly = recurring.length > 0 ? recurring.reduce((s, p) => s + p.monthlyPrice, 0) / recurring.length : 0;

  return (
    <PageContainer size="full">
      {header}
      <ProductsPageTabs current={tab} visible={visible} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Ativos" value={formatNumber(active.length)} icon={<PackageCheck />} tone="success" href="/admin/produtos?ativo=1" hint={`${formatNumber(products.length)} no catálogo`} compact />
        <StatCard label="Categorias" value={formatNumber(categories)} icon={<Layers />} tone="info" hint="entre os produtos ativos" compact />
        <StatCard label="Recorrentes" value={formatNumber(recurring.length)} icon={<Repeat />} tone="neutral" hint={recurring.length > 0 ? `mensalidade média ${formatCurrency(avgMonthly)}` : "nenhum produto recorrente"} compact />
        <StatCard label="Com template de implantação" value={formatNumber(withTemplate)} icon={<Package />} tone={withTemplate < active.length ? "warning" : "success"} hint={`${formatNumber(active.length - withTemplate)} sem template`} compact />
      </div>

      <Suspense fallback={null}>
        <ProductsWorkspace products={products} templates={templates} permissions={permissions} />
      </Suspense>
    </PageContainer>
  );
}
