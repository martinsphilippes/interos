import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, Clock, Receipt } from "lucide-react";
import { requireScreen } from "@/server/auth/session";
import { resolveDataScope } from "@/server/auth/scope";
import { runDueSweeps } from "@/server/automations/lazy";
import { listBillings, parseBillingFilters } from "@/server/finance/queries";
import { BILLING_STATUSES, BILLING_TYPES, BOLETO_FILTER_LABELS, BOLETO_FILTERS } from "@/server/finance/schemas";
import { financeCapabilities } from "@/server/finance/access";
import { stripBoleto } from "@/server/finance/redact";
import { formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { BILLING_STATUS_LABELS, BILLING_TYPE_LABELS } from "@/components/clients/labels";
import { BillingsTable } from "@/components/finance/billings-table";
import { FinanceFilters } from "@/components/finance/finance-filters";
import { FinanceAccessProvider } from "@/components/finance/finance-access";
import { money } from "@/components/finance/values";

export const metadata: Metadata = { title: "Cobranças" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Cobranças com filtros (status, tipo, competência, cliente, boleto), totais e ações de cobrança.
 * Acesso (catálogo): tela financeiro.cobrancas; escopo pelos donos do contrato da cobrança; valores sob
 * financeiro.valores.ver ("Restrito"); boleto/PIX sob a seção financeiro.cobrancas.boleto.ver; ações pelas chaves
 * financeiro.cobrancas.* (financeCapabilities).
 */
export default async function BillingsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("financeiro.cobrancas");
  const caps = financeCapabilities(user);
  const hidden = !caps.values;
  // Varreduras preguiçosas do Financeiro (só rodam quando vencidas pela frequência): régua e conciliação.
  await runDueSweeps(["regua_cobranca", "conciliacao_bancaria"]);
  const filters = parseBillingFilters(await searchParams);
  const result = await listBillings(filters, { scope: await resolveDataScope(user, "financeiro.cobrancas"), hideValues: hidden });
  const { totals, facets } = result;
  const rows = caps.billings.boletoView ? result.rows : result.rows.map(stripBoleto);

  return (
    <FinanceAccessProvider value={caps}>
      <PageContainer>
        <PageHeader title="Cobranças" description={`${formatNumber(totals.count)} cobrança(s) no filtro · vencidas são marcadas automaticamente`} breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Cobranças" }]} />

        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Total (sem canceladas)" value={money(totals.amount, hidden)} icon={<Receipt />} compact />
          <StatCard label="Em aberto" value={money(totals.open, hidden)} icon={<Clock />} tone="info" href="/financeiro/cobrancas?status=aberta" compact />
          <StatCard label="Vencido" value={money(totals.overdue, hidden)} icon={<AlertTriangle />} tone={!hidden && totals.overdue > 0 ? "danger" : hidden ? "neutral" : "success"} href="/financeiro/cobrancas?status=vencida" compact />
          <StatCard label="Recebido" value={money(totals.paid, hidden)} icon={<CheckCircle2 />} tone="success" href="/financeiro/cobrancas?status=paga" compact />
        </div>

        <FinanceFilters
          className="mb-4"
          fields={[
            { param: "status", label: "Status", allLabel: "Todos os status", options: BILLING_STATUSES.map((s) => ({ value: s, label: BILLING_STATUS_LABELS[s] })) },
            { param: "tipo", label: "Tipo", allLabel: "Todos os tipos", options: BILLING_TYPES.map((t) => ({ value: t, label: BILLING_TYPE_LABELS[t] })) },
            ...(caps.billings.boletoView ? [{ param: "boleto", label: "Boleto", allLabel: "Boleto: todos", options: BOLETO_FILTERS.map((b) => ({ value: b, label: BOLETO_FILTER_LABELS[b] })) }] : []),
            { param: "competencia", label: "Competência", allLabel: "Todas as competências", options: facets.competences },
            { param: "cliente", label: "Cliente", allLabel: "Todos os clientes", options: facets.clients },
          ]}
        />

        <Card className="overflow-hidden">
          <BillingsTable rows={rows} />
        </Card>
      </PageContainer>
    </FinanceAccessProvider>
  );
}
