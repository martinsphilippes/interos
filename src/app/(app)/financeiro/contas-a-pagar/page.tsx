import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, CalendarCheck, CheckCircle2, CircleDollarSign, Clock, Tags, Truck } from "lucide-react";
import { can, requireScreen } from "@/server/auth/session";
import { getPayablesWorkspace, parsePayableFilters } from "@/server/commissions/queries";
import { runDueSweeps } from "@/server/automations/lazy";
import { PAYABLE_ORIGIN_LABELS, PAYABLE_STATUSES, PAYABLE_STATUS_LABELS } from "@/domain/commissions";
import { formatCurrency } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { PageHeader } from "@/components/ui/page-header";
import { SidePanelShell } from "@/components/ui/side-panel-shell";
import { StatCard } from "@/components/ui/stat-card";
import { FinanceFilters } from "@/components/finance/finance-filters";
import { CashFlowCard } from "@/components/commissions/cash-flow-card";
import { ManualPayableButton, PayablePanel } from "@/components/commissions/payable-panel";
import { PayablesTable } from "@/components/commissions/payables-table";

export const metadata: Metadata = { title: "Contas a Pagar" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const VENCIMENTO_OPTIONS = [
  { value: "vencidos", label: "Vencidos" },
  { value: "7dias", label: "Próximos 7 dias" },
  { value: "mes", label: "Este mês" },
  { value: "proximo_mes", label: "Próximo mês" },
];

/**
 * Financeiro › Contas a Pagar (D13 + D28): títulos de comissão (gerados pelo motor quando a comissão fica elegível),
 * bônus, lançamentos manuais (fornecedor, categoria/centro de custo, parcelados, recorrentes, com anexo) e o fluxo de
 * caixa simplificado (a receber × a pagar por mês). Fluxo previsto → aprovado → a pagar → pago, com origem rastreável
 * e histórico. Acesso pela tela financeiro.contas-a-pagar (sem ela, volta para Comissões com aviso); títulos no
 * escopo da tela (padrão: equipe financeira vê todos; gestor fora do Financeiro, só os da equipe, em modo leitura);
 * cada botão pela sua chave; fluxo de caixa e Fornecedores são seções próprias.
 */
export default async function PayablesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("financeiro.contas-a-pagar");
  // Séries recorrentes e avisos de vencidos: preguiçoso ao abrir a tela (1x/dia), além do cron.
  await runDueSweeps(["contas_recorrentes", "contas_a_pagar_vencidas"]);
  const sp = await searchParams;
  const filters = parsePayableFilters(sp);
  const requested = (Array.isArray(sp.titulo) ? sp.titulo[0] : sp.titulo)?.trim() || undefined;
  const ws = await getPayablesWorkspace(user, filters, requested);
  const { kpis } = ws;
  const count = (n: number) => `${n} título(s)`;
  // Cadastros financeiros (etapa CP/CR 1): contas, centros de custo e categorias — tela própria com acesso próprio.
  const registry = can(user, "financeiro.cadastros.ver");

  return (
    <PageContainer size="full" className="max-w-[1680px]">
      <PageHeader
        title="Contas a Pagar"
        description={ws.can.readOnly ? "Títulos da sua equipe (somente leitura)" : "Comissões elegíveis, bônus, fornecedores e lançamentos: aprovação, programação e pagamento"}
        breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Contas a Pagar" }]}
        actions={
          (ws.can.suppliers && ws.can.operate) || ws.can.create || registry ? (
            <>
              {registry ? (
                <Link href="/financeiro/cadastros" className={buttonVariants({ variant: "outline", className: "h-11 md:h-9" })}>
                  <Tags /> Cadastros
                </Link>
              ) : null}
              {ws.can.suppliers && ws.can.operate ? (
                <Link href="/financeiro/contas-a-pagar/fornecedores" className={buttonVariants({ variant: "outline", className: "h-11 md:h-9" })}>
                  <Truck /> Fornecedores
                </Link>
              ) : null}
              {ws.can.create ? <ManualPayableButton users={ws.users} suppliers={ws.suppliers} categories={ws.settings.categorias} costCenters={ws.settings.centrosDeCusto} /> : null}
            </>
          ) : undefined
        }
      />

      <KpiStrip columns={5} mobileColumns={2}>
        <StatCard label="Previstos" value={formatCurrency(kpis.previsto.amount)} icon={<Clock />} tone="neutral" hint={count(kpis.previsto.count)} href="/financeiro/contas-a-pagar?status=previsto" compact />
        <StatCard label="Aprovados" value={formatCurrency(kpis.aprovado.amount)} icon={<CheckCircle2 />} tone="info" hint={count(kpis.aprovado.count)} href="/financeiro/contas-a-pagar?status=aprovado" compact />
        <StatCard label="A pagar" value={formatCurrency(kpis.a_pagar.amount)} icon={<CalendarCheck />} tone="warning" hint={count(kpis.a_pagar.count)} href="/financeiro/contas-a-pagar?status=a_pagar" compact />
        <StatCard label="Vencidos" value={formatCurrency(kpis.vencidos.amount)} icon={<AlertCircle />} tone="danger" hint={count(kpis.vencidos.count)} href="/financeiro/contas-a-pagar?vencimento=vencidos" compact />
        <StatCard label="Pagos no mês" value={formatCurrency(kpis.pagosMes.amount)} icon={<CircleDollarSign />} tone="success" hint={count(kpis.pagosMes.count)} href="/financeiro/contas-a-pagar?status=pago" compact />
      </KpiStrip>

      {ws.can.cashFlow ? <CashFlowCard cashFlow={ws.cashFlow} className="mb-4" /> : null}

      <FinanceFilters
        className="mb-4"
        fields={[
          { param: "status", label: "Situação", allLabel: "Todas as situações", options: PAYABLE_STATUSES.map((s) => ({ value: s, label: PAYABLE_STATUS_LABELS[s] })) },
          { param: "categoria", label: "Categoria", allLabel: "Todas as categorias", options: ws.facets.categories },
          { param: "credor", label: "Credor", allLabel: "Todos os credores", options: ws.facets.creditors },
          { param: "centro", label: "Centro de custo", allLabel: "Todos os centros", options: ws.facets.costCenters },
          { param: "origem", label: "Origem", allLabel: "Todas as origens", options: (Object.keys(PAYABLE_ORIGIN_LABELS) as (keyof typeof PAYABLE_ORIGIN_LABELS)[]).map((o) => ({ value: o, label: PAYABLE_ORIGIN_LABELS[o] })) },
          { param: "competencia", label: "Competência", allLabel: "Todas as competências", options: ws.facets.competences },
          { param: "vencimento", label: "Vencimento", allLabel: "Qualquer vencimento", options: VENCIMENTO_OPTIONS },
        ]}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Títulos</CardTitle>
            <span className="text-sm text-muted">
              {ws.rows.length} de {ws.total}
            </span>
          </CardHeader>
          <PayablesTable key={JSON.stringify(filters)} rows={ws.rows} selectedId={ws.selected?.id} />
        </Card>
        {ws.selected ? (
          <SidePanelShell explicit={Boolean(requested)} param="titulo" ariaLabel="Título selecionado" title={`${ws.selected.code} · ${ws.selected.creditorName}`}>
            <PayablePanel key={ws.selected.id} p={ws.selected} can={ws.can} costCenters={ws.settings.centrosDeCusto} accounts={ws.accounts} />
          </SidePanelShell>
        ) : (
          <aside className="hidden xl:block">
            <Card className="p-5 text-sm text-muted">Selecione um título para ver a origem (venda → contrato → recebimento → regra → comissão → título; ou fornecedor / série), os anexos, a memória de cálculo e o histórico.</Card>
          </aside>
        )}
      </div>
    </PageContainer>
  );
}
