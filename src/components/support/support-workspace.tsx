"use client";

import * as React from "react";
import { Headset } from "lucide-react";
import type { TicketDetail, TicketRow } from "@/server/support/queries";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { useMinuteClock } from "./sla-live";
import { TicketContextPanel } from "./ticket-context-panel";
import type { ChannelStatus } from "./ticket-composer";
import { TicketQueue } from "./ticket-queue";
import { WorkspaceTicket, type WorkspaceTab } from "./workspace-ticket";
import type { QueueTab } from "./workspace-model";

export interface SupportWorkspaceProps {
  rows: TicketRow[];
  detail: TicketDetail | null;
  /** O chamado foi escolhido pelo usuário (?chamado=). Sem isso, no celular a fila é a tela. */
  explicit: boolean;
  queueTitle: string;
  initialTab: QueueTab;
  baseQuery: Record<string, string>;
  channels: ChannelStatus;
  currentUserId: string;
  canOperate: boolean;
  canWriteArticles: boolean;
  articleCategories: string[];
  articleModules: string[];
  /** Instante da renderização no servidor (ms), referência dos relógios até o navegador assumir. */
  renderedAt: number;
}

/**
 * Workspace de 3 colunas da Central de Suporte: fila | chamado (conversa + composer) | contexto do cliente.
 * Abaixo de xl a coluna de contexto vira a aba "Detalhes" do chamado; no celular é uma pilha fila → chamado.
 */
export function SupportWorkspace(props: SupportWorkspaceProps) {
  const { rows, detail, explicit, channels, renderedAt } = props;
  const clock = useMinuteClock();
  const now = clock ?? renderedAt;
  const [tabState, setTabState] = React.useState<{ ticketId?: string; tab: WorkspaceTab }>({ ticketId: detail?.ticket.id, tab: "conversa" });
  // Trocar de chamado volta para a conversa (ajuste de estado durante a renderização, sem efeito).
  const tab: WorkspaceTab = tabState.ticketId === detail?.ticket.id ? tabState.tab : "conversa";
  const setTab = (next: WorkspaceTab) => setTabState({ ticketId: detail?.ticket.id, tab: next });

  const backParams = new URLSearchParams(props.baseQuery);
  if (props.initialTab !== "todos") backParams.set("fila", props.initialTab);
  const backHref = `/suporte${backParams.toString() ? `?${backParams.toString()}` : ""}`;

  return (
    <div
      className={cn(
        "grid gap-4",
        "lg:h-[calc(100dvh-var(--spacing-topbar)-15.5rem)] lg:min-h-[600px] lg:grid-cols-[300px_minmax(0,1fr)]",
        // Abaixo de xl, "Detalhes" empilha o contexto sob o cabeçalho do chamado, na coluna central.
        tab === "detalhes" && detail ? "lg:grid-rows-[auto_minmax(0,1fr)]" : "lg:grid-rows-[minmax(0,1fr)]",
        "xl:grid-cols-[280px_minmax(0,1fr)_300px] xl:grid-rows-[minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)_360px]",
      )}
    >
      <TicketQueue
        rows={rows}
        selectedId={detail?.ticket.id}
        initialTab={props.initialTab}
        baseQuery={props.baseQuery}
        title={props.queueTitle}
        className={cn(tab === "detalhes" && detail && "lg:row-span-2 xl:row-span-1", explicit && detail ? "hidden lg:flex" : "flex")}
      />

      {detail ? (
        <>
          <WorkspaceTicket
            detail={detail}
            channels={channels}
            currentUserId={props.currentUserId}
            canOperate={props.canOperate}
            canWriteArticles={props.canWriteArticles}
            articleCategories={props.articleCategories}
            articleModules={props.articleModules}
            backHref={backHref}
            tab={tab}
            onTabChange={setTab}
            className={explicit ? "flex" : "hidden lg:flex"}
          />
          <TicketContextPanel
            detail={detail}
            channels={channels}
            now={now}
            className={cn(
              "scrollbar-thin min-h-0 lg:col-start-2 lg:overflow-y-auto xl:col-start-3 xl:row-start-1 xl:flex",
              tab === "detalhes" && explicit ? "flex" : tab === "detalhes" ? "hidden lg:flex" : "hidden",
            )}
          />
        </>
      ) : (
        <section className="hidden min-h-0 items-center justify-center rounded-xl border border-border bg-surface shadow-card lg:flex xl:col-span-2">
          <EmptyState icon={<Headset />} title="Nenhum chamado selecionado" description={rows.length === 0 ? "Sua fila está vazia. Novos chamados aparecem aqui." : "Escolha um chamado na fila para ver a conversa e o contexto do cliente."} />
        </section>
      )}
    </div>
  );
}
