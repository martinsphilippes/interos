import type { Metadata } from "next";
import Link from "next/link";
import { can, requireScreen } from "@/server/auth/session";
import {
  getCommandCenter,
  getMonitoredConversation,
  getSupervisionLog,
} from "@/server/conversations/supervision";
import { listQueues } from "@/server/conversations/queues";
import { liveCalls } from "@/server/telephony/monitor";
import { twilioConfigured } from "@/server/integrations/twilio";
import { LiveCallsPanel } from "@/components/telephony/live-calls";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { CommandCenterView } from "@/components/conversations/command-center";
import { SupervisionLogView } from "@/components/conversations/supervision-log";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Central de Comando" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v;
const TABS = [
  {
    key: "painel",
    label: "Painel ao vivo",
    section: "comunicacao.supervisao.painel.ver",
  },
  {
    key: "registro",
    label: "Registro de supervisão",
    section: "comunicacao.supervisao.registro.ver",
  },
] as const;

/**
 * Central de Comando (catálogo comunicacao.supervisao): ?aba=painel (ao vivo; ?filaId=, ?acompanhar=<conversa>) e
 * ?aba=registro (?supervisor=, ?dias=). Escopo da tela: as pessoas que o gerente lidera; a direção vê a empresa.
 */
export default async function SupervisionPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireScreen("comunicacao.supervisao");
  const sp = await searchParams;
  const visible = TABS.filter((t) => can(user, t.section));
  const asked = first(sp.aba);
  const tab = visible.find((t) => t.key === asked) ?? visible[0];

  let content: React.ReactNode = null;
  if (tab?.key === "painel") {
    const queueId = first(sp.filaId) || undefined;
    const acompanhar = first(sp.acompanhar);
    const telephony = twilioConfigured();
    const [data, queues, monitored, calls] = await Promise.all([
      getCommandCenter(user, { queueId }),
      listQueues(),
      acompanhar && can(user, "comunicacao.supervisao.acompanhar")
        ? getMonitoredConversation(user, acompanhar)
        : Promise.resolve(null),
      telephony ? liveCalls(user) : Promise.resolve([]),
    ]);
    content = (
      <div className="flex flex-col gap-4">
        <CommandCenterView
          data={data}
          monitored={monitored}
          queues={queues
            .filter((q) => q.active)
            .map((q) => ({ id: q.id, name: q.name }))}
          caps={{
            monitor: can(user, "comunicacao.supervisao.acompanhar"),
            whisper: can(user, "comunicacao.supervisao.sussurrar"),
            assume: can(user, "comunicacao.supervisao.assumir"),
            escalate: can(user, "comunicacao.supervisao.escalar"),
          }}
        />
        {telephony ? (
          <LiveCallsPanel
            rows={calls}
            canMonitor={can(user, "comunicacao.supervisao.ligacoes")}
            softphone={can(user, "comunicacao.ligacoes.ligar")}
          />
        ) : null}
      </div>
    );
  } else if (tab?.key === "registro") {
    const days = [1, 7, 30, 90].includes(Number(first(sp.dias)))
      ? Number(first(sp.dias))
      : 7;
    const log = await getSupervisionLog(user, {
      days,
      supervisorId: first(sp.supervisor) || undefined,
    });
    content = (
      <SupervisionLogView
        rows={log.rows}
        supervisors={log.supervisors}
        days={days}
      />
    );
  }

  return (
    <PageContainer size="full">
      <PageHeader
        title="Central de Comando"
        description="Operadores, filas, atendimentos e ligações ao vivo, com acompanhamento e sussurro."
        breadcrumbs={[
          { label: "Central de Atendimento", href: "/comunicacao" },
          { label: "Central de Comando" },
        ]}
      />
      {!tab ? (
        <EmptyState
          title="Sem acesso às seções"
          description="Seu perfil não inclui o painel nem o registro de supervisão."
        />
      ) : (
        <>
          <nav
            role="tablist"
            aria-label="Seções"
            className="mb-5 flex gap-1 overflow-x-auto border-b border-border"
          >
            {visible.map((t) => (
              <Link
                key={t.key}
                role="tab"
                aria-selected={tab.key === t.key}
                href={`/comunicacao/supervisao?aba=${t.key}`}
                className={cn(
                  "-mb-px inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors",
                  tab.key === t.key
                    ? "border-brand text-brand-fg"
                    : "border-transparent text-muted hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          {content}
        </>
      )}
    </PageContainer>
  );
}
