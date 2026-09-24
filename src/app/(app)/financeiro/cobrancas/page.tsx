import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, Receipt } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { listBillings, parseBillingFilters } from "@/server/finance/queries";
import { BILLING_STATUSES, BILLING_TYPES, canOperateFinance } from "@/server/finance/schemas";
import { formatCurrency, formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { BILLING_STATUS_LABELS, BILLING_TYPE_LABELS } from "@/components/clients/labels";
import { BillingsTable } from "@/components/finance/billings-table";
import { FinanceFilters } from "@/components/finance/finance-filters";

export const metadata: Metadata = { title: "Cobranças" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Cobranças com filtros (status, tipo, competência, cliente), totais e ações de cobrança. */
export default async function BillingsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "financeiro")) redirect("/meu-dia?erro=sem-permissao");
  const filters = parseBillingFilters(await searchParams);
  const { rows, totals, facets } = await listBillings(filters);

  return (
    <PageContainer>
      <PageHeader title="Cobranças" description={`${formatNumber(totals.count)} cobrança(s) no filtro · vencidas são marcadas automaticamente`} breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Cobranças" }]} />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total (sem canceladas)" value={formatCurrency(totals.amount)} icon={<Receipt />} compact />
        <StatCard label="Em aberto" value={formatCurrency(totals.open)} icon={<Clock />} tone="info" href="/financeiro/cobrancas?status=aberta" compact />
        <StatCard label="Vencido" value={formatCurrency(totals.overdue)} icon={<AlertTriangle />} tone={totals.overdue > 0 ? "danger" : "success"} href="/financeiro/cobrancas?status=vencida" compact />
        <StatCard label="Recebido" value={formatCurrency(totals.paid)} icon={<CheckCircle2 />} tone="success" href="/financeiro/cobrancas?status=paga" compact />
      </div>

      <FinanceFilters
        className="mb-4"
        fields={[
          { param: "status", label: "Status", allLabel: "Todos os status", options: BILLING_STATUSES.map((s) => ({ value: s, label: BILLING_STATUS_LABELS[s] })) },
          { param: "tipo", label: "Tipo", allLabel: "Todos os tipos", options: BILLING_TYPES.map((t) => ({ value: t, label: BILLING_TYPE_LABELS[t] })) },
          { param: "competencia", label: "Competência", allLabel: "Todas as competências", options: facets.competences },
          { param: "cliente", label: "Cliente", allLabel: "Todos os clientes", options: facets.clients },
        ]}
      />

      <Card className="overflow-hidden">
        <BillingsTable rows={rows} canOperate={canOperateFinance(user)} />
      </Card>
    </PageContainer>
  );
}
