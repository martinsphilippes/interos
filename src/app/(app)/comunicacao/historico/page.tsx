import type { Metadata } from "next";
import { can, requireScreen } from "@/server/auth/session";
import { getHistory, getHistoryPreview, type HistoryFilters } from "@/server/conversations/history";
import { CONVERSATION_CLOSE_REASONS, type ConversationCloseReason } from "@/domain/types";
import { historyDays } from "@/domain/conversation-history";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { HistoryView } from "@/components/conversations/history-view";
import { CONVERSATION_CHANNELS } from "@/domain/types";

export const metadata: Metadata = { title: "Histórico de atendimentos" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Histórico de atendimentos (catálogo comunicacao.historico): conversas encerradas no escopo da pessoa. Filtros pela
 * URL (?q=, ?canal=, ?filaId=, ?operador=, ?motivo=, ?sla=, ?dias=) e prévia da conversa escolhida (?ver=).
 */
export default async function HistoryPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("comunicacao.historico");
  const sp = await searchParams;
  const canal = first(sp.canal);
  const motivo = first(sp.motivo);
  const sla = first(sp.sla);
  const filters: HistoryFilters = {
    q: first(sp.q)?.trim() || undefined,
    channel: CONVERSATION_CHANNELS.find((c) => c === canal),
    queueId: first(sp.filaId) || undefined,
    assigneeId: first(sp.operador) || undefined,
    reason: (CONVERSATION_CLOSE_REASONS as readonly string[]).includes(motivo ?? "") ? (motivo as ConversationCloseReason) : undefined,
    sla: sla === "dentro" || sla === "estourado" ? sla : undefined,
    days: historyDays(first(sp.dias)),
  };
  const data = await getHistory(user, filters);
  const selectedId = first(sp.ver) ?? data.rows[0]?.id;
  const preview = selectedId ? await getHistoryPreview(user, selectedId, data.rows.find((r) => r.id === selectedId)) : null;

  return (
    <PageContainer size="full">
      <PageHeader
        title="Histórico de atendimentos"
        description={
          data.scopeKind === "empresa" ? "Todas as conversas encerradas, de qualquer canal." : data.scopeKind === "equipe" ? "Conversas encerradas da sua equipe, de qualquer canal." : "As conversas que você atendeu, de qualquer canal."
        }
        breadcrumbs={[{ label: "Central de Atendimento", href: "/comunicacao" }, { label: "Histórico" }]}
      />
      <HistoryView data={data} filters={filters} preview={preview} canExport={can(user, "comunicacao.historico.exportar")} />
    </PageContainer>
  );
}
