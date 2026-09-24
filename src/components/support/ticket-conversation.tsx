"use client";

import * as React from "react";
import type { TicketDetail } from "@/server/support/queries";
import { ConversationThread } from "./conversation-thread";
import { TicketComposer, type ChannelStatus } from "./ticket-composer";

/**
 * Conversa do chamado + composer (página completa do chamado). Usa os mesmos componentes do workspace da
 * Central: ConversationThread e TicketComposer (registro manual quando o canal não está conectado).
 */
export function TicketConversation({ detail, canOperate, channels }: { detail: TicketDetail; canOperate: boolean; channels: ChannelStatus }) {
  const endRef = React.useRef<HTMLDivElement>(null);
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-surface p-4 shadow-card md:p-5">
        <ConversationThread detail={detail} />
        <div ref={endRef} />
      </div>
      {canOperate ? (
        <div className="sticky bottom-[calc(var(--spacing-mobile-nav)+env(safe-area-inset-bottom)+8px)] z-10 rounded-xl border border-border bg-surface p-3 shadow-pop md:bottom-3">
          <TicketComposer detail={detail} channels={channels} onSent={() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })} />
        </div>
      ) : null}
    </div>
  );
}
