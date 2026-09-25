import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleDollarSign, LayoutGrid, Target, Trophy } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getUpsellMatrix } from "@/server/cs/queries";
import { OPPORTUNITY_KIND_LABELS, OPPORTUNITY_STAGE_LABELS, OPPORTUNITY_STAGE_VARIANT } from "@/components/clients/labels";
import { formatCurrency, formatNumber, formatRelative } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTitle } from "@/components/ui/section-title";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OwnerCell } from "@/components/cs/cs-bits";
import { ScopeSelect } from "@/components/cs/scope-select";
import { UpsellMatrixView } from "@/components/cs/upsell-matrix";

export const metadata: Metadata = { title: "Upsell" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Upsell: matriz de produtos da carteira e oportunidades de expansão originadas pelo CS. */
export default async function UpsellPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "cs")) redirect("/meu-dia?erro=sem-permissao");
  const data = await getUpsellMatrix(user, await searchParams);
  const { totals } = data;

  return (
    <PageContainer>
      <PageHeader
        title="Upsell e cross-sell"
        description="Produtos contratados × disponíveis na carteira. Gere oportunidades para o vendedor responsável direto da matriz."
        breadcrumbs={[{ label: "Customer Success", href: "/cs" }, { label: "Upsell" }]}
        actions={<ScopeSelect owners={data.owners} value={data.scope.param} />}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Oportunidades abertas (CS)" value={formatNumber(totals.open)} icon={<Target />} tone="info" hint={`${formatCurrency(totals.openMrr)}/mês em negociação`} compact />
        <StatCard label="Ganhas (CS)" value={formatNumber(totals.won)} icon={<Trophy />} tone="success" hint={`${formatCurrency(totals.wonMrr)}/mês de expansão`} compact />
        <StatCard label="MRR em aberto" value={formatCurrency(totals.openMrr)} icon={<CircleDollarSign />} tone="info" compact />
        <StatCard label="Combinações disponíveis" value={formatNumber(totals.available)} icon={<LayoutGrid />} tone="neutral" hint="Cliente × produto ainda não contratado" compact />
      </div>

      <Card className="mb-8 overflow-hidden">
        <CardHeader className="pb-0">
          <CardTitle>Matriz da carteira</CardTitle>
          <CardDescription>{data.rows.length} cliente(s) × {data.products.length} produto(s) ativos no catálogo.</CardDescription>
        </CardHeader>
        <UpsellMatrixView data={data} />
      </Card>

      <section>
        <SectionTitle title="Oportunidades originadas pelo CS" count={data.opportunities.length} description="Upsell e cross-sell abertas e ganhas (perdidas ficam de fora)." />
        {data.opportunities.length === 0 ? (
          <Card>
            <EmptyState icon={<Target />} title="Nenhuma oportunidade gerada pelo CS" description="Use a matriz acima para gerar a primeira." />
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Oportunidade</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Etapa</TableHead>
                  <TableHead className="text-right">Mensal</TableHead>
                  <TableHead className="text-right">Adesão</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead>Gerada por</TableHead>
                  <TableHead>Criada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.opportunities.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="max-w-[280px]">
                      <Link href={`/vendas/oportunidades?oportunidade=${o.id}`} className="line-clamp-1 font-medium hover:text-brand hover:underline">
                        {o.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/clientes/${o.clientId}`} className="hover:underline">
                        {o.tradeName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{OPPORTUNITY_KIND_LABELS[o.kind]}</TableCell>
                    <TableCell>
                      <Badge variant={OPPORTUNITY_STAGE_VARIANT[o.stage]} size="sm">
                        {OPPORTUNITY_STAGE_LABELS[o.stage]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(o.monthlyTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(o.setupTotal)}</TableCell>
                    <TableCell>
                      <OwnerCell owner={o.owner} />
                    </TableCell>
                    <TableCell>
                      <OwnerCell owner={o.origin} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted">{formatRelative(o.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>
    </PageContainer>
  );
}
