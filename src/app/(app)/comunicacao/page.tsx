import type { Metadata } from "next";
import Link from "next/link";
import { History, SlidersHorizontal } from "lucide-react";
import { can, canSeeHref, requireScreen } from "@/server/auth/session";
import { getCentralOverview, getConversationDetail, getTransferOptions, isCentralTab } from "@/server/conversations/queries";
import { distributeWaitingThrottled } from "@/server/conversations/service";
import { usableTemplates } from "@/server/conversations/templates";
import { isConnected } from "@/server/integrations/status";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { CentralWorkspace } from "@/components/conversations/central-workspace";
import { NewConversationDialog } from "@/components/conversations/new-conversation-dialog";

export const metadata: Metadata = { title: "Central de Atendimento" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Central de Atendimento (módulo Comunicação): conversas de WhatsApp e e-mail com filas, responsável, nota interna,
 * SLA e o contexto do cliente. ?ver= aba (minhas | fila | aguardando | todas), ?filaId=, ?canal=, ?q= e ?conversa=.
 * A lista e a conversa respeitam o escopo da tela (catálogo comunicacao.central); a tela se atualiza sozinha.
 */
export default async function CentralPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("comunicacao.central");
  const sp = await searchParams;
  // Distribui a fila ao abrir a Central (no máximo a cada 30 s por instância; barata quando ninguém espera).
  await distributeWaitingThrottled();
  const ver = first(sp.ver);
  const canal = first(sp.canal);
  const [overview, transferOptions, templates] = await Promise.all([
    getCentralOverview(user, {
      tab: isCentralTab(ver) ? ver : undefined,
      queueId: first(sp.filaId) || undefined,
      channel: canal === "whatsapp" || canal === "email" ? canal : undefined,
      q: first(sp.q) || undefined,
    }),
    getTransferOptions(),
    usableTemplates("conversa"),
  ]);
  const chosen = first(sp.conversa);
  const selectedId = chosen ?? overview.rows[0]?.id;
  const detail = selectedId ? await getConversationDetail(user, selectedId) : null;
  const back = new URLSearchParams();
  for (const k of ["ver", "filaId", "canal", "q"]) {
    const v = first(sp[k]);
    if (v) back.set(k, v);
  }

  return (
    <PageContainer size="full" className="lg:pb-4">
      <PageHeader
        title="Central de Atendimento"
        description="WhatsApp e e-mail numa tela só, com filas, nota interna e o contexto do cliente."
        className={chosen && detail ? "hidden lg:flex" : undefined}
        actions={
          <>
            {canSeeHref(user, "/comunicacao/historico") ? (
              <Button asChild variant="outline" className="min-h-[44px] md:min-h-0">
                <Link href="/comunicacao/historico">
                  <History /> Histórico
                </Link>
              </Button>
            ) : null}
            {canSeeHref(user, "/comunicacao/canais") ? (
              <Button asChild variant="outline" className="min-h-[44px] md:min-h-0">
                <Link href="/comunicacao/canais">
                  <SlidersHorizontal /> Canais e filas
                </Link>
              </Button>
            ) : null}
            {can(user, "comunicacao.central.iniciar") ? (
              <NewConversationDialog queues={overview.queues.map((q) => ({ id: q.id, name: q.name }))} whatsappConnected={isConnected("whatsapp")} templates={templates.map((t) => ({ id: t.id, name: t.name, body: t.body }))} />
            ) : null}
          </>
        }
      />
      <CentralWorkspace overview={overview} detail={detail} explicit={Boolean(chosen && detail)} transferOptions={transferOptions} currentUserId={user.id} backHref={`/comunicacao${back.toString() ? `?${back.toString()}` : ""}`} />
    </PageContainer>
  );
}
