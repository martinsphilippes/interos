import type { Metadata } from "next";
import { can, requireScreen } from "@/server/auth/session";
import { listCalls } from "@/server/telephony/queries";
import { getRecordingPolicy } from "@/server/conversations/ops-settings";
import { twilioConfigured } from "@/server/integrations/twilio";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { CallsView } from "@/components/telephony/calls-view";

export const metadata: Metadata = { title: "Ligações" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Histórico de ligações (catálogo comunicacao.ligacoes): ?ver=todas|perdidas|minhas, ?direcao=, ?dias=. */
export default async function CallsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("comunicacao.ligacoes");
  const sp = await searchParams;
  const ver = first(sp.ver);
  const dir = first(sp.direcao);
  const days = [1, 7, 30, 90].includes(Number(first(sp.dias))) ? Number(first(sp.dias)) : 30;
  const [data, policy] = await Promise.all([
    listCalls(user, { days, view: ver === "perdidas" || ver === "minhas" ? ver : "todas", direction: dir === "entrada" || dir === "saida" ? dir : undefined }),
    getRecordingPolicy(),
  ]);
  return (
    <PageContainer size="full">
      <PageHeader title="Ligações" description={data.scopeKind === "empresa" ? "Todas as ligações feitas e recebidas." : data.scopeKind === "equipe" ? "Ligações da sua equipe e as perdidas das suas filas." : "Suas ligações e as perdidas das suas filas."} breadcrumbs={[{ label: "Central de Atendimento", href: "/comunicacao" }, { label: "Ligações" }]} />
      <CallsView rows={data.rows} pendingCallbacks={data.pendingCallbacks} requireReason={policy.requireReason} days={days} softphone={twilioConfigured() && can(user, "comunicacao.ligacoes.ligar")} />
    </PageContainer>
  );
}
