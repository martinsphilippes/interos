import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { MessageSquareReply, PhoneCall, Target, TrendingUp, UserPlus, Users } from "lucide-react";
import { ACCESS_DENIED_REDIRECT, getCurrentUser, requireScreen } from "@/server/auth/session";
import { MARKETING_SCREENS, canSeeProspectListId, marketingCapabilities, prospectListExists, screenScope } from "@/server/marketing/access";
import { getMarketingOptions, getProspectListDetail } from "@/server/marketing/queries";
import { formatNumber, formatPercent } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProspectListDetailView } from "@/components/marketing/prospect-list-detail";
import { ProspectPlanningCard } from "@/components/marketing/prospect-planning";
import { MarketingAccessProvider } from "@/components/marketing/marketing-access";

type Params = Promise<{ listId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** A30: permissão e escopo ANTES de ler a lista; sem acesso → título genérico. */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { listId } = await params;
  const user = await getCurrentUser();
  if (!user || !(await canSeeProspectListId(user, listId))) return { title: "Prospecção" };
  const detail = await getProspectListDetail(listId, await screenScope(user, MARKETING_SCREENS.prospect));
  return { title: detail ? `${detail.list.name} — Prospecção` : "Lista não encontrada" };
}

/**
 * Lista de prospecção: dashboard calculado, desempenho por responsável e contatos. Tela marketing.prospeccao (A14);
 * lista fora do escopo = aviso de acesso negado (redirect padrão); números só dos contatos visíveis; ações conforme
 * as chaves (sem edição = somente leitura).
 */
export default async function ProspectListPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const user = await requireScreen("marketing.prospeccao");
  const { listId } = await params;
  const sp = await searchParams;
  const caps = marketingCapabilities(user);
  const scope = await screenScope(user, MARKETING_SCREENS.prospect);
  const [detail, options] = await Promise.all([getProspectListDetail(listId, scope), getMarketingOptions()]);
  if (!detail) {
    if (await prospectListExists(listId)) redirect(ACCESS_DENIED_REDIRECT);
    notFound();
  }
  const { list, dashboard, byOwner } = detail;

  return (
    <MarketingAccessProvider value={caps}>
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

        <ProspectPlanningCard list={list} />

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
        <ProspectListDetailView key={list.id} detail={detail} options={options} autoImport={caps.prospect.import && sp.importar === "1"} />
      </PageContainer>
    </MarketingAccessProvider>
  );
}
