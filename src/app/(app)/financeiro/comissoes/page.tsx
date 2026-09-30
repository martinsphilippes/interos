import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { AlertTriangle, Ban, BadgeCheck, CalendarClock, CircleDollarSign, Clock, FileText, Lock, Settings2 } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { runDueSweeps } from "@/server/automations/lazy";
import { getCommissionsWorkspace, parseCommissionFilters } from "@/server/commissions/queries";
import { COMMISSION_STATUS_LABELS, COMMISSION_STATUSES } from "@/domain/commissions";
import { formatCurrency } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { PageHeader } from "@/components/ui/page-header";
import { SidePanelShell } from "@/components/ui/side-panel-shell";
import { StatCard } from "@/components/ui/stat-card";
import { FinanceFilters } from "@/components/finance/finance-filters";
import { AccessNotice } from "@/components/commissions/commission-ui";
import { CommissionPanel } from "@/components/commissions/commission-panel";
import { CommissionsTable } from "@/components/commissions/commissions-table";

export const metadata: Metadata = { title: "Comissões" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/**
 * Financeiro › Comissões (D14): KPIs por situação, lista filtrável e painel com memória de cálculo e origem rastreável.
 * Escopo no servidor (D15): financeiro/admin/diretoria veem todas; gestor, as da equipe; vendedor, só as próprias.
 */
export default async function CommissionsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "financeiro") && !canAccessModule(user, "vendas")) redirect("/meu-dia?erro=sem-permissao");
  const sp = await searchParams;
  const filters = parseCommissionFilters(sp);
  const requested = first(sp.comissao);
  // Carência vencida/cobranças vencidas: a varredura roda depois da resposta quando está atrasada.
  after(() => runDueSweeps(["comissoes"]));
  const ws = await getCommissionsWorkspace(user, filters, requested);
  const denied = first(sp.erro) === "sem-permissao";
  const { kpis } = ws;
  const own = ws.scope === "own";
  const statusHref = (status: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v && k !== "status") q.set(k, String(v));
    q.set("status", status);
    return `/financeiro/comissoes?${q.toString()}`;
  };
  const hint = (k: keyof typeof kpis) => `${kpis[k].count} comissão(ões)`;

  return (
    <PageContainer size="full" className="max-w-[1680px]">
      {denied ? <AccessNotice>Seu perfil não tem acesso a essa área do Financeiro (Contas a Pagar e Regras de comissão). Aqui você acompanha as suas comissões.</AccessNotice> : null}
      <PageHeader
        title={own ? "Minhas comissões" : "Comissões"}
        description={
          own
            ? "Suas comissões item a item: situação, data provável e memória de cálculo"
            : ws.scope === "team"
              ? "Comissões da sua equipe: previstas, em carência, elegíveis, a pagar e pagas"
              : "Comissões de todos os vendedores: previstas, em carência, elegíveis, a pagar e pagas"
        }
        breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Comissões" }]}
        actions={
          ws.can.viewRules || ws.can.viewPayables ? (
            <div className="flex flex-wrap gap-2">
              {ws.can.viewRules ? (
                <Button asChild variant="outline" className="h-11 md:h-9">
                  <Link href="/financeiro/comissoes/regras">
                    <Settings2 /> Regras
                  </Link>
                </Button>
              ) : null}
              {ws.can.viewPayables ? (
                <Button asChild variant="outline" className="h-11 md:h-9">
                  <Link href="/financeiro/contas-a-pagar?categoria=comissao_comercial">
                    <FileText /> Contas a Pagar
                  </Link>
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      />

      <KpiStrip columns={4} mobileColumns={2}>
        <StatCard label="Previstas" value={formatCurrency(kpis.prevista.amount)} icon={<Clock />} tone="neutral" hint={hint("prevista")} href={statusHref("prevista")} compact />
        <StatCard label="Em carência" value={formatCurrency(kpis.em_carencia.amount)} icon={<CalendarClock />} tone="info" hint={hint("em_carencia")} href={statusHref("em_carencia")} compact />
        <StatCard label="Aguardando recebimento" value={formatCurrency(kpis.aguardando_recebimento.amount)} icon={<AlertTriangle />} tone="warning" hint={hint("aguardando_recebimento")} href={statusHref("aguardando_recebimento")} compact />
        <StatCard label="Elegíveis" value={formatCurrency(kpis.liberada.amount)} icon={<BadgeCheck />} tone="brand" hint={hint("liberada")} href={statusHref("liberada")} compact />
        <StatCard label="A pagar (título gerado)" value={formatCurrency(kpis.titulo_gerado.amount)} icon={<FileText />} tone="secondary" hint={hint("titulo_gerado")} href={statusHref("titulo_gerado")} compact />
        <StatCard label="Pagas" value={formatCurrency(kpis.paga.amount)} icon={<CircleDollarSign />} tone="success" hint={hint("paga")} href={statusHref("paga")} compact />
        <StatCard label="Bloqueadas" value={formatCurrency(kpis.bloqueada.amount)} icon={<Lock />} tone="danger" hint={hint("bloqueada")} href={statusHref("bloqueada")} compact />
        <StatCard label="Canceladas/estornadas" value={formatCurrency(kpis.void.amount)} icon={<Ban />} tone="neutral" hint={hint("void")} href={statusHref("cancelada")} compact />
      </KpiStrip>

      <FinanceFilters
        className="mb-4"
        fields={[
          ...(own ? [] : [{ param: "vendedor", label: "Vendedor", allLabel: "Todos os vendedores", options: ws.facets.sellers }]),
          { param: "status", label: "Situação", allLabel: "Todas as situações", options: COMMISSION_STATUSES.map((s) => ({ value: s, label: COMMISSION_STATUS_LABELS[s] })) },
          { param: "competencia", label: "Competência", allLabel: "Todas as competências", options: ws.facets.competences },
          { param: "cliente", label: "Cliente", allLabel: "Todos os clientes", options: ws.facets.clients },
          { param: "contrato", label: "Contrato", allLabel: "Todos os contratos", options: ws.facets.contracts },
        ]}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>{own ? "Minhas comissões" : "Comissões"}</CardTitle>
            <span className="text-sm text-muted">
              {ws.rows.length} de {ws.total}
            </span>
          </CardHeader>
          <CommissionsTable key={JSON.stringify(filters)} rows={ws.rows} selectedId={ws.selected?.id} showSeller={!own} />
        </Card>
        {ws.selected ? (
          <SidePanelShell explicit={Boolean(requested)} param="comissao" ariaLabel="Comissão selecionada" title={`${ws.selected.code} · ${ws.selected.clientName}`}>
            <CommissionPanel key={ws.selected.id} c={ws.selected} canReverse={ws.can.reverse} />
          </SidePanelShell>
        ) : (
          <aside className="hidden xl:block">
            <Card className="p-5 text-sm text-muted">Selecione uma comissão para ver a memória de cálculo, a origem (venda → contrato → recebimento → regra → título) e o histórico.</Card>
          </aside>
        )}
      </div>
    </PageContainer>
  );
}
