import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, Goal, XCircle } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { currentMonthKey, getGoalsBoard, listRecentMonths, monthPeriod, parsePeriod } from "@/server/kpis/queries";
import { formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { GoalsWorkspace } from "@/components/kpis/goals-workspace";
import { PeriodSelect } from "@/components/kpis/period-select";

export const metadata: Metadata = { title: "Metas" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Metas mensais por indicador (empresa, departamento, colaborador) com o valor atual calculado pelo motor. */
export default async function MetasPage({ searchParams }: { searchParams: SearchParams }) {
  const [user, query] = await Promise.all([requireUser(), searchParams]);
  const requested = parsePeriod(query);
  // Metas são mensais: outros tipos de período caem no mês corrente.
  const period = requested.kind === "mes" ? requested : monthPeriod(currentMonthKey());
  const board = await getGoalsBoard(user, period);

  const nextMonth = monthPeriod(new Date(Date.UTC(Number(currentMonthKey().slice(0, 4)), Number(currentMonthKey().slice(5, 7)), 1)).toISOString().slice(0, 7));
  const options = [nextMonth, ...listRecentMonths(12).reverse()].map((p) => ({ value: p.key, label: p.label }));

  const achieved = board.rows.filter((r) => r.status === "atingida").length;
  const attention = board.rows.filter((r) => r.status === "atencao").length;
  const critical = board.rows.filter((r) => r.status === "critico").length;

  return (
    <PageContainer>
      <PageHeader
        title="Metas"
        description={`Metas de ${period.label.toLowerCase()} por indicador, com atingimento calculado a partir dos registros do sistema.`}
        breadcrumbs={[{ label: "Performance", href: "/performance" }, { label: "Metas" }]}
        actions={<PeriodSelect options={options} value={period.key} label="Competência" />}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Metas no mês" value={formatNumber(board.rows.length)} icon={<Goal />} tone="info" compact />
        <StatCard label="Atingidas" value={formatNumber(achieved)} icon={<CheckCircle2 />} tone="success" compact />
        <StatCard label="Em atenção" value={formatNumber(attention)} icon={<AlertTriangle />} tone="warning" compact />
        <StatCard label="Críticas" value={formatNumber(critical)} icon={<XCircle />} tone="danger" compact />
      </div>

      <GoalsWorkspace board={board} />
    </PageContainer>
  );
}
