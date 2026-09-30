import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { can, requireScreen } from "@/server/auth/session";
import { getMeuDia } from "@/server/meu-dia/queries";
import { PageContainer } from "@/components/layout/page-container";
import { MeuDiaHeader } from "@/components/meu-dia/meu-dia-header";
import { PrioritiesList } from "@/components/meu-dia/priorities-list";
import { AgendaBlock, AttentionClientsBlock, AwaitingBlock, ContractsBlock, FinanceBlock, FollowupsBlock, GoalsBlock, NotificationsBlock, StepsBlock, TeamBlock } from "@/components/meu-dia/blocks";
import { parsePriorityFilter } from "@/components/meu-dia/model";
import { InsightsBlock } from "@/components/meu-dia/insights-block";
import { getTopInsightsForUser } from "@/server/insights/engine";
import { after } from "next/server";
import { runDueSweeps } from "@/server/automations/lazy";

export const metadata: Metadata = { title: "Meu Dia" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Meu Dia: a tela operacional principal. Responde "o que eu preciso fazer agora?" com uma lista
 * unificada de prioridades e blocos de apoio. ?escopo=equipe (gestores) agrega a equipe;
 * ?filtro= recorta a lista de prioridades (usado pelos StatCards).
 */
export default async function MeuDiaPage({ searchParams }: { searchParams: SearchParams }) {
  // Tela protegida (inicio.meu-dia.ver não pode ser negada: é o destino dos redirects de acesso negado).
  const user = await requireScreen("inicio.meu-dia");
  const sp = await searchParams;
  const scope = first(sp.escopo) === "equipe" ? "equipe" : "eu";
  const filter = parsePriorityFilter(first(sp.filtro));
  const deniedAccess = first(sp.erro) === "sem-permissao";
  // Alertas de gestão (gargalos detectados pelas regras de insights): seção própria (padrão: gestores e diretoria).
  const showInsights = can(user, "inicio.meu-dia.insights.ver");
  // Varreduras operacionais vencidas (SLA, leads sem contato, implantações atrasadas, tarefas recorrentes, resumo de
  // oportunidades paradas e o circuito financeiro: cobranças vencidas, contratos parados e comissões) rodam depois
  // da resposta: o Meu Dia é a tela mais aberta do dia.
  after(() => runDueSweeps(["sla_alerts", "leads_sem_contato_24h", "implantacoes_atrasadas", "tarefas_recorrentes", "oportunidades_paradas", "cobrancas_vencidas", "contratos_alertas", "comissoes"]));
  const [data, insights] = await Promise.all([getMeuDia(user, scope), showInsights ? getTopInsightsForUser(user).catch(() => []) : Promise.resolve([])]);
  const team = data.scope === "equipe";
  // Blocos por seção (catálogo inicio.meu-dia.<secao>.ver): seção negada não aparece (os dados nem são carregados).
  const show = data.sections;

  return (
    <PageContainer>
      {deniedAccess ? (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-fg">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Seu perfil não tem acesso ao módulo solicitado. Você foi trazido de volta ao Meu Dia.</span>
        </div>
      ) : null}

      <MeuDiaHeader data={data} filter={filter} />

      {show.prioridades ? <PrioritiesList items={data.priorities} filter={filter} scope={data.scope} /> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 [&>*]:min-w-0">
        {showInsights ? <InsightsBlock insights={insights} director={user.isDirector} /> : null}
        {team && show.equipe ? <TeamBlock members={data.team} /> : null}
        {show.agenda ? <AgendaBlock items={data.agenda} upcomingVisits={data.upcomingVisits} /> : null}
        {show.aguardando ? <AwaitingBlock items={data.awaiting} /> : null}
        {show.followups ? <FollowupsBlock items={data.followups} /> : null}
        <FinanceBlock digest={data.finance} />
        {show.contratos ? <ContractsBlock items={data.contracts} /> : null}
        {show.etapas ? <StepsBlock items={data.steps} team={team} /> : null}
        {show.clientesAtencao ? <AttentionClientsBlock items={data.attentionClients} total={data.stats.clientsAttention} /> : null}
        {show.metas ? <GoalsBlock items={data.goals} /> : null}
        {show.notificacoes ? <NotificationsBlock items={data.notifications} unreadTotal={data.stats.unreadNotifications} canEdit={can(user, "inicio.notificacoes.editar")} canDelete={can(user, "inicio.notificacoes.excluir")} /> : null}
      </div>
    </PageContainer>
  );
}
