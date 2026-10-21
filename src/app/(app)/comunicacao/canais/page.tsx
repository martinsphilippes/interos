import type { Metadata } from "next";
import Link from "next/link";
import { can, requireScreen } from "@/server/auth/session";
import { getChannelHealth, getQueuesAdmin } from "@/server/conversations/queries";
import { getIntegration } from "@/server/integrations/status";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ChannelsStatus } from "@/components/conversations/channels-status";
import { QueuesAdminView } from "@/components/conversations/queues-admin";
import { CANAIS_TABS, type CanaisTab } from "@/components/conversations/model";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Canais e filas" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TAB_LABEL: Record<CanaisTab, string> = { canais: "Canais", filas: "Filas e distribuição" };

/**
 * Canais e filas (catálogo comunicacao.canais): ?aba=canais (estado real de cada canal) e ?aba=filas (operadores,
 * distribuição, limite, SLA e transbordo). Cada aba é uma seção do catálogo; a edição exige comunicacao.canais.filas.editar.
 */
export default async function ChannelsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("comunicacao.canais");
  const sp = await searchParams;
  const allowed: Record<CanaisTab, boolean> = { canais: can(user, "comunicacao.canais.canais.ver"), filas: can(user, "comunicacao.canais.filas.ver") };
  const visible = CANAIS_TABS.filter((t) => allowed[t]);
  const asked = Array.isArray(sp.aba) ? sp.aba[0] : sp.aba;
  const tab: CanaisTab | undefined = visible.find((t) => t === asked) ?? visible[0];

  return (
    <PageContainer>
      <PageHeader title="Canais e filas" description="Estado real de cada canal e as filas da Central de Atendimento." breadcrumbs={[{ label: "Central de Atendimento", href: "/comunicacao" }, { label: "Canais e filas" }]} />
      {!tab ? (
        <EmptyState title="Sem acesso às seções" description="Seu perfil não inclui o estado dos canais nem as filas." />
      ) : (
        <>
          <nav role="tablist" aria-label="Seções" className="mb-5 flex gap-1 border-b border-border">
            {visible.map((t) => (
              <Link
                key={t}
                role="tab"
                aria-selected={tab === t}
                href={`/comunicacao/canais?aba=${t}`}
                className={cn("-mb-px inline-flex min-h-[44px] items-center border-b-2 px-3 text-sm font-medium transition-colors", tab === t ? "border-brand text-brand-fg" : "border-transparent text-muted hover:text-foreground")}
              >
                {TAB_LABEL[t]}
              </Link>
            ))}
          </nav>
          {tab === "canais" ? (
            <ChannelsStatus whatsapp={getIntegration("whatsapp")} email={getIntegration("email")} voip={getIntegration("voip")} health={await getChannelHealth()} webhookSecured={Boolean(process.env.WHATSAPP_APP_SECRET)} />
          ) : (
            <QueuesAdminView data={await getQueuesAdmin()} canEdit={can(user, "comunicacao.canais.filas.editar")} />
          )}
        </>
      )}
    </PageContainer>
  );
}
