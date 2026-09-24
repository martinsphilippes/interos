import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, CalendarCheck, CalendarX, ChevronLeft, ChevronRight, History } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getCheckpointAgenda } from "@/server/cs/queries";
import { dateKey, formatDateKey, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionTitle } from "@/components/ui/section-title";
import { AgendaItemCard } from "@/components/cs/agenda-item";
import { CheckpointDialog } from "@/components/cs/checkpoint-dialog";
import { OwnerCell } from "@/components/cs/cs-bits";
import { ScopeSelect } from "@/components/cs/scope-select";

export const metadata: Metadata = { title: "Checkpoints" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Agenda de checkpoints (próximas interações da carteira) por semana ou mês, com vencidos em destaque. */
export default async function CheckpointsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "cs")) redirect("/meu-dia?erro=sem-permissao");
  const params = await searchParams;
  const agenda = await getCheckpointAgenda(user, params);
  const today = dateKey(new Date());
  const link = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams({ responsavel: agenda.scope.param, visao: agenda.view, ref: String(agenda.offset) });
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    return `/cs/checkpoints?${next.toString()}`;
  };
  const periodLabel = agenda.view === "mes" ? formatDateKey(agenda.start, "MMMM 'de' yyyy") : `${formatDateKey(agenda.start, "dd/MM")} a ${formatDateKey(agenda.end, "dd/MM/yyyy")}`;
  const scheduled = agenda.days.reduce((s, d) => s + d.items.length, 0);

  return (
    <PageContainer>
      <PageHeader
        title="Checkpoints"
        description="Próximas interações da carteira. Registrar um checkpoint atualiza adoção, satisfação, riscos e recalcula a saúde."
        breadcrumbs={[{ label: "Customer Success", href: "/cs" }, { label: "Checkpoints" }]}
        actions={<ScopeSelect owners={agenda.owners} value={agenda.scope.param} />}
      />

      {agenda.overdue.length > 0 ? (
        <Card className="mb-6 border-danger/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-danger-fg">
              <AlertTriangle className="size-4" /> {agenda.overdue.length} checkpoint(s) vencido(s)
            </CardTitle>
            <CardDescription>Clientes com a próxima interação no passado. Registre o contato ou reagende.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 pt-0 sm:grid-cols-2 lg:grid-cols-4">
            {agenda.overdue.map((item) => (
              <AgendaItemCard key={item.clientId} item={item} showDate />
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="icon" aria-label="Período anterior">
            <Link href={link({ ref: agenda.offset - 1 })}>
              <ChevronLeft />
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={link({ ref: 0 })}>Hoje</Link>
          </Button>
          <Button asChild variant="outline" size="icon" aria-label="Próximo período">
            <Link href={link({ ref: agenda.offset + 1 })}>
              <ChevronRight />
            </Link>
          </Button>
          <h2 className="ml-1 text-base font-semibold capitalize">{periodLabel}</h2>
        </div>
        <div className="inline-flex items-center gap-0.5 self-start rounded-lg border border-border bg-surface-muted p-0.5" role="radiogroup" aria-label="Visão">
          {(["semana", "mes"] as const).map((v) => (
            <Link
              key={v}
              href={link({ visao: v, ref: 0 })}
              role="radio"
              aria-checked={agenda.view === v}
              className={cn("inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium", agenda.view === v ? "bg-brand text-white shadow-brand" : "text-muted hover:bg-surface-hover hover:text-foreground")}
            >
              {v === "semana" ? "Semana" : "Mês"}
            </Link>
          ))}
        </div>
      </div>

      {agenda.view === "semana" ? (
        <div className="mb-8 grid gap-3 md:grid-cols-7">
          {agenda.days.map((day) => (
            <section key={day.key} className={cn("flex min-h-[120px] flex-col gap-2 rounded-lg border border-border bg-surface-muted p-2", day.key === today && "border-brand bg-brand-soft/30")} aria-label={formatDateKey(day.key, "EEEE, dd/MM")}>
              <p className={cn("text-xs font-semibold uppercase tracking-wide text-muted", day.key === today && "text-brand-fg")}>{formatDateKey(day.key, "EEE dd/MM")}</p>
              {day.items.length === 0 ? <p className="text-xs text-muted-light">—</p> : day.items.map((item) => <AgendaItemCard key={item.clientId} item={item} />)}
            </section>
          ))}
        </div>
      ) : (
        <Card className="mb-8">
          {scheduled === 0 ? (
            <EmptyState icon={<CalendarCheck />} title="Nenhum checkpoint neste mês" description="Registre checkpoints para agendar a próxima interação de cada cliente." />
          ) : (
            <ol className="divide-y divide-border">
              {agenda.days
                .filter((d) => d.items.length > 0)
                .map((day) => (
                  <li key={day.key} className="grid gap-2 p-3 md:grid-cols-[160px_1fr]">
                    <p className={cn("text-sm font-medium capitalize", day.key === today && "text-brand-fg")}>{formatDateKey(day.key, "EEE, dd 'de' MMM")}</p>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {day.items.map((item) => (
                        <AgendaItemCard key={item.clientId} item={item} />
                      ))}
                    </div>
                  </li>
                ))}
            </ol>
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle title="Sem próxima interação" count={agenda.withoutSchedule.length} description="Clientes da carteira sem checkpoint agendado." />
          <Card>
            {agenda.withoutSchedule.length === 0 ? (
              <EmptyState size="sm" icon={<CalendarX />} title="Todos os clientes têm agenda" />
            ) : (
              <ul className="divide-y divide-border">
                {agenda.withoutSchedule.map((c) => (
                  <li key={c.clientId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/clientes/${c.clientId}?aba=cs`} className="text-sm font-medium hover:underline">
                        {c.tradeName}
                      </Link>
                      <div>
                        <OwnerCell owner={c.owner} />
                      </div>
                    </div>
                    <CheckpointDialog clientId={c.clientId} clientName={c.tradeName} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
        <section>
          <SectionTitle title="Checkpoints recentes" count={agenda.recent.length} description="Registrados nos últimos 30 dias." />
          <Card>
            {agenda.recent.length === 0 ? (
              <EmptyState size="sm" icon={<History />} title="Nenhum checkpoint nos últimos 30 dias" />
            ) : (
              <ul className="divide-y divide-border">
                {agenda.recent.map((e) => (
                  <li key={e.id} className="px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <Link href={`/clientes/${e.clientId}?aba=timeline`} className="text-sm font-medium hover:underline">
                        {e.tradeName}
                      </Link>
                      <span className="shrink-0 text-xs text-muted">{formatDateTime(e.occurredAt)}</span>
                    </div>
                    <p className="text-xs text-muted">{e.title}</p>
                    {e.description ? <p className="mt-0.5 line-clamp-2 text-sm">{e.description.split("\n")[0]}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </PageContainer>
  );
}
