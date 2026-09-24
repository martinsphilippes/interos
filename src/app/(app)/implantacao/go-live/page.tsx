import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck, PartyPopper, Rocket } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { listGoLiveCandidates } from "@/server/implementation/queries";
import { canOperateImplementation, readProjectFilters } from "@/server/implementation/schemas";
import { formatDate } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { GoLiveCandidateCard } from "@/components/implementation/go-live-candidates";
import { GoLiveSettingsSwitch } from "@/components/implementation/go-live-settings";
import { ProjectFilterBar } from "@/components/implementation/project-filters";

export const metadata: Metadata = { title: "Go-live" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Projetos prontos para go-live e os que faltam pouco (>= 80%), com o que falta em cada um. */
export default async function GoLivePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "implantacao")) redirect("/meu-dia?erro=sem-permissao");
  const params = await searchParams;
  const filters = readProjectFilters((key) => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  });
  const { ready, almost, recent, scope, settings } = await listGoLiveCandidates(user, filters.scope);
  const canOperate = canOperateImplementation(user);

  return (
    <PageContainer>
      <PageHeader
        title="Go-live"
        description="Gate obrigatório: checklist, tarefas obrigatórias, treinamento realizado, validação interna e aceite do cliente. A aprovação ativa o cliente e faz o handoff para o CS."
        breadcrumbs={[{ label: "Implantação", href: "/implantacao" }, { label: "Go-live" }]}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <ProjectFilterBar owners={[]} products={[]} statuses={[]} scope={scope.kind} canTeam={scope.canTeam} showListFilters={false} />
          <GoLiveSettingsSwitch value={settings.exigeAprovacaoGestor} canEdit={user.isManager} />
        </div>
      </PageHeader>

      <section className="mb-6">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <Rocket className="size-4 text-success" aria-hidden /> Prontos para go-live <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs tabular-nums text-muted">{ready.length}</span>
        </h2>
        {ready.length === 0 ? (
          <Card>
            <EmptyState size="sm" icon={<CalendarCheck />} title="Nenhum projeto pronto" description="Projetos com todas as tarefas obrigatórias concluídas aparecem aqui." />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {ready.map((c) => (
              <GoLiveCandidateCard key={c.row.id} candidate={c} canOperate={canOperate} />
            ))}
          </div>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-base font-semibold">
          Faltam poucos passos (progresso ≥ 80%) <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs tabular-nums text-muted">{almost.length}</span>
        </h2>
        {almost.length === 0 ? (
          <Card>
            <EmptyState size="sm" title="Nenhum projeto perto do go-live" description="Projetos com 80% ou mais das tarefas obrigatórias concluídas aparecem aqui." />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {almost.map((c) => (
              <GoLiveCandidateCard key={c.row.id} candidate={c} canOperate={canOperate} />
            ))}
          </div>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PartyPopper className="size-4 text-success" aria-hidden /> Go-lives dos últimos 30 dias
          </CardTitle>
          <CardDescription>Clientes entregues ao Customer Success.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {recent.length === 0 ? (
            <p className="text-sm text-muted">Nenhum go-live nos últimos 30 dias.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <Link href={`/implantacao/${r.id}?aba=go-live`} className="min-h-[44px] content-center font-medium hover:underline md:min-h-0">
                    {r.clientName}
                  </Link>
                  <span className="text-muted">{formatDate(r.goLiveAt)}</span>
                  <span className={r.onTime ? "text-success-fg" : "text-warning-fg"}>{r.onTime ? "No prazo" : `${r.daysLate}d após o prazo`}</span>
                  {r.activationDays !== undefined ? <span className="text-muted">Ativação em {r.activationDays.toLocaleString("pt-BR")}d</span> : null}
                  <span className="ml-auto text-muted">{r.ownerName}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
