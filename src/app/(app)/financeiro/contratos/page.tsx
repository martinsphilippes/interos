import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertCircle, CircleDollarSign, FileSignature, PenLine, Wallet } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { parseContractFilters } from "@/server/finance/queries";
import { canOperateFinance, PERIOD_OPTIONS } from "@/server/finance/schemas";
import { getContractsWorkspace, type KpiValue } from "@/server/finance/workspace";
import { formatCurrency, formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import type { Tone } from "@/components/ui/tone";
import { CONTRACT_STATUS_LABELS } from "@/components/clients/labels";
import { ContractPanelShell } from "@/components/finance/contract-panel-shell";
import { ContractSidePanel } from "@/components/finance/contract-side-panel";
import { ContractMilestonesCard, FinanceFlowCard } from "@/components/finance/contract-workspace-cards";
import { ContractsWorkspaceTable } from "@/components/finance/contracts-workspace-table";
import { FinanceFilters } from "@/components/finance/finance-filters";
import { NewContractButton } from "@/components/finance/new-contract-dialog";

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

/** Variação vs. fim do mês anterior: % para valores, diferença absoluta para contagens. */
function delta(kpi: KpiValue, kind: "money" | "count", upTone?: Tone, downTone?: Tone) {
  if (kpi.previous === null) return undefined;
  const diff = kpi.value - kpi.previous;
  const direction = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const tone = direction === "up" ? upTone : direction === "down" ? downTone : "neutral";
  if (kind === "count") return { value: `${diff > 0 ? "+" : ""}${formatNumber(diff)}`, direction, tone, label: "vs. mês anterior" } as const;
  if (kpi.previous === 0) return kpi.value === 0 ? ({ value: "0%", direction: "flat", tone: "neutral", label: "vs. mês anterior" } as const) : undefined;
  const pct = (diff / kpi.previous) * 100;
  return { value: `${Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`, direction, tone, label: "vs. mês anterior" } as const;
}

/**
 * Financeiro e Contratos (padrão 02): KPIs com variação, gestão de contratos com seleção, painel lateral do
 * contrato (?contrato=<id>), fluxo financeiro e linha do tempo. A página completa /financeiro/contratos/[id]
 * continua sendo a edição completa (itens, condições, cobranças, liberação).
 */
export default async function ContractsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "financeiro")) redirect("/meu-dia?erro=sem-permissao");
  const sp = await searchParams;
  const requested = (Array.isArray(sp.contrato) ? sp.contrato[0] : sp.contrato)?.trim() || undefined;
  const filters = parseContractFilters(sp);
  const ws = await getContractsWorkspace(filters, requested);
  const canOperate = canOperateFinance(user);
  const { kpis, selected } = ws;

  return (
    <PageContainer size="full" className="max-w-[1680px]">
      <PageHeader
        title="Contratos"
        description="Gerencie contratos, assinaturas, cobranças e contatos em um só lugar"
        breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Contratos" }]}
        actions={canOperate ? <NewContractButton opportunities={ws.newContract.opportunities} clients={ws.newContract.clients} /> : undefined}
      />

      <KpiStrip columns={5}>
        <StatCard label="Receita recorrente" value={formatCurrency(kpis.mrr.value)} icon={<CircleDollarSign />} tone="brand" delta={delta(kpis.mrr, "money", "success", "danger")} hint="MRR dos contratos liberados" href="/financeiro/recorrencia" compact />
        <StatCard label="A receber" value={formatCurrency(kpis.receivable.value)} icon={<Wallet />} tone="success" delta={delta(kpis.receivable, "money", "info", "info")} hint="Cobranças em aberto e vencidas" href="/financeiro/contas-a-receber" compact />
        <StatCard
          label="Vencidos"
          value={formatCurrency(kpis.overdue.value)}
          icon={<AlertCircle />}
          tone="danger"
          delta={delta(kpis.overdue, "money", "danger", "success")}
          hint={`${kpis.overdue.count} cobrança(s) vencida(s)`}
          href="/financeiro/cobrancas?status=vencida"
          compact
        />
        <StatCard label="Contratos ativos" value={formatNumber(kpis.activeContracts.value)} icon={<FileSignature />} tone="info" delta={delta(kpis.activeContracts, "count", "success", "danger")} hint="Liberados para implantação" href="/financeiro/contratos?status=liberado" compact />
        <StatCard
          label="Aguardando assinatura"
          value={formatNumber(kpis.awaitingSignature.value)}
          icon={<PenLine />}
          tone="warning"
          delta={delta(kpis.awaitingSignature, "count", "warning", "success")}
          hint="Documento gerado, assinatura pendente"
          href="/financeiro/contratos?status=assinatura"
          compact
        />
      </KpiStrip>

      <FinanceFilters
        className="mb-4"
        searchParam="q"
        searchPlaceholder="Buscar por número ou cliente"
        fields={[
          { param: "status", label: "Status", allLabel: "Todos os status", options: STATUS_OPTIONS },
          { param: "cliente", label: "Cliente", allLabel: "Todos os clientes", options: ws.facets.clients },
          { param: "responsavel", label: "Responsável", allLabel: "Todos os responsáveis", options: ws.facets.owners },
          { param: "periodo", label: "Período", allLabel: "Qualquer período", options: PERIOD_OPTIONS.map((p) => ({ value: p.value, label: p.label })) },
        ]}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="overflow-hidden">
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle>Gestão de contratos</CardTitle>
              <span className="text-sm text-muted">
                {ws.rows.length} de {ws.total} contrato(s)
              </span>
            </CardHeader>
            <ContractsWorkspaceTable key={JSON.stringify(filters)} rows={ws.rows} selectedId={selected?.id} />
          </Card>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <FinanceFlowCard flow={ws.flow} />
            <ContractMilestonesCard number={selected?.number} milestones={selected?.milestones ?? []} />
          </div>
        </div>

        {selected ? (
          <ContractPanelShell explicit={Boolean(requested)} title={`${selected.clientName} · ${selected.number}`}>
            <ContractSidePanel key={selected.id} panel={selected} integrations={ws.integrations} canOperate={canOperate} />
          </ContractPanelShell>
        ) : null}
      </div>
    </PageContainer>
  );
}
