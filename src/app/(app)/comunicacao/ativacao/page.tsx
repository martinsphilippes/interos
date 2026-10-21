import type { Metadata } from "next";
import { can, requireScreen } from "@/server/auth/session";
import { getActivationChecklist } from "@/server/conversations/activation";
import { getRecordingPolicy } from "@/server/conversations/ops-settings";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { ActivationView } from "@/components/conversations/activation-view";

export const metadata: Metadata = { title: "Ativação dos canais" };

/** Ativação dos canais (catálogo comunicacao.ativacao): o que falta para ligar cada canal e a política de gravação. */
export default async function ActivationPage() {
  const user = await requireScreen("comunicacao.ativacao");
  const [groups, policy] = await Promise.all([getActivationChecklist(), getRecordingPolicy()]);
  const { stored, ...rest } = policy;
  void stored;
  return (
    <PageContainer>
      <PageHeader title="Ativação dos canais" description="O que está pronto e o que falta para ligar cada canal da Central." breadcrumbs={[{ label: "Central de Atendimento", href: "/comunicacao" }, { label: "Ativação dos canais" }]} />
      <ActivationView groups={groups} policy={rest} canEditPolicy={can(user, "comunicacao.ativacao.gravacao.editar")} />
    </PageContainer>
  );
}
