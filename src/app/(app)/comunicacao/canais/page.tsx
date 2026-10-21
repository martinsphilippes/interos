import type { Metadata } from "next";
import Link from "next/link";
import { can, requireScreen } from "@/server/auth/session";
import { getAutoMessagesAdmin, getChannelEventsAdmin, getChannelHealth, getQueuesAdmin, getQuickRepliesAdmin, getTemplatesAdmin } from "@/server/conversations/queries";
import { getIntegration } from "@/server/integrations/status";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ChannelsStatus } from "@/components/conversations/channels-status";
import { QueuesAdminView } from "@/components/conversations/queues-admin";
import { TemplatesAdminView } from "@/components/conversations/templates-admin";
import { QuickRepliesAdminView } from "@/components/conversations/quick-replies-admin";
import { AutoMessagesAdminView } from "@/components/conversations/auto-messages-admin";
import { ChannelEventsLog } from "@/components/conversations/channel-events-log";
import type { ChannelEventResult, ConversationChannel } from "@/domain/types";
import { CANAIS_TABS, type CanaisTab } from "@/components/conversations/model";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Canais e filas" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TAB_LABEL: Record<CanaisTab, string> = {
  canais: "Canais",
  filas: "Filas e distribuição",
  modelos: "Modelos do WhatsApp",
  respostas: "Respostas rápidas",
  automaticas: "Mensagens automáticas",
  registros: "Registros técnicos",
};

const EVENT_RESULTS: readonly ChannelEventResult[] = ["processado", "duplicado", "ignorado", "falha", "recusado"];

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Canais e filas (catálogo comunicacao.canais). Abas (?aba=): canais (estado real de cada canal), filas (operadores,
 * distribuição, limite, SLA e transbordo), modelos (WhatsApp/Meta), respostas (rápidas), automaticas e registros
 * (técnicos, 30 dias). Cada aba é uma seção do catálogo; cada edição tem a sua chave (comunicacao.canais.<aba>.editar).
 */
export default async function ChannelsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("comunicacao.canais");
  const sp = await searchParams;
  const allowed: Record<CanaisTab, boolean> = {
    canais: can(user, "comunicacao.canais.canais.ver"),
    filas: can(user, "comunicacao.canais.filas.ver"),
    modelos: can(user, "comunicacao.canais.modelos.ver"),
    respostas: can(user, "comunicacao.canais.respostas.ver"),
    automaticas: can(user, "comunicacao.canais.automaticas.ver"),
    registros: can(user, "comunicacao.canais.registros.ver"),
  };
  const visible = CANAIS_TABS.filter((t) => allowed[t]);
  const asked = first(sp.aba);
  const tab: CanaisTab | undefined = visible.find((t) => t === asked) ?? visible[0];

  return (
    <PageContainer>
      <PageHeader title="Canais e filas" description="Estado real de cada canal e as filas da Central de Atendimento." breadcrumbs={[{ label: "Central de Atendimento", href: "/comunicacao" }, { label: "Canais e filas" }]} />
      {!tab ? (
        <EmptyState title="Sem acesso às seções" description="Seu perfil não inclui o estado dos canais nem as filas." />
      ) : (
        <>
          <nav role="tablist" aria-label="Seções" className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
            {visible.map((t) => (
              <Link
                key={t}
                role="tab"
                aria-selected={tab === t}
                href={`/comunicacao/canais?aba=${t}`}
                className={cn("-mb-px inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors", tab === t ? "border-brand text-brand-fg" : "border-transparent text-muted hover:text-foreground")}
              >
                {TAB_LABEL[t]}
              </Link>
            ))}
          </nav>
          {tab === "canais" ? (
            <ChannelsStatus whatsapp={getIntegration("whatsapp")} email={getIntegration("email")} voip={getIntegration("voip")} health={await getChannelHealth()} webhookSecured={Boolean(process.env.WHATSAPP_APP_SECRET)} />
          ) : tab === "filas" ? (
            <QueuesAdminView data={await getQueuesAdmin()} canEdit={can(user, "comunicacao.canais.filas.editar")} />
          ) : tab === "modelos" ? (
            <TemplatesAdminView data={await getTemplatesAdmin()} canEdit={can(user, "comunicacao.canais.modelos.editar")} />
          ) : tab === "respostas" ? (
            <QuickRepliesAdminView data={await getQuickRepliesAdmin()} canEdit={can(user, "comunicacao.canais.respostas.editar")} />
          ) : tab === "automaticas" ? (
            <AutoMessagesAdminView data={await getAutoMessagesAdmin()} canEdit={can(user, "comunicacao.canais.automaticas.editar")} />
          ) : (
            <ChannelEventsLog
              data={await getChannelEventsAdmin({
                channel: (["whatsapp", "email"] as ConversationChannel[]).find((c) => c === first(sp.canal)),
                result: EVENT_RESULTS.find((r) => r === first(sp.resultado)),
                q: first(sp.q),
              })}
            />
          )}
        </>
      )}
    </PageContainer>
  );
}
