import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Clock, MessageSquareReply, Settings, Smile, ThumbsDown, ThumbsUp, Timer } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getCsatReport, getSlaReport, type CsatBucket, type SlaCompliance } from "@/server/support/queries";
import { TICKET_PRIORITY_DEFINITIONS, TICKET_PRIORITY_LABELS, type TicketPriority } from "@/server/support/schemas";
import { formatCompetence, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserChip } from "@/components/ui/user-chip";
import { LiveSlaBadge } from "@/components/support/sla-live";
import { MonthSelect } from "@/components/support/month-select";
import { CsatTrendChart, SlaTrendChart } from "@/components/support/support-charts";
import { TicketPriorityBadge } from "@/components/support/ticket-badges";
import { complianceTone, csatTone, formatHoursShort, formatMinutes, formatSlaHours } from "@/components/support/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "SLA e qualidade do suporte" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TONE_TEXT = { success: "text-success-fg", warning: "text-warning-fg", danger: "text-danger-fg", neutral: "text-foreground" } as const;

function Pct({ value, total, target }: { value?: number; total: number; target: number }) {
  if (value === undefined) return <span className="text-muted-light">—</span>;
  return (
    <span className={cn("font-medium tabular-nums", TONE_TEXT[complianceTone(value, target)])} title={`${total} chamado(s) avaliado(s)`}>
      {formatPercent(value)}
      <span className="ml-1 text-xs font-normal text-muted">({total})</span>
    </span>
  );
}

function Csat({ bucket, target }: { bucket: CsatBucket; target: number }) {
  if (bucket.average === undefined) return <span className="text-muted-light">—</span>;
  return <span className={cn("font-medium tabular-nums", TONE_TEXT[csatTone(bucket.average, target)])}>{bucket.average.toFixed(1).replace(".", ",")}</span>;
}

function statusLabel(c: SlaCompliance, target: number): { label: string; variant: "success" | "warning" | "danger" | "muted" } {
  const tone = complianceTone(c.resolutionPct, target);
  if (tone === "neutral") return { label: "Sem base", variant: "muted" };
  return tone === "success" ? { label: "Atingida", variant: "success" } : tone === "warning" ? { label: "Atenção", variant: "warning" } : { label: "Crítico", variant: "danger" };
}

/** Matriz de SLA do suporte, cumprimento do mês (geral, por atendente e criticidade), histórico e CSAT. */
export default async function SupportSlaPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "suporte")) redirect("/meu-dia?erro=sem-permissao");
  const sp = await searchParams;
  const month = Array.isArray(sp.mes) ? sp.mes[0] : sp.mes;
  const [report, csat] = await Promise.all([getSlaReport(month), getCsatReport(month)]);
  const { overall, targets } = report;
  const monthOptions = [...report.months].reverse().map((m) => ({ value: m, label: formatCompetence(m) }));
  const overallStatus = statusLabel(overall, targets.slaResolution);

  return (
    <PageContainer>
      <PageHeader
        title="SLA e qualidade"
        description="Cumprimento de primeira resposta e de solução, tempos médios e satisfação (CSAT) do suporte."
        breadcrumbs={[{ label: "Suporte", href: "/suporte" }, { label: "SLA" }]}
        badge={<Badge variant={overallStatus.variant}>{overallStatus.label}</Badge>}
        actions={<MonthSelect value={report.month} options={monthOptions} />}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard compact label="SLA 1ª resposta" value={overall.responsePct !== undefined ? formatPercent(overall.responsePct) : "—"} icon={<MessageSquareReply />} tone={complianceTone(overall.responsePct, targets.slaResponse)} hint={`${overall.responseMet}/${overall.responseTotal} · meta ${formatPercent(targets.slaResponse)}`} />
        <StatCard compact label="SLA de solução" value={overall.resolutionPct !== undefined ? formatPercent(overall.resolutionPct) : "—"} icon={<CheckCircle2 />} tone={complianceTone(overall.resolutionPct, targets.slaResolution)} hint={`${overall.resolutionMet}/${overall.resolutionTotal} · meta ${formatPercent(targets.slaResolution)}`} />
        <StatCard compact label="Resposta média" value={formatMinutes(overall.avgResponseMinutes)} icon={<Clock />} tone="neutral" hint="da abertura à 1ª resposta" />
        <StatCard compact label="Solução média" value={formatHoursShort(overall.avgResolutionHours)} icon={<Timer />} tone="neutral" hint="da abertura à solução (corrido)" />
        <StatCard compact label="Resolvidos no mês" value={formatNumber(overall.resolved)} icon={<CheckCircle2 />} tone="success" href={`/suporte/chamados?status=resolvido,fechado&periodo=mes`} />
        <StatCard compact label="Em risco / violados agora" value={formatNumber(report.critical.length)} icon={<Timer />} tone={report.critical.length > 0 ? "danger" : "success"} href="/suporte/chamados?sla=violado" />
      </div>

      <div className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Cumprimento de SLA · últimos 6 meses</CardTitle>
            <CardDescription>1ª resposta: firstResponseAt ≤ prazo de resposta. Solução: resolvedAt ≤ prazo (chamados vencidos em aberto contam como violados).</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <SlaTrendChart data={report.series} target={targets.slaResolution} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Matriz de SLA</CardTitle>
              <CardDescription>Regras suporte.* em vigor (horário comercial seg–sex 8h–18h, exceto quando indicado).</CardDescription>
            </div>
            {user.isAdmin ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/configuracoes">
                  <Settings /> Editar
                </Link>
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="px-0 pt-0">
            {report.rules.length === 0 ? (
              <EmptyState size="sm" title="Nenhuma regra de suporte cadastrada" description="Cadastre as regras suporte.critico, suporte.alto, suporte.medio e suporte.baixo em Administração > Configurações." />
            ) : (
              <Table className="min-w-[440px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Criticidade</TableHead>
                    <TableHead className="text-right">Resposta</TableHead>
                    <TableHead className="text-right">Solução</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rules.map((r) => {
                    const p = r.key.split(".")[1] as TicketPriority;
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          {TICKET_PRIORITY_LABELS[p] ? <TicketPriorityBadge priority={p} /> : r.name}
                          <p className="mt-0.5 text-xs text-muted">{TICKET_PRIORITY_DEFINITIONS[p] ?? r.name}</p>
                          {!r.businessHoursOnly ? <p className="text-[11px] text-muted">24×7 (horas corridas)</p> : null}
                          {!r.active ? <Badge variant="muted">inativa</Badge> : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatSlaHours(r.responseHours, r.businessHoursOnly)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatSlaHours(r.resolutionHours, r.businessHoursOnly)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            <p className="px-5 pt-3 text-xs text-muted">
              Atenção a partir de {report.rules[0]?.attentionPct ?? 50}% do prazo consumido; risco a partir de {report.rules[0]?.riskPct ?? 80}%. Pausas autorizadas (aguardando cliente) não contam.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Por atendente · {formatCompetence(report.month)}</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pt-0">
            {report.byAttendant.length === 0 ? (
              <EmptyState size="sm" title="Sem chamados avaliados no mês" />
            ) : (
              <Table className="min-w-[560px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Atendente</TableHead>
                    <TableHead className="text-right">1ª resposta</TableHead>
                    <TableHead className="text-right">Solução</TableHead>
                    <TableHead className="text-right">Resp. média</TableHead>
                    <TableHead className="text-right">Resolvidos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.byAttendant.map((r) => (
                    <TableRow key={r.user.id}>
                      <TableCell>
                        <UserChip name={r.user.name} avatarUrl={r.user.avatarUrl} size="sm" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Pct value={r.responsePct} total={r.responseTotal} target={targets.slaResponse} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Pct value={r.resolutionPct} total={r.resolutionTotal} target={targets.slaResolution} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMinutes(r.avgResponseMinutes)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Link href={`/suporte/chamados?status=resolvido,fechado&periodo=mes&atendente=${r.user.id}`} className="hover:underline">
                          {r.resolved}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Por criticidade · {formatCompetence(report.month)}</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pt-0">
            <Table className="min-w-[520px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Criticidade</TableHead>
                  <TableHead className="text-right">1ª resposta</TableHead>
                  <TableHead className="text-right">Solução</TableHead>
                  <TableHead className="text-right">Solução média</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.byPriority.map((r) => (
                  <TableRow key={r.priority}>
                    <TableCell>
                      <Link href={`/suporte/chamados?prioridade=${r.priority}&periodo=mes`}>
                        <TicketPriorityBadge priority={r.priority} />
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      <Pct value={r.responsePct} total={r.responseTotal} target={targets.slaResponse} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Pct value={r.resolutionPct} total={r.resolutionTotal} target={targets.slaResolution} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatHoursShort(r.avgResolutionHours)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-8 overflow-hidden">
        <CardHeader>
          <CardTitle>Chamados em risco ou violados agora</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pt-0">
          {report.critical.length === 0 ? (
            <EmptyState size="sm" icon={<CheckCircle2 />} title="Nenhum chamado em risco" description="Todos os chamados abertos estão dentro do prazo." />
          ) : (
            <ul className="divide-y divide-border">
              {report.critical.map((t) => (
                <li key={t.id}>
                  <Link href={`/suporte/chamados/${t.id}`} className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 hover:bg-surface-hover">
                    <LiveSlaBadge sla={t.sla} />
                    <span className="font-mono text-xs text-muted">{t.number}</span>
                    <TicketPriorityBadge priority={t.priority} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.subject}</span>
                    <span className="text-sm text-muted">{t.clientName}</span>
                    <span className="text-xs text-muted">{t.assigneeName ?? "sem atendente"} · vence {formatDateTime(t.sla?.dueAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* CSAT */}
      <section id="csat" className="scroll-mt-20">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Smile className="size-5 text-muted" /> Satisfação (CSAT) · {formatCompetence(csat.month)}
        </h2>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard compact label="CSAT da equipe" value={csat.team.average !== undefined ? csat.team.average.toFixed(1).replace(".", ",") : "—"} icon={<Smile />} tone={csatTone(csat.team.average, csat.target)} hint={`meta ${csat.target.toFixed(1).replace(".", ",")} (escala 0–10)`} />
          <StatCard compact label="Avaliações" value={formatNumber(csat.team.count)} icon={<MessageSquareReply />} tone="neutral" />
          <StatCard compact label="Notas 9–10" value={formatNumber(csat.team.promoters)} icon={<ThumbsUp />} tone="success" hint={csat.team.count ? formatPercent(csat.team.promoters / csat.team.count) : undefined} />
          <StatCard compact label="Notas 0–6" value={formatNumber(csat.team.detractors)} icon={<ThumbsDown />} tone={csat.team.detractors > 0 ? "danger" : "success"} hint="geram tarefa de investigação" />
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>CSAT médio · últimos 6 meses</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <CsatTrendChart data={csat.series} target={csat.target} />
            </CardContent>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Por atendente e por produto</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 px-0 pt-0">
              {csat.byAttendant.length === 0 && csat.byProduct.length === 0 ? <EmptyState size="sm" title="Nenhuma avaliação no mês" /> : null}
              {csat.byAttendant.length > 0 ? (
                <ul className="divide-y divide-border">
                  {csat.byAttendant.map((a) => (
                    <li key={a.user.id} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                      <UserChip name={a.user.name} avatarUrl={a.user.avatarUrl} size="sm" />
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted">{a.count} aval.</span>
                        <Csat bucket={a} target={csat.target} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {csat.byProduct.length > 0 ? (
                <div>
                  <p className="label-caps px-5 pb-1">Por produto</p>
                  <ul className="divide-y divide-border">
                    {csat.byProduct.map((p) => (
                      <li key={p.productId} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                        <span className="truncate">{p.productName}</span>
                        <span className="flex items-center gap-2">
                          <span className="text-xs text-muted">{p.count} aval.</span>
                          <Csat bucket={p} target={csat.target} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Avaliações recentes</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pt-0">
              {csat.recent.length === 0 ? (
                <EmptyState size="sm" title="Nenhuma avaliação recebida" />
              ) : (
                <ul className="divide-y divide-border">
                  {csat.recent.map((r) => (
                    <li key={r.id}>
                      <Link href={`/suporte/chamados/${r.ticketId}`} className="flex gap-3 px-5 py-2.5 hover:bg-surface-hover">
                        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold", r.score >= 9 ? "bg-success-soft text-success-fg" : r.score >= 7 ? "bg-warning-soft text-warning-fg" : "bg-danger-soft text-danger-fg")}>{r.score}</span>
                        <span className="min-w-0 text-sm">
                          <span className="block truncate font-medium">{r.clientName ?? "Cliente"}</span>
                          <span className="block text-xs text-muted">
                            {r.ticketNumber} · {r.attendantName ?? "—"} · {formatDateTime(r.respondedAt)}
                          </span>
                          {r.comment ? <span className="mt-0.5 block text-xs italic text-foreground">“{r.comment}”</span> : null}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </PageContainer>
  );
}
