import { AlertTriangle, BadgeCheck, CircleDollarSign, FilePlus2, FileWarning, Hourglass, PenLine, Percent } from "lucide-react";
import type { FinanceOverview } from "@/server/finance/queries";
import { formatCompetence, formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { StatCard } from "@/components/ui/stat-card";

/** Inadimplência: meta da empresa ≤ 4% (atenção até 6%), conforme a planilha de relatórios do Financeiro. */
function delinquencyTone(value: number | null): "success" | "warning" | "danger" | "neutral" {
  if (value === null) return "neutral";
  if (value <= 0.04) return "success";
  if (value <= 0.06) return "warning";
  return "danger";
}

/** Cards da fila do Financeiro. Cada card leva à lista já filtrada (drill-down). */
export function FinanceStats({ overview }: { overview: FinanceOverview }) {
  const { counts } = overview;
  const q = (params: string) => `/financeiro/contratos?${params}`;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard label="Aguardando contrato" value={formatNumber(counts.contrato)} icon={<FilePlus2 />} tone={counts.contrato > 0 ? "info" : "neutral"} href={q("status=contrato")} compact />
      <StatCard label="Aguardando assinatura" value={formatNumber(counts.assinatura)} icon={<PenLine />} tone={counts.assinatura > 0 ? "info" : "neutral"} href={q("status=assinatura")} compact />
      <StatCard label="Aguardando pagamento" value={formatNumber(counts.pagamento)} icon={<Hourglass />} tone={counts.pagamento > 0 ? "warning" : "neutral"} hint="Assinados, à espera de cobrança/pagamento" href={q("status=pagamento")} compact />
      <StatCard label="Com pendência" value={formatNumber(counts.pendencia)} icon={<FileWarning />} tone={counts.pendencia > 0 ? "danger" : "success"} href={q("status=pendencia")} compact />
      <StatCard label="Liberados no mês" value={formatNumber(counts.liberadosMes)} icon={<BadgeCheck />} tone="success" hint={formatCompetence(overview.month)} href={q("status=liberados_mes")} compact />
      <StatCard label="MRR ativo" value={formatCurrency(overview.mrrActive)} icon={<CircleDollarSign />} tone="success" hint={`${overview.activeContracts} contrato(s) liberado(s)`} href="/financeiro/recorrencia" compact />
      <StatCard
        label="Vencidos"
        value={formatCurrency(overview.overdue.amount)}
        icon={<AlertTriangle />}
        tone={overview.overdue.count > 0 ? "danger" : "success"}
        hint={`${overview.overdue.count} cobrança(s) vencida(s)`}
        href="/financeiro/cobrancas?status=vencida"
        compact
      />
      <StatCard
        label="Inadimplência"
        value={overview.delinquency === null ? "—" : formatPercent(overview.delinquency)}
        icon={<Percent />}
        tone={delinquencyTone(overview.delinquency)}
        hint={`Vencido ÷ faturado no mês (${formatCurrency(overview.billedMonth, true)})`}
        href="/financeiro/contas-a-receber"
        compact
      />
    </div>
  );
}
