import type { Metadata } from "next";
import Link from "next/link";
import { History, SlidersHorizontal } from "lucide-react";
import { can, canSeeHref, requireScreen } from "@/server/auth/session";
import { getCentralOverview, getConversationDetail, getTransferOptions, isCentralTab } from "@/server/conversations/queries";
import { distributeWaitingThrottled } from "@/server/conversations/service";
import { getTeamNow } from "@/server/conversations/supervision";
import { usableTemplates } from "@/server/conversations/templates";
import { isConnected } from "@/server/integrations/status";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { CentralWorkspace } from "@/components/conversations/central-workspace";
import { NewConversationDialog } from "@/components/conversations/new-conversation-dialog";
import { CONVERSATION_CHANNELS } from "@/domain/types";
import { FocusModeButton, FocusModeScope, HideInFocus } from "@/components/layout/focus-mode";

export const metadata: Metadata = { title: "Central de Atendimento" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Central de Atendimento (módulo Comunicação): conversas de WhatsApp e e-mail com filas, responsável, nota interna,
 * SLA e o contexto do cliente. ?ver= aba (minhas | fila | aguardando | todas), ?filaId=, ?canal=, ?q= e ?conversa=.
 * ?painel=equipe (quem distribui): a coluna da esquerda mostra a equipe, o estado e as conversas de cada atendente.
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
      channel: CONVERSATION_CHANNELS.find((c) => c === canal),
      q: first(sp.q) || undefined,
    }),
    getTransferOptions(),
    usableTemplates("conversa"),
  ]);
  // Gestor: aba Equipe (?painel=equipe) com os atendentes e o que cada um atende.
  const teamEnabled = can(user, "comunicacao.central.distribuir");
  const teamNow = teamEnabled && first(sp.painel) === "equipe" ? await getTeamNow(user, "comunicacao.central") : null;
  const team = teamNow
    ? { operators: teamNow.operators, queues: teamNow.queues, bottlenecks: teamNow.bottlenecks, waiting: teamNow.waiting.length, oldestWaitingSince: teamNow.waiting.map((c) => c.queuedAt ?? c.openedAt).sort()[0] }
    : null;
  const chosen = first(sp.conversa);
  const selectedId = chosen ?? (team ? team.operators.flatMap((o) => o.conversations)[0]?.id : undefined) ?? overview.rows[0]?.id;
  const detail = selectedId ? await getConversationDetail(user, selectedId) : null;
  const back = new URLSearchParams();
  for (const k of ["ver", "filaId", "canal", "q", "painel"]) {
    const v = first(sp[k]);
    if (v) back.set(k, v);
  }

  return (
    <PageContainer size="full" className="lg:pb-4">
      <FocusModeScope />
      <HideInFocus>
      <PageHeader
        title="Central de Atendimento"
        description="Todos os canais numa tela só, com filas e o contexto do cliente."
        className={chosen && detail ? "hidden lg:flex" : undefined}
        actions={
          <>
            <FocusModeButton className="min-h-0" />
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
      </HideInFocus>
      <CentralWorkspace overview={overview} detail={detail} explicit={Boolean(chosen && detail)} transferOptions={transferOptions} currentUserId={user.id} teamEnabled={teamEnabled} team={team} backHref={`/comunicacao${back.toString() ? `?${back.toString()}` : ""}`} />
    </PageContainer>
  );
}
