import type { Metadata } from "next";
import { Suspense } from "react";
import { Activity, CheckCircle2, Sigma, Target } from "lucide-react";
import { requireRole } from "@/server/auth/session";
import { currentMonthKey, getKpiAdminData, listRecentMonths, monthPeriod } from "@/server/kpis/queries";
import { formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { KpiAdminWorkspace } from "@/components/kpis/kpi-admin-workspace";

export const metadata: Metadata = { title: "Indicadores" };

/** Administração das definições de KPI: fórmula do registro, meta, faixa, atenção, peso e ativação. */
export default async function AdminIndicadoresPage() {
  await requireRole("admin");
  const period = monthPeriod(currentMonthKey());
  const data = await getKpiAdminData(period);

  const active = data.rows.filter((r) => r.definition.active !== false);
  const withTarget = active.filter((r) => r.definition.target !== undefined || (r.definition.targetMin !== undefined && r.definition.targetMax !== undefined));
  const achieved = active.filter((r) => r.current?.status === "atingida").length;
  const registered = new Set(data.rows.map((r) => r.definition.formula));
  const available = data.formulas.filter((f) => !registered.has(f.key)).length;
  const snapshotMonths = listRecentMonths(3)
    .reverse()
    .map((p) => ({ value: p.key, label: p.label }));

  return (
    <PageContainer size="full">
      <PageHeader
        title="Indicadores"
        description="Definições dos KPIs calculados pelo motor: cada indicador aponta para uma fórmula do registro e tem meta, sentido, faixa de atenção e peso."
        breadcrumbs={[{ label: "Administração", href: "/admin" }, { label: "Indicadores" }]}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Indicadores ativos" value={formatNumber(active.length)} icon={<Activity />} tone="info" hint={`${formatNumber(data.rows.length)} cadastrados`} compact />
        <StatCard label="Com meta" value={formatNumber(withTarget.length)} icon={<Target />} tone={withTarget.length < active.length ? "warning" : "success"} hint={`${formatNumber(active.length - withTarget.length)} ativos sem meta`} compact />
        <StatCard label={`Atingidos em ${period.label.toLowerCase()}`} value={formatNumber(achieved)} icon={<CheckCircle2 />} tone="success" hint={`de ${formatNumber(withTarget.length)} com meta`} compact />
        <StatCard label="Fórmulas sem cadastro" value={formatNumber(available)} icon={<Sigma />} tone="neutral" hint={`${formatNumber(data.formulas.length)} fórmulas no registro`} compact />
      </div>

      <Suspense fallback={null}>
        <KpiAdminWorkspace rows={data.rows} formulas={data.formulas} owners={data.owners} periodLabel={period.label} snapshotMonths={snapshotMonths} />
      </Suspense>
    </PageContainer>
  );
}
