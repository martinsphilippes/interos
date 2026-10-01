import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, Building2, Plus, Rocket, UserPlus, Wallet } from "lucide-react";
import { can, requireScreen } from "@/server/auth/session";
import { clientScope } from "@/server/clients/access";
import { listClients, parseClientFilters } from "@/server/clients/queries";
import { formatCurrency, formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { Button } from "@/components/ui/button";
import { ClientsFilters } from "@/components/clients/clients-filters";
import { ClientsTable } from "@/components/clients/clients-table";

export const metadata: Metadata = { title: "Clientes 360º" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function ClientesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("operacao.clientes");
  const filters = parseClientFilters(await searchParams);
  // Escopo da tela (padrão: empresa para todos); o CEO/CTO pode restringir a meus/equipe/departamento.
  const scope = await clientScope(user);
  const { items, total, stats, facets } = await listClients(filters, scope);
  const canCreate = can(user, "operacao.clientes.criar");
  const filtered = Boolean(filters.q || filters.status || filters.stage || filters.ownerSalesId || filters.ownerCsId || filters.health || filters.segment || filters.city);

  return (
    <PageContainer size="full">
      <PageHeader
        title="Clientes 360º"
        description={scope.kind === "empresa" ? "A base inteira da Intercert: jornada, saúde, receita e relacionamento de cada cliente em um só lugar." : "Os clientes da sua carteira: jornada, saúde, receita e relacionamento de cada cliente em um só lugar."}
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/clientes/novo">
                <Plus /> Novo cliente
              </Link>
            </Button>
          ) : undefined
        }
      />

      <KpiStrip columns={5} mobileColumns={2}>
        <StatCard label="Ativos" value={formatNumber(stats.active)} icon={<Building2 />} tone="success" href="/clientes?status=ativo" hint={`${formatNumber(stats.total)} no total`} compact />
        <StatCard label="Em implantação" value={formatNumber(stats.implementing)} icon={<Rocket />} tone="info" href="/clientes?status=em_implantacao" compact />
        <StatCard label="Prospects e leads" value={formatNumber(stats.pipeline)} icon={<UserPlus />} tone="neutral" href="/clientes?status=prospect,lead" compact />
        <StatCard label="MRR total" value={formatCurrency(stats.mrr)} icon={<Wallet />} tone="success" href="/clientes?status=ativo&ordenar=mrr" hint="soma dos clientes ativos" compact />
        <StatCard label="Clientes em risco" value={formatNumber(stats.atRisk)} icon={<AlertTriangle />} tone={stats.atRisk > 0 ? "danger" : "neutral"} href="/clientes?saude=risco&status=ativo" compact />
      </KpiStrip>

      <div className="flex flex-col gap-4">
        <Suspense fallback={null}>
          <ClientsFilters filters={filters} facets={facets} total={total} />
        </Suspense>
        <ClientsTable items={items} filtered={filtered} />
      </div>
    </PageContainer>
  );
}
