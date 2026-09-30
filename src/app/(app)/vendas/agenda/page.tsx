import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { canSeeHref, requireScreen } from "@/server/auth/session";
import { salesCapabilities } from "@/server/sales/access";
import { getAgenda, getSalesFormOptions, hasTeamView, listClientAddresses, listOpenOpportunitiesByClient, todayKey, type AgendaView as AgendaViewKind } from "@/server/sales/queries";
import { formatDateKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { AGENDA_KIND_LABELS, AgendaView } from "@/components/sales/agenda-view";
import { SalesAccessProvider } from "@/components/sales/sales-access";
import { NewVisitButton } from "@/components/sales/visit-form-dialog";

export const metadata: Metadata = { title: "Agenda comercial" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function shift(key: string, view: AgendaViewKind, dir: 1 | -1): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = view === "semana" ? new Date(Date.UTC(y, m - 1, d + 7 * dir)) : new Date(Date.UTC(y, m - 1 + dir, 1));
  return date.toISOString().slice(0, 10);
}

/**
 * Agenda: visitas, tarefas com prazo e follow-ups (próxima ação) do vendedor ou da equipe. Tela vendas.agenda: a
 * visão "Equipe" é o escopo efetivo da tela (aparece quando ele é maior que "meus"); "Agendar visita" conforme as
 * chaves de vendas.visitas.
 */
export default async function AgendaPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("vendas.agenda");
  const sp = await searchParams;
  const caps = salesCapabilities(user);
  const view: AgendaViewKind = first(sp.visao) === "mes" ? "mes" : "semana";
  const rawDate = first(sp.data);
  const today = todayKey();
  const anchor = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : today;
  const escopo = first(sp.escopo);
  const canCreateVisit = caps.visits.create;
  const [agenda, teamView, options, addresses, opportunitiesByClient] = await Promise.all([
    getAgenda(user, { view, anchor, escopo }),
    hasTeamView(user, "vendas.agenda"),
    canCreateVisit ? getSalesFormOptions() : Promise.resolve(null),
    canCreateVisit ? listClientAddresses() : Promise.resolve({}),
    canCreateVisit ? listOpenOpportunitiesByClient(user) : Promise.resolve({}),
  ]);
  // Itens cuja tela de destino o usuário não vê (tarefas, visitas, Central) aparecem sem link.
  const data = { ...agenda, items: agenda.items.map((i) => (canSeeHref(user, i.href) ? i : { ...i, href: "" })) };

  const link = (patch: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    const merged = { visao: view === "mes" ? "mes" : undefined, data: rawDate, escopo: data.scope.kind === "equipe" ? "equipe" : undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
    const s = qs.toString();
    return s ? `/vendas/agenda?${s}` : "/vendas/agenda";
  };
  const title = view === "semana" ? `${formatDateKey(data.start, "dd MMM")} – ${formatDateKey(data.end, "dd MMM yyyy")}` : formatDateKey(`${anchor.slice(0, 7)}-01`, "MMMM 'de' yyyy");
  const counts = { visita: 0, tarefa: 0, followup: 0 };
  for (const i of data.items) counts[i.kind] += 1;
  const pill = (active: boolean) => cn("inline-flex h-10 items-center rounded-md px-3 text-[13px] font-medium md:h-8", active ? "bg-brand text-white shadow-brand" : "text-muted hover:bg-surface-hover hover:text-foreground");

  return (
    <SalesAccessProvider value={caps}>
      <PageContainer size="full">
        <PageHeader
          title="Agenda comercial"
          description={`${data.scope.label} · ${(Object.keys(counts) as (keyof typeof counts)[]).map((k) => `${counts[k]} ${AGENDA_KIND_LABELS[k].toLowerCase()}${counts[k] === 1 ? "" : "s"}`).join(" · ")}`}
          breadcrumbs={[{ label: "Vendas", href: "/vendas" }, { label: "Agenda" }]}
          actions={options ? <NewVisitButton options={{ clients: options.clients, sellers: options.sellers, addresses, opportunitiesByClient }} currentUserId={user.id} canChooseSeller={caps.visits.assign} /> : undefined}
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-muted p-0.5" role="radiogroup" aria-label="Visão">
              <Link href={link({ visao: undefined })} role="radio" aria-checked={view === "semana"} className={pill(view === "semana")}>
                Semana
              </Link>
              <Link href={link({ visao: "mes" })} role="radio" aria-checked={view === "mes"} className={pill(view === "mes")}>
                Mês
              </Link>
            </div>
            {teamView ? (
              <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-muted p-0.5" role="radiogroup" aria-label="Escopo">
                <Link href={link({ escopo: undefined })} role="radio" aria-checked={data.scope.kind === "meu"} className={pill(data.scope.kind === "meu")}>
                  Minha
                </Link>
                <Link href={link({ escopo: "equipe" })} role="radio" aria-checked={data.scope.kind === "equipe"} className={pill(data.scope.kind === "equipe")}>
                  Equipe
                </Link>
              </div>
            ) : null}
            <div className="flex items-center gap-1 md:ml-auto">
              <Button variant="outline" size="icon" asChild className="size-10 md:size-9">
                <Link href={link({ data: shift(anchor, view, -1) })} aria-label="Período anterior">
                  <ChevronLeft />
                </Link>
              </Button>
              <Button variant="outline" asChild className="h-10 md:h-9">
                <Link href={link({ data: undefined })}>Hoje</Link>
              </Button>
              <Button variant="outline" size="icon" asChild className="size-10 md:size-9">
                <Link href={link({ data: shift(anchor, view, 1) })} aria-label="Próximo período">
                  <ChevronRight />
                </Link>
              </Button>
              <span className="ml-2 text-sm font-semibold capitalize">{title}</span>
            </div>
          </div>
        </PageHeader>
        <AgendaView data={data} today={today} />
      </PageContainer>
    </SalesAccessProvider>
  );
}
