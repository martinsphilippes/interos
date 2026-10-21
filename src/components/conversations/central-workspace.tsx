"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import type { CentralOverview, ConversationDetail } from "@/server/conversations/queries";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { ConversationContext } from "./conversation-context";
import { ConversationList } from "./conversation-list";
import { ConversationPanel } from "./conversation-panel";
import type { TransferOptions } from "./transfer-dialog";

/** Intervalo da atualização automática (fase 1: sem tempo real; a tela busca de novo só com a aba visível). */
const REFRESH_MS = 15_000;

function useNow(initial: number): number {
  const [now, setNow] = React.useState(initial);
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Atualiza os dados do servidor a cada poucos segundos, só com a aba visível (o que está sendo digitado não se perde). */
function useAutoRefresh() {
  const router = useRouter();
  React.useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const t = setInterval(tick, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);
}

export interface CentralWorkspaceProps {
  overview: CentralOverview;
  detail: ConversationDetail | null;
  /** A conversa foi escolhida (?conversa=): no celular, a conversa é a tela. */
  explicit: boolean;
  transferOptions: TransferOptions;
  currentUserId: string;
  backHref: string;
}

/**
 * Central do Operador em 3 colunas: conversas | conversa aberta | contexto do cliente. Abaixo de xl o contexto vira a
 * aba «Cliente» da conversa; no celular é uma pilha lista → conversa.
 */
export function CentralWorkspace({ overview, detail, explicit, transferOptions, currentUserId, backHref }: CentralWorkspaceProps) {
  const now = useNow(overview.generatedAt);
  useAutoRefresh();
  return (
    <div className={cn("grid gap-4", "lg:h-[calc(100dvh-var(--spacing-topbar)-9rem)] lg:min-h-[600px] lg:grid-cols-[320px_minmax(0,1fr)]", "xl:grid-cols-[300px_minmax(0,1fr)_320px] 2xl:grid-cols-[340px_minmax(0,1fr)_360px]")}>
      <ConversationList overview={overview} selectedId={detail?.conversation.id} now={now} className={explicit && detail ? "hidden lg:flex" : "flex"} />
      {detail ? (
        <>
          <ConversationPanel detail={detail} transferOptions={transferOptions} currentUserId={currentUserId} now={now} backHref={backHref} showContextTab className={explicit ? "flex" : "hidden lg:flex"} />
          <ConversationContext detail={detail} className="scrollbar-thin hidden min-h-0 overflow-y-auto xl:flex" />
        </>
      ) : (
        <section className="hidden min-h-0 items-center justify-center rounded-xl border border-border bg-surface shadow-card lg:flex xl:col-span-2">
          <EmptyState icon={<MessagesSquare />} title="Nenhuma conversa aberta" description={overview.rows.length === 0 ? "Quando um cliente escrever, a conversa aparece na lista." : "Escolha uma conversa na lista para ver as mensagens e o contexto do cliente."} />
        </section>
      )}
    </div>
  );
}
