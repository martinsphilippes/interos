import type { Metadata } from "next";
import { can, requireScreen } from "@/server/auth/session";
import { payableAllowed, payableVisibility } from "@/server/commissions/access";
import { listSuppliers } from "@/server/commissions/suppliers";
import { list } from "@/server/db";
import { COLLECTIONS, type Payable } from "@/domain/types";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { SuppliersWorkspace, type SupplierRow } from "@/components/commissions/suppliers-workspace";

export const metadata: Metadata = { title: "Fornecedores" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Financeiro › Contas a Pagar › Fornecedores (D28): cadastro simples dos credores, com títulos em aberto e pagos.
 * Seção financeiro.contas-a-pagar.fornecedores (sem ela, volta para Comissões com aviso). Os totais contam só os
 * títulos no escopo de Contas a Pagar (padrão da equipe financeira: todos); cadastrar, editar e ativar por chave.
 */
export default async function SuppliersPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("financeiro.contas-a-pagar.fornecedores.ver");
  const sp = await searchParams;
  const selected = (Array.isArray(sp.fornecedor) ? sp.fornecedor[0] : sp.fornecedor)?.trim() || undefined;
  const [suppliers, allPayables, visibility] = await Promise.all([listSuppliers(), list<Payable>(COLLECTIONS.payables), payableVisibility(user)]);
  const payables = allPayables.filter((p) => payableAllowed(visibility, p));
  const rows: SupplierRow[] = suppliers.map((s) => {
    const own = payables.filter((p) => p.supplierId === s.id);
    const open = own.filter((p) => p.status === "previsto" || p.status === "aprovado" || p.status === "a_pagar");
    return { ...s, openCount: open.length, openAmount: Math.round(open.reduce((sum, p) => sum + p.amount, 0) * 100) / 100, paidAmount: Math.round(own.filter((p) => p.status === "pago").reduce((sum, p) => sum + p.amount, 0) * 100) / 100 };
  });
  return (
    <PageContainer size="full" className="max-w-[1680px]">
      <PageHeader title="Fornecedores" description="Credores de Contas a Pagar: dados de contato, PIX e banco para pagar títulos (não é o cadastro de clientes)" breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Contas a Pagar", href: "/financeiro/contas-a-pagar" }, { label: "Fornecedores" }]} />
      <SuppliersWorkspace
        rows={rows}
        selectedId={selected}
        can={{ create: can(user, "financeiro.contas-a-pagar.fornecedores.criar"), edit: can(user, "financeiro.contas-a-pagar.fornecedores.editar"), toggle: can(user, "financeiro.contas-a-pagar.fornecedores.ativar") }}
      />
    </PageContainer>
  );
}
