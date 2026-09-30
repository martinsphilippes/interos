import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { canOperatePayables, canViewPayables } from "@/server/commissions/permissions";
import { listSuppliers } from "@/server/commissions/suppliers";
import { list } from "@/server/db";
import { COLLECTIONS, type Payable } from "@/domain/types";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { SuppliersWorkspace, type SupplierRow } from "@/components/commissions/suppliers-workspace";

export const metadata: Metadata = { title: "Fornecedores" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Financeiro › Contas a Pagar › Fornecedores (D28): cadastro simples dos credores, com títulos em aberto e pagos. */
export default async function SuppliersPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "financeiro") || !canViewPayables(user)) redirect("/financeiro/comissoes?erro=sem-permissao");
  const sp = await searchParams;
  const selected = (Array.isArray(sp.fornecedor) ? sp.fornecedor[0] : sp.fornecedor)?.trim() || undefined;
  const [suppliers, payables] = await Promise.all([listSuppliers(), list<Payable>(COLLECTIONS.payables)]);
  const rows: SupplierRow[] = suppliers.map((s) => {
    const own = payables.filter((p) => p.supplierId === s.id);
    const open = own.filter((p) => p.status === "previsto" || p.status === "aprovado" || p.status === "a_pagar");
    return { ...s, openCount: open.length, openAmount: Math.round(open.reduce((sum, p) => sum + p.amount, 0) * 100) / 100, paidAmount: Math.round(own.filter((p) => p.status === "pago").reduce((sum, p) => sum + p.amount, 0) * 100) / 100 };
  });
  return (
    <PageContainer size="full" className="max-w-[1680px]">
      <PageHeader title="Fornecedores" description="Credores de Contas a Pagar: dados de contato, PIX e banco para pagar títulos (não é o cadastro de clientes)" breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Contas a Pagar", href: "/financeiro/contas-a-pagar" }, { label: "Fornecedores" }]} />
      <SuppliersWorkspace rows={rows} selectedId={selected} canOperate={canOperatePayables(user)} />
    </PageContainer>
  );
}
