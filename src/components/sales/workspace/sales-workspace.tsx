"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Building2, CalendarClock, ChevronRight, MessagesSquare, SearchX, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SlaBadge } from "@/components/ui/sla-badge";
import { formatDateTime, formatDay, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PipelineStage } from "@/server/sales/queries";
import { lossReasonLabel } from "@/server/sales/schemas";
import type { WorkspaceDetail, WorkspaceQueueItem } from "@/server/sales/workspace-queries";
import { isOpenStage } from "../model";
import { StageBadge, ValueLine } from "../opportunity-bits";
import { useSalesUrl } from "../use-sales-url";
import { VisitDrawer } from "../visits-view";
import { ContactLinks, ContextPanel, LocationBlock } from "./context-panel";
import { Composer, ConversationThread } from "./conversation";
import { OpportunityActions, StageSelect } from "./opportunity-actions";
import { WorkspaceQueue } from "./workspace-queue";

const PRIORITY: Record<WorkspaceQueueItem["temperature"], { label: string; variant: "danger" | "warning" | "info" }> = {
  quente: { label: "Alta prioridade", variant: "danger" },
  morno: { label: "Média prioridade", variant: "warning" },
  frio: { label: "Baixa prioridade", variant: "info" },
};

/** Altura das colunas no desktop: cabem na tela abaixo do cabeçalho e dos KPIs. */
const COLUMN_HEIGHT = "lg:h-[max(560px,calc(100dvh-21rem))]";

export interface SalesWorkspaceProps {
  items: WorkspaceQueueItem[];
  stages: PipelineStage[];
  detail: WorkspaceDetail | null;
  selectedId: string | null;
  /** A seleção veio da URL (?oportunidade=). Sem ela, o celular mostra a fila. */
  explicit: boolean;
  queueTitle: string;
  showOwner: boolean;
  currentUserId: string;
  currentUserName: string;
  isManager: boolean;
  visitDetail: React.ComponentProps<typeof VisitDrawer>["detail"];
}

/**
 * Workspace da Central de Vendas: fila "Meu funil" | oportunidade (cabeçalho + conversa + composer) |
 * contexto do cliente. No celular vira pilha: fila → oportunidade → conversa (?tela=conversa).
 */
export function SalesWorkspace({ items, stages, detail, selectedId, explicit, queueTitle, showOwner, currentUserId, currentUserName, isManager, visitDetail }: SalesWorkspaceProps) {
  const { searchParams, href } = useSalesUrl();
  const level: "fila" | "oportunidade" | "conversa" = !explicit ? "fila" : searchParams.get("tela") === "conversa" ? "conversa" : "oportunidade";
  const contactLabel = detail && (detail.client.status === "lead" || detail.client.status === "prospect") ? "Lead" : "Cliente";

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[290px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_320px] 2xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        <WorkspaceQueue items={items} stages={stages} selectedId={selectedId} title={queueTitle} showOwner={showOwner} className={cn(COLUMN_HEIGHT, "max-lg:max-h-[75dvh]", level !== "fila" && "max-lg:hidden")} />

        {detail ? (
          <>
            {/* Celular, nível "oportunidade": resumo com estágio editável, valor, contato, mapa e próxima ação. */}
            <div className={cn("flex flex-col gap-4 lg:hidden", level !== "oportunidade" && "hidden")}>
              <Link href={href({ oportunidade: null, tela: null, visita: null })} className="inline-flex min-h-[44px] items-center gap-1.5 self-start text-sm text-muted hover:text-foreground">
                <ArrowLeft className="size-4" /> {queueTitle}
              </Link>
              <MobileSummary detail={detail} conversationHref={href({ tela: "conversa" })} currentUserId={currentUserId} isManager={isManager} />
            </div>

            <Card className={cn("flex min-w-0 flex-col overflow-hidden", COLUMN_HEIGHT, "max-lg:h-[calc(100dvh-9rem)]", level !== "conversa" && "max-lg:hidden")}>
              <div className="border-b border-border p-3 lg:hidden">
                <Link href={href({ tela: null })} className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-muted hover:text-foreground">
                  <ArrowLeft className="size-4" /> {detail.opportunity.code} · {detail.client.tradeName}
                </Link>
              </div>
              <OpportunityHeader detail={detail} currentUserId={currentUserId} isManager={isManager} className="max-lg:hidden" />
              <ConversationThread items={detail.conversation} currentUserName={currentUserName} contactLabel={contactLabel} />
              <Composer detail={detail} />
            </Card>

            <ContextPanel
              detail={detail}
              hideLocationOnMobile
              className={cn("min-w-0 lg:col-start-2 xl:col-start-auto xl:overflow-y-auto xl:pr-1 xl:scrollbar-thin", "xl:h-[max(560px,calc(100dvh-21rem))]", level !== "oportunidade" && "max-lg:hidden")}
            />
          </>
        ) : (
          <Card className={cn("flex items-center justify-center lg:col-span-1 xl:col-span-2", COLUMN_HEIGHT, level === "fila" && "max-lg:hidden")}>
            {explicit ? (
              <EmptyState icon={<SearchX />} title="Oportunidade não encontrada" description="Ela pode ter sido transferida para outro vendedor ou você não tem acesso a ela." />
            ) : (
              <EmptyState icon={<MessagesSquare />} title="Nenhuma oportunidade no funil" description="Crie uma oportunidade para começar a registrar contatos, propostas e visitas." />
            )}
          </Card>
        )}
      </div>
      <VisitDrawer detail={visitDetail} />
    </>
  );
}

function OpportunityHeader({ detail, currentUserId, isManager, className }: { detail: WorkspaceDetail; currentUserId: string; isManager: boolean; className?: string }) {
  const opp = detail.opportunity;
  const owner = detail.users[opp.ownerId];
  const priority = PRIORITY[opp.temperature];
  const open = isOpenStage(opp.stage);
  return (
    <div className={cn("flex flex-col gap-2 border-b border-border px-4 py-3", className)}>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <p className="shrink-0 text-xl font-bold tabular-nums tracking-tight text-brand-fg">#{opp.code}</p>
          <ValueLine opp={opp} className="min-w-0 truncate text-right text-sm font-semibold text-foreground" />
        </div>
        <h2 className="mt-0.5 truncate text-[15px] font-semibold text-foreground" title={`${detail.client.tradeName} — ${opp.title}`}>
          <Link href={`/clientes/${detail.client.id}`} className="hover:underline">
            {detail.client.tradeName}
          </Link>{" "}
          <span className="font-normal text-muted">— {opp.title}</span>
        </h2>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {open && detail.canEdit ? <StageSelect detail={detail} /> : <StageBadge stage={opp.stage} label={detail.stages.find((s) => s.key === opp.stage)?.label} size="md" />}
        {open ? (
          <Badge variant={priority.variant} size="md">
            {priority.label}
          </Badge>
        ) : null}
        {detail.sla ? <SlaBadge state={detail.sla.view.state} remainingMs={detail.sla.view.remainingMs} /> : null}
        <span className="inline-flex min-w-0 items-center gap-1 text-muted" title="Responsável">
          <UserRound className="size-4 shrink-0" aria-hidden />
          <span className="sr-only">Responsável:</span>
          <span className="truncate text-foreground">{owner?.name ?? "—"}</span>
        </span>
      </div>
      <OpportunityActions detail={detail} currentUserId={currentUserId} isManager={isManager} />
      {opp.stage === "ganho" ? <p className="rounded-md bg-success-soft px-3 py-1.5 text-sm text-success-fg">Ganha em {formatDateTime(opp.wonAt)}. Contrato e comissões gerados; a jornada segue no Financeiro.</p> : null}
      {opp.stage === "perdido" ? (
        <p className="rounded-md bg-danger-soft px-3 py-1.5 text-sm text-danger-fg">
          Perdida em {formatDateTime(opp.lostAt)} · {lossReasonLabel(opp.lossReason)}
          {opp.lossCompetitor ? ` (${opp.lossCompetitor})` : ""}
        </p>
      ) : null}
    </div>
  );
}

/** Resumo da oportunidade no celular (referência "Central de Vendas" do app). */
function MobileSummary({ detail, conversationHref, currentUserId, isManager }: { detail: WorkspaceDetail; conversationHref: string; currentUserId: string; isManager: boolean }) {
  const opp = detail.opportunity;
  const open = isOpenStage(opp.stage);
  const nextAction = detail.nextActions[0];
  const messages = detail.conversation.length;
  return (
    <>
      <Card className="flex flex-col gap-4 p-4">
        <div>
          <p className="label-caps">Oportunidade · #{opp.code}</p>
          <p className="mt-1 flex items-center gap-2 text-lg font-semibold">
            <Building2 className="size-5 shrink-0 text-brand-fg" aria-hidden />
            <span className="truncate">{detail.client.tradeName}</span>
          </p>
          <p className="truncate text-sm text-muted">{opp.title}</p>
        </div>
        <div className="grid gap-1">
          <p className="text-xs text-muted">Estágio</p>
          {open && detail.canEdit ? <StageSelect detail={detail} className="w-full" /> : <StageBadge stage={opp.stage} size="md" />}
        </div>
        <div>
          <p className="text-xs text-muted">Valor</p>
          <ValueLine opp={opp} className="text-xl font-semibold" />
        </div>
        <ContactLinks detail={detail} />
        {detail.location ? (
          <div>
            <p className="mb-1.5 text-xs text-muted">Localização</p>
            <LocationBlock location={detail.location} compact />
          </div>
        ) : null}
        {nextAction ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2">
            <CalendarClock className={cn("size-4 shrink-0", nextAction.overdue ? "text-danger-fg" : "text-muted")} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] text-muted">Próxima ação</span>
              <span className="block truncate text-sm">
                {nextAction.title} · {nextAction.at ? `${formatDay(nextAction.at)}, ${formatTime(nextAction.at)}` : "sem data"}
              </span>
            </span>
          </div>
        ) : null}
        <Button asChild className="min-h-[44px]">
          <Link href={conversationHref}>
            <MessagesSquare /> Conversa e histórico ({messages}) <ChevronRight />
          </Link>
        </Button>
        <OpportunityActions detail={detail} currentUserId={currentUserId} isManager={isManager} />
      </Card>
    </>
  );
}
