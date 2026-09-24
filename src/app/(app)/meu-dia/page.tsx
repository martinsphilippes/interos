import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getMeuDia } from "@/server/meu-dia/queries";
import { PageContainer } from "@/components/layout/page-container";
import { MeuDiaHeader } from "@/components/meu-dia/meu-dia-header";
import { PrioritiesList } from "@/components/meu-dia/priorities-list";
import { AgendaBlock, AttentionClientsBlock, FollowupsBlock, GoalsBlock, NotificationsBlock, StepsBlock, TeamBlock } from "@/components/meu-dia/blocks";
import { parsePriorityFilter } from "@/components/meu-dia/model";

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
  const user = await requireUser();
  const sp = await searchParams;
  const scope = first(sp.escopo) === "equipe" ? "equipe" : "eu";
  const filter = parsePriorityFilter(first(sp.filtro));
  const deniedAccess = first(sp.erro) === "sem-permissao";
  const data = await getMeuDia(user, scope);
  const team = data.scope === "equipe";

  return (
    <PageContainer>
      {deniedAccess ? (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-fg">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Seu perfil não tem acesso ao módulo solicitado. Você foi trazido de volta ao Meu Dia.</span>
        </div>
      ) : null}

      <MeuDiaHeader data={data} filter={filter} />

      <PrioritiesList items={data.priorities} filter={filter} scope={data.scope} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 [&>*]:min-w-0">
        {team ? <TeamBlock members={data.team} /> : null}
        <AgendaBlock items={data.agenda} />
        <FollowupsBlock items={data.followups} />
        <StepsBlock items={data.steps} team={team} />
        <AttentionClientsBlock items={data.attentionClients} total={data.stats.clientsAttention} />
        <GoalsBlock items={data.goals} />
        <NotificationsBlock items={data.notifications} unreadTotal={data.stats.unreadNotifications} />
      </div>
    </PageContainer>
  );
}
