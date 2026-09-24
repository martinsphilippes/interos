import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, Building2, Plus, Rocket, UserPlus, Wallet } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { listClients, parseClientFilters } from "@/server/clients/queries";
import { formatCurrency, formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { ClientsFilters } from "@/components/clients/clients-filters";
import { ClientsTable } from "@/components/clients/clients-table";

export const metadata: Metadata = { title: "Clientes 360º" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function ClientesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const filters = parseClientFilters(await searchParams);
  const { items, total, stats, facets } = await listClients(filters);
  const filtered = Boolean(filters.q || filters.status || filters.stage || filters.ownerSalesId || filters.ownerCsId || filters.health || filters.segment || filters.city);

  return (
    <PageContainer size="full">
      <PageHeader
        title="Clientes 360º"
        description="A base inteira da Intercert: jornada, saúde, receita e relacionamento de cada cliente em um só lugar."
        actions={
          <Button asChild>
            <Link href="/clientes/novo">
              <Plus /> Novo cliente
            </Link>
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Ativos" value={formatNumber(stats.active)} icon={<Building2 />} tone="success" href="/clientes?status=ativo" hint={`${formatNumber(stats.total)} no total`} compact />
        <StatCard label="Em implantação" value={formatNumber(stats.implementing)} icon={<Rocket />} tone="info" href="/clientes?status=em_implantacao" compact />
        <StatCard label="Prospects e leads" value={formatNumber(stats.pipeline)} icon={<UserPlus />} tone="neutral" href="/clientes?status=prospect,lead" compact />
        <StatCard label="MRR total" value={formatCurrency(stats.mrr)} icon={<Wallet />} tone="success" href="/clientes?status=ativo&ordenar=mrr" hint="soma dos clientes ativos" compact />
        <StatCard label="Clientes em risco" value={formatNumber(stats.atRisk)} icon={<AlertTriangle />} tone={stats.atRisk > 0 ? "danger" : "neutral"} href="/clientes?saude=risco&status=ativo" compact />
      </div>

      <div className="flex flex-col gap-4">
        <Suspense fallback={null}>
          <ClientsFilters filters={filters} facets={facets} total={total} />
        </Suspense>
        <ClientsTable items={items} filtered={filtered} />
      </div>
    </PageContainer>
  );
}
