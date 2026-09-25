import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, HeartPulse, Settings } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getHealthDetail, getHealthOverview } from "@/server/cs/queries";
import { runDueSweeps } from "@/server/automations/lazy";
import { HEALTH_FACTORS, HEALTH_LEVEL_LABELS } from "@/server/cs/schemas";
import { HEALTH_LEVELS, type HealthLevel } from "@/domain/constants";
import { formatCurrency, formatPercent, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HealthIndicator, LevelBadge, OwnerCell } from "@/components/cs/cs-bits";
import { HealthDrawer } from "@/components/cs/health-drawer";
import { RecalculateAllButton } from "@/components/cs/health-actions";
import { ScopeSelect } from "@/components/cs/scope-select";

export const metadata: Metadata = { title: "Saúde dos clientes" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const LEVEL_BG: Record<HealthLevel, string> = { saudavel: "bg-success", atencao: "bg-warning", risco: "bg-danger" };
const LEVEL_TEXT: Record<HealthLevel, string> = { saudavel: "text-success-fg", atencao: "text-warning-fg", risco: "text-danger-fg" };

/** Health Score: distribuição por nível, pesos configurados, tabela e drill-down por cliente. */
export default async function HealthPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "cs")) redirect("/meu-dia?erro=sem-permissao");
  const params = await searchParams;
  // Recálculo automático da carteira pela varredura central (padrão: 1x por dia; ajustável em /admin/automacoes).
  await runDueSweeps(["saude_clientes"]);
  const clientParam = typeof params.cliente === "string" ? params.cliente : undefined;
  const [data, detail] = await Promise.all([getHealthOverview(user, params), clientParam ? getHealthDetail(clientParam) : Promise.resolve(null)]);
  const total = HEALTH_LEVELS.reduce((s, l) => s + data.distribution[l].count, 0);
  const weightTotal = HEALTH_FACTORS.reduce((s, f) => s + Math.max(0, data.config.pesos[f.key] ?? 0), 0);
  const levelParam = typeof params.nivel === "string" ? params.nivel : "";
  const link = (patch: Record<string, string>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (typeof v === "string") next.set(k, v);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    return qs ? `/cs/saude?${qs}` : "/cs/saude";
  };

  return (
    <PageContainer>
      <PageHeader
        title="Saúde dos clientes"
        description={`Health score configurável · ${data.lastSweep.ranAt ? `recálculo automático ${formatRelative(data.lastSweep.ranAt)}` : "sem recálculo automático ainda"}`}
        breadcrumbs={[{ label: "Customer Success", href: "/cs" }, { label: "Saúde" }]}
        actions={
          <>
            <ScopeSelect owners={data.owners} value={data.scope.param} />
            {user.isManager ? <RecalculateAllButton /> : null}
          </>
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Distribuição por nível</CardTitle>
            <CardDescription>
              {total} cliente(s) com score{data.unscored > 0 ? ` · ${data.unscored} sem cálculo` : ""} · clique para filtrar
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {total > 0 ? (
              <div className="mb-4 flex h-3 w-full overflow-hidden rounded-full bg-surface-hover" role="img" aria-label={HEALTH_LEVELS.map((l) => `${HEALTH_LEVEL_LABELS[l]}: ${data.distribution[l].count}`).join(", ")}>
                {HEALTH_LEVELS.map((l) => (data.distribution[l].count > 0 ? <span key={l} className={LEVEL_BG[l]} style={{ width: `${(data.distribution[l].count / total) * 100}%` }} /> : null))}
              </div>
            ) : null}
            <div className="grid grid-cols-3 gap-3">
              {HEALTH_LEVELS.map((l) => (
                <Link
                  key={l}
                  href={link({ nivel: levelParam === l ? "" : l })}
                  className={cn("rounded-lg border border-border p-3 transition-colors hover:border-border-strong hover:bg-surface-muted", levelParam === l && "border-brand bg-brand-soft/40")}
                >
                  <p className="label-caps">{HEALTH_LEVEL_LABELS[l]}</p>
                  <p className={cn("mt-1 text-2xl font-semibold tabular-nums", LEVEL_TEXT[l])}>{data.distribution[l].count}</p>
                  <p className="text-xs text-muted">
                    {total > 0 ? formatPercent(data.distribution[l].count / total) : "—"} · {formatCurrency(data.distribution[l].mrr, true)}/mês
                  </p>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-2">
            <div>
              <CardTitle>Pesos do score</CardTitle>
              <CardDescription>
                Saudável ≥ {data.config.limiares.saudavel} · atenção ≥ {data.config.limiares.atencao} · risco abaixo
              </CardDescription>
            </div>
            {user.isAdmin ? (
              <Button asChild variant="ghost" size="icon" aria-label="Configurar pesos">
                <Link href="/admin/configuracoes">
                  <Settings />
                </Link>
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="flex flex-col gap-1.5 text-sm">
              {HEALTH_FACTORS.map((f) => {
                const w = Math.max(0, data.config.pesos[f.key] ?? 0);
                return (
                  <li key={f.key} className="flex items-center justify-between gap-2">
                    <span className={cn(w === 0 && "text-muted-light line-through")}>{f.label}</span>
                    <span className="tabular-nums text-muted">{weightTotal > 0 ? formatPercent(w / weightTotal) : "—"}</span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>

      {data.rows.length === 0 ? (
        <Card>
          <EmptyState icon={<HeartPulse />} title="Nenhum cliente neste filtro" description="Troque o nível ou a carteira selecionada." />
        </Card>
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Nível</TableHead>
                  <TableHead>Principais fatores</TableHead>
                  <TableHead className="text-right">MRR</TableHead>
                  <TableHead>Calculado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => {
                  const delta = r.score !== undefined && r.previousScore !== undefined ? r.score - r.previousScore : 0;
                  return (
                    <TableRow key={r.clientId}>
                      <TableCell>
                        <Link href={link({ cliente: r.clientId })} scroll={false} className="font-medium hover:text-brand hover:underline">
                          {r.tradeName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <OwnerCell owner={r.owner} />
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5">
                          <HealthIndicator score={r.score} level={r.level} />
                          {delta !== 0 ? (
                            <span className={cn("inline-flex items-center text-xs tabular-nums", delta > 0 ? "text-success-fg" : "text-danger-fg")} title="Variação desde o cálculo anterior">
                              {delta > 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                              {Math.abs(delta)}
                            </span>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell>
                        <LevelBadge level={r.level} />
                      </TableCell>
                      <TableCell className="text-sm text-muted">{r.weakest.length > 0 ? r.weakest.map((f) => `${f.label} (${f.value})`).join(" · ") : "Todos os fatores saudáveis"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(r.mrr)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted">{r.computedAt ? formatRelative(r.computedAt) : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
          <ul className="flex flex-col gap-3 md:hidden">
            {data.rows.map((r) => (
              <li key={r.clientId}>
                <Link href={link({ cliente: r.clientId })} scroll={false} className="block rounded-lg border border-border bg-surface p-4 shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{r.tradeName}</p>
                    <HealthIndicator score={r.score} level={r.level} showLabel />
                  </div>
                  <p className="mt-1 text-sm text-muted">{r.weakest.length > 0 ? r.weakest.map((f) => `${f.label} (${f.value})`).join(" · ") : "Todos os fatores saudáveis"}</p>
                  <p className="mt-1 text-xs text-muted">
                    {formatCurrency(r.mrr)}/mês · {r.owner?.name ?? "sem responsável"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <HealthDrawer detail={detail} limiares={data.config.limiares} />
    </PageContainer>
  );
}
