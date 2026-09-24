import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MessageSquareReply, PhoneCall, Target, TrendingUp, UserPlus, Users } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getMarketingOptions, getProspectListDetail } from "@/server/marketing/queries";
import { formatNumber, formatPercent } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProspectListDetailView } from "@/components/marketing/prospect-list-detail";

type Params = Promise<{ listId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { listId } = await params;
  const detail = await getProspectListDetail(listId);
  return { title: detail ? `${detail.list.name} — Prospecção` : "Lista não encontrada" };
}

/** Lista de prospecção: dashboard calculado, desempenho por responsável e contatos. */
export default async function ProspectListPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await requireUser();
  const { listId } = await params;
  const sp = await searchParams;
  const [detail, options] = await Promise.all([getProspectListDetail(listId), getMarketingOptions()]);
  if (!detail) notFound();
  const { list, dashboard, byOwner } = detail;

  return (
    <PageContainer>
      <PageHeader
        title={list.name}
        description={[list.description, list.segment && `Segmento: ${list.segment}`, list.ownerName && `Responsável: ${list.ownerName}`, list.campaignName && `Campanha: ${list.campaignName}`].filter(Boolean).join(" · ") || undefined}
        breadcrumbs={[{ label: "Marketing", href: "/marketing" }, { label: "Prospecção Ativa", href: "/marketing/prospeccao" }, { label: list.name }]}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Contatos" value={formatNumber(dashboard.contacts)} icon={<Users />} compact />
        <StatCard label="Tentativas" value={formatNumber(dashboard.attempts)} icon={<PhoneCall />} hint={`${formatNumber(dashboard.reached)} contatos trabalhados`} compact />
        <StatCard label="Respostas" value={formatNumber(dashboard.responses)} icon={<MessageSquareReply />} tone="info" hint={`Taxa ${formatPercent(dashboard.responseRate)}`} compact />
        <StatCard label="Leads gerados" value={formatNumber(dashboard.leads)} icon={<UserPlus />} tone="info" compact />
        <StatCard label="Oportunidades" value={formatNumber(dashboard.opportunities)} icon={<Target />} tone="success" compact />
        <StatCard label="Conversão" value={formatPercent(dashboard.conversion)} icon={<TrendingUp />} tone="success" hint="Convertidos / contatos" compact />
      </div>

      {byOwner.length > 0 ? (
        <section className="mb-6">
          <SectionTitle title="Desempenho por responsável" />
          <Card className="overflow-hidden">
            <Table className="min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Responsável</TableHead>
                  <TableHead className="text-right">Contatos</TableHead>
                  <TableHead className="text-right">Tentativas</TableHead>
                  <TableHead className="text-right">Respostas</TableHead>
                  <TableHead className="text-right">Convertidos</TableHead>
                  <TableHead className="text-right">Conversão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byOwner.map((o) => (
                  <TableRow key={o.ownerId || "none"}>
                    <TableCell className="font-medium">{o.ownerName}</TableCell>
                    <TableCell className="text-right tabular-nums">{o.contacts}</TableCell>
                    <TableCell className="text-right tabular-nums">{o.attempts}</TableCell>
                    <TableCell className="text-right tabular-nums">{o.responses}</TableCell>
                    <TableCell className="text-right tabular-nums">{o.conversions}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(o.conversion)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </section>
      ) : null}

      <SectionTitle title="Contatos" count={detail.prospects.length} />
      <ProspectListDetailView key={list.id} detail={detail} options={options} autoImport={sp.importar === "1"} />
    </PageContainer>
  );
}
