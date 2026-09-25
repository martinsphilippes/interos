import type { Metadata } from "next";
import { Suspense } from "react";
import { Layers, Package, PackageCheck, Repeat } from "lucide-react";
import { requireRole } from "@/server/auth/session";
import { listProductsForAdmin } from "@/server/admin/queries";
import { formatCurrency, formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { ProductsWorkspace } from "@/components/admin/products-workspace";

export const metadata: Metadata = { title: "Produtos" };

export default async function ProdutosPage() {
  await requireRole("admin");
  const { products, templates } = await listProductsForAdmin();

  const active = products.filter((p) => p.active);
  const recurring = active.filter((p) => p.billingType !== "unico");
  const categories = new Set(active.map((p) => p.category)).size;
  const withTemplate = active.filter((p) => p.implementationTemplateId).length;
  const avgMonthly = recurring.length > 0 ? recurring.reduce((s, p) => s + p.monthlyPrice, 0) / recurring.length : 0;

  return (
    <PageContainer size="full">
      <PageHeader title="Produtos" description="Catálogo usado em propostas, contratos, comissões e projetos de implantação." breadcrumbs={[{ label: "Administração", href: "/admin" }, { label: "Produtos" }]} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Ativos" value={formatNumber(active.length)} icon={<PackageCheck />} tone="success" href="/admin/produtos?ativo=1" hint={`${formatNumber(products.length)} no catálogo`} compact />
        <StatCard label="Categorias" value={formatNumber(categories)} icon={<Layers />} tone="info" hint="entre os produtos ativos" compact />
        <StatCard label="Recorrentes" value={formatNumber(recurring.length)} icon={<Repeat />} tone="neutral" hint={recurring.length > 0 ? `mensalidade média ${formatCurrency(avgMonthly)}` : "nenhum produto recorrente"} compact />
        <StatCard label="Com template de implantação" value={formatNumber(withTemplate)} icon={<Package />} tone={withTemplate < active.length ? "warning" : "success"} hint={`${formatNumber(active.length - withTemplate)} sem template`} compact />
      </div>

      <Suspense fallback={null}>
        <ProductsWorkspace products={products} templates={templates} />
      </Suspense>
    </PageContainer>
  );
}
