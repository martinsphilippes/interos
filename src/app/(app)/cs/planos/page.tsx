import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Route } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getSuccessPlan, listSuccessPlans } from "@/server/cs/queries";
import { SUCCESS_PLAN_ORIGIN_LABELS, SUCCESS_PLAN_STATUS_LABELS, SUCCESS_PLAN_STATUS_VARIANT } from "@/server/cs/schemas";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OwnerCell } from "@/components/cs/cs-bits";
import { PlanDrawer } from "@/components/cs/plan-drawer";
import { ScopeSelect } from "@/components/cs/scope-select";

export const metadata: Metadata = { title: "Planos de sucesso" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const STATUS_TABS = [
  { value: "ativo", label: "Ativos" },
  { value: "concluido", label: "Concluídos" },
  { value: "cancelado", label: "Cancelados" },
  { value: "todos", label: "Todos" },
] as const;

/** Planos de sucesso: lista por status e drawer de detalhe/edição (ações sincronizadas com tarefas). */
export default async function PlansPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "cs")) redirect("/meu-dia?erro=sem-permissao");
  const params = await searchParams;
  const planId = typeof params.plano === "string" ? params.plano : undefined;
  const creating = params.novo === "1";
  const initialClientId = typeof params.cliente === "string" ? params.cliente : undefined;
  const [data, plan] = await Promise.all([listSuccessPlans(user, params), planId ? getSuccessPlan(planId) : Promise.resolve(null)]);
  const clientName = plan ? data.clients.find((c) => c.id === plan.clientId)?.tradeName ?? data.rows.find((r) => r.plan.id === plan.id)?.tradeName : undefined;
  const link = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams({ responsavel: data.scope.param, status: data.status });
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return `/cs/planos?${next.toString()}`;
  };
  const now = new Date().toISOString();

  return (
    <PageContainer>
      <PageHeader
        title="Planos de sucesso"
        description="Objetivos com ações que viram tarefas reais. Planos automáticos nascem quando a saúde entra em risco."
        breadcrumbs={[{ label: "Customer Success", href: "/cs" }, { label: "Planos de sucesso" }]}
        actions={
          <>
            <ScopeSelect owners={data.users.filter((u) => u.departmentId === "cs")} value={data.scope.param} />
            <Button asChild size="sm">
              <Link href={link({ novo: "1", plano: null })} scroll={false}>
                <Plus /> Novo plano
              </Link>
            </Button>
          </>
        }
      >
        <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Status">
          {STATUS_TABS.map((t) => (
            <Link
              key={t.value}
              href={link({ status: t.value })}
              aria-current={data.status === t.value ? "page" : undefined}
              className={cn("-mb-px inline-flex min-h-[40px] items-center gap-1.5 border-b-2 px-3 text-sm font-medium", data.status === t.value ? "border-brand text-foreground" : "border-transparent text-muted hover:text-foreground")}
            >
              {t.label}
              {t.value !== "todos" ? <span className="rounded-full bg-surface-hover px-1.5 text-xs tabular-nums">{data.counts[t.value]}</span> : null}
            </Link>
          ))}
        </nav>
      </PageHeader>

      {data.rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Route />}
            title="Nenhum plano neste filtro"
            description="Crie um plano para organizar as ações de sucesso de um cliente."
            action={
              <Button asChild>
                <Link href={link({ novo: "1" })} scroll={false}>
                  <Plus /> Novo plano
                </Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Objetivo</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Ações</TableHead>
                  <TableHead>Checkpoint</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Origem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.plan.id}>
                    <TableCell className="whitespace-nowrap font-medium">{r.tradeName}</TableCell>
                    <TableCell className="max-w-[360px]">
                      <Link href={link({ plano: r.plan.id })} scroll={false} className="line-clamp-2 hover:text-brand hover:underline">
                        {r.plan.objective}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <OwnerCell owner={r.owner} />
                    </TableCell>
                    <TableCell className="w-40">
                      <Progress value={r.total ? (r.done / r.total) * 100 : 0} size="sm" tone="success" />
                      <p className="mt-0.5 text-xs tabular-nums text-muted">
                        {r.done}/{r.total}
                        {r.overdueActions > 0 && r.plan.status === "ativo" ? <span className="text-danger-fg"> · {r.overdueActions} atrasada(s)</span> : null}
                      </p>
                    </TableCell>
                    <TableCell className={cn("whitespace-nowrap text-sm", r.plan.status === "ativo" && r.plan.checkpointAt && r.plan.checkpointAt < now ? "text-danger-fg" : "text-muted")}>{formatDate(r.plan.checkpointAt)}</TableCell>
                    <TableCell>
                      <Badge variant={SUCCESS_PLAN_STATUS_VARIANT[r.plan.status]} size="sm">
                        {SUCCESS_PLAN_STATUS_LABELS[r.plan.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted">{SUCCESS_PLAN_ORIGIN_LABELS[r.plan.origin]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <ul className="flex flex-col gap-3 md:hidden">
            {data.rows.map((r) => (
              <li key={r.plan.id}>
                <Link href={link({ plano: r.plan.id })} scroll={false} className="block rounded-lg border border-border bg-surface p-4 shadow-card">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">{r.tradeName}</p>
                    <Badge variant={SUCCESS_PLAN_STATUS_VARIANT[r.plan.status]} size="sm">
                      {SUCCESS_PLAN_STATUS_LABELS[r.plan.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm">{r.plan.objective}</p>
                  <Progress value={r.total ? (r.done / r.total) * 100 : 0} size="sm" tone="success" className="mt-2" />
                  <p className="mt-1 text-xs text-muted">
                    {r.done}/{r.total} ações · {r.owner?.name ?? "—"} · {SUCCESS_PLAN_ORIGIN_LABELS[r.plan.origin]}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <PlanDrawer plan={plan} clientName={clientName} creating={creating} initialClientId={initialClientId} users={data.users} clients={data.clients} currentUserId={user.id} />
    </PageContainer>
  );
}
