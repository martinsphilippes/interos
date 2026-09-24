import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getFinanceOverview, listContracts, parseContractFilters } from "@/server/finance/queries";
import { PERIOD_OPTIONS } from "@/server/finance/schemas";
import { PageContainer } from "@/components/layout/page-container";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { CONTRACT_STATUS_LABELS } from "@/components/clients/labels";
import { ContractsTable } from "@/components/finance/contracts-table";
import { FinanceFilters } from "@/components/finance/finance-filters";
import { FinanceStats } from "@/components/finance/finance-stats";

export const metadata: Metadata = { title: "Contratos" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STATUS_OPTIONS = [
  { value: "abertos", label: "Em aberto (todos)" },
  { value: "contrato", label: "Aguardando contrato" },
  { value: "assinatura", label: "Aguardando assinatura" },
  { value: "pagamento", label: "Aguardando pagamento" },
  { value: "pendencia", label: "Com pendência" },
  { value: "liberados_mes", label: "Liberados no mês" },
  ...(["assinado", "aguardando_pagamento", "pago", "liberado", "cancelado"] as const).map((s) => ({ value: s, label: CONTRACT_STATUS_LABELS[s] })),
];

/** Fila de contratos com filtros por status, cliente, responsável e período. Aceita ?contrato=<id> (links da timeline). */
export default async function ContractsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "financeiro")) redirect("/meu-dia?erro=sem-permissao");
  const sp = await searchParams;
  const legacy = Array.isArray(sp.contrato) ? sp.contrato[0] : sp.contrato;
  if (legacy) redirect(`/financeiro/contratos/${legacy}`);

  const filters = parseContractFilters(sp);
  const [overview, result] = await Promise.all([getFinanceOverview(), listContracts(filters)]);

  return (
    <PageContainer>
      <PageHeader
        title="Contratos"
        description={`${result.rows.length} de ${result.total} contrato(s)`}
        breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Contratos" }]}
      />
      <div className="mb-5">
        <FinanceStats overview={overview} />
      </div>
      <FinanceFilters
        className="mb-4"
        searchParam="q"
        searchPlaceholder="Buscar por número ou cliente"
        fields={[
          { param: "status", label: "Status", allLabel: "Todos os status", options: STATUS_OPTIONS },
          { param: "cliente", label: "Cliente", allLabel: "Todos os clientes", options: result.facets.clients },
          { param: "responsavel", label: "Responsável", allLabel: "Todos os responsáveis", options: result.facets.owners },
          { param: "periodo", label: "Período", allLabel: "Qualquer período", options: PERIOD_OPTIONS.map((p) => ({ value: p.value, label: p.label })) },
        ]}
      />
      <Card className="overflow-hidden">
        <ContractsTable rows={result.rows} />
      </Card>
    </PageContainer>
  );
}
