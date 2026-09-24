import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, CircleDollarSign, HeartPulse, Plus, Receipt, Route, UserMinus } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { listRisks, type RiskRow } from "@/server/cs/queries";
import { formatCurrency, formatNumber, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { CheckpointDialog } from "@/components/cs/checkpoint-dialog";
import { HealthIndicator, LevelBadge, OwnerCell } from "@/components/cs/cs-bits";
import { EscalateDialog } from "@/components/cs/escalate-dialog";
import { ScopeSelect } from "@/components/cs/scope-select";

export const metadata: Metadata = { title: "Riscos" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function RiskCard({ r }: { r: RiskRow }) {
  return (
    <Card className={cn("flex flex-col gap-3 p-4", r.healthLevel === "risco" && "border-danger/40")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/clientes/${r.clientId}?aba=cs`} className="font-semibold hover:text-brand hover:underline">
              {r.tradeName}
            </Link>
            <LevelBadge level={r.healthLevel} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <Link href={`/cs/saude?cliente=${r.clientId}`} className="hover:underline">
              <HealthIndicator score={r.healthScore} level={r.healthLevel} />
            </Link>
            <span className="tabular-nums">{formatCurrency(r.mrr)}/mês</span>
            <OwnerCell owner={r.owner} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1 sm:justify-end">
          {!r.activePlanId ? (
            <Button asChild size="sm" variant="outline" className="min-h-[44px] md:min-h-0">
              <Link href={`/cs/planos?novo=1&cliente=${r.clientId}`}>
                <Plus /> Criar plano
              </Link>
            </Button>
          ) : null}
          <CheckpointDialog clientId={r.clientId} clientName={r.tradeName} adoptionPct={r.adoptionPct} />
          <EscalateDialog clientId={r.clientId} clientName={r.tradeName} reasons={r.riskReasons} />
        </div>
      </div>
      {r.riskReasons.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {r.riskReasons.map((reason) => (
            <li key={reason} className="flex items-start gap-2">
              <AlertTriangle className={cn("mt-0.5 size-3.5 shrink-0", r.healthLevel === "risco" ? "text-danger" : "text-warning")} aria-hidden />
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Sem motivos registrados na conta de CS. Recalcule a saúde ou registre um checkpoint.</p>
      )}
      <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm md:grid-cols-4">
        <div>
          <dt className="label-caps">Chamados abertos</dt>
          <dd className={cn("tabular-nums", r.openTickets > 0 && "font-medium")}>{r.openTickets}</dd>
        </div>
        <div>
          <dt className="label-caps">Financeiro vencido</dt>
          <dd className={cn("tabular-nums", r.overdueAmount > 0 ? "font-medium text-danger-fg" : "text-success-fg")}>{r.overdueAmount > 0 ? formatCurrency(r.overdueAmount) : "Em dia"}</dd>
        </div>
        <div>
          <dt className="label-caps">Plano ativo</dt>
          <dd>
            {r.activePlanId ? (
              <Link href={`/cs/planos?plano=${r.activePlanId}`} className="text-secondary hover:underline" title={r.activePlanObjective}>
                Sim · ver plano
              </Link>
            ) : (
              <span className="text-danger-fg">Não</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="label-caps">Última interação</dt>
          <dd>{r.lastInteractionAt ? formatRelative(r.lastInteractionAt) : "—"}</dd>
        </div>
      </dl>
    </Card>
  );
}

/** Riscos: clientes em risco/atenção com motivos, MRR em risco e ações de retenção. */
export default async function RisksPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "cs")) redirect("/meu-dia?erro=sem-permissao");
  const data = await listRisks(user, await searchParams);
  const { totals } = data;
  const risk = data.rows.filter((r) => r.healthLevel === "risco");
  const attention = data.rows.filter((r) => r.healthLevel === "atencao");

  return (
    <PageContainer>
      <PageHeader
        title="Riscos"
        description="Clientes em risco ou atenção pelo health score, com os motivos e as ações de retenção."
        breadcrumbs={[{ label: "Customer Success", href: "/cs" }, { label: "Riscos" }]}
        actions={
          <>
            <ScopeSelect owners={data.owners} value={data.scope.param} />
            <Button asChild variant="outline" size="sm">
              <Link href="/cs/churn">
                <UserMinus /> Churn
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="MRR em risco" value={formatCurrency(totals.mrrRisk)} icon={<CircleDollarSign />} tone="danger" hint={`${totals.risk} cliente(s) em risco`} href="/cs?saude=risco" compact />
        <StatCard label="MRR em atenção" value={formatCurrency(totals.mrrAttention)} icon={<HeartPulse />} tone="warning" hint={`${totals.attention} cliente(s)`} href="/cs?saude=atencao" compact />
        <StatCard label="Sem plano ativo" value={formatNumber(totals.withoutPlan)} icon={<Route />} tone={totals.withoutPlan > 0 ? "warning" : "success"} href="/cs/planos" compact />
        <StatCard label="Financeiro vencido" value={formatCurrency(totals.overdueAmount)} icon={<Receipt />} tone={totals.overdueAmount > 0 ? "danger" : "success"} href="/financeiro/contas-a-receber" compact />
      </div>

      {data.rows.length === 0 ? (
        <Card>
          <EmptyState icon={<HeartPulse />} title="Nenhum cliente em risco ou atenção" description="A carteira selecionada está saudável." />
        </Card>
      ) : (
        <div className="flex flex-col gap-8">
          {[
            { title: "Em risco", rows: risk },
            { title: "Em atenção", rows: attention },
          ]
            .filter((g) => g.rows.length > 0)
            .map((g) => (
              <section key={g.title}>
                <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
                  {g.title}
                  <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium tabular-nums text-muted">{g.rows.length}</span>
                </h2>
                <ul className="grid gap-3 xl:grid-cols-2">
                  {g.rows.map((r) => (
                    <li key={r.clientId}>
                      <RiskCard r={r} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </PageContainer>
  );
}
