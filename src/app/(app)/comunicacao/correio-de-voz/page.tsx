import type { Metadata } from "next";
import { requireScreen } from "@/server/auth/session";
import { listVoicemails } from "@/server/telephony/queries";
import { getRecordingPolicy } from "@/server/conversations/ops-settings";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { VoicemailView } from "@/components/telephony/calls-view";

export const metadata: Metadata = { title: "Correio de voz" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Correio de voz (catálogo comunicacao.correio): recados das filas da pessoa (ou da equipe/empresa, pelo escopo). */
export default async function VoicemailPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("comunicacao.correio");
  const sp = await searchParams;
  const showHandled = sp.todos === "1";
  const [data, policy] = await Promise.all([listVoicemails(user, { days: 30, showHandled }), getRecordingPolicy()]);
  return (
    <PageContainer>
      <PageHeader title="Correio de voz" description="Recados deixados fora do horário ou quando ninguém atendeu." breadcrumbs={[{ label: "Central de Atendimento", href: "/comunicacao" }, { label: "Correio de voz" }]} />
      <VoicemailView rows={data.rows} pending={data.pending} requireReason={policy.requireReason} showHandled={showHandled} />
    </PageContainer>
  );
}
