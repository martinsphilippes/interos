import type { Metadata } from "next";
import { can, requireScreen } from "@/server/auth/session";
import { getCampaignFormOptions, getVisibleCampaigns } from "@/server/performance/queries";
import { localDayKey } from "@/server/kpis/period";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { CampaignsWorkspace } from "@/components/performance/campaigns-workspace";

export const metadata: Metadata = { title: "Campanhas" };

/**
 * Campanhas e desafios de gamificação: progresso por participante (motor de KPIs ou contagem de eventos) e ranking.
 * Lista pelo escopo da tela (performance.campanhas: gestão vê todas; colaborador, as do seu departamento ou em que
 * participa); criar/editar/remover pelas chaves de ação, calculadas aqui e revalidadas nas actions.
 */
export default async function CampaignsPage() {
  const viewer = await requireScreen("performance.campanhas");
  const capabilities = { create: can(viewer, "performance.campanhas.criar"), edit: can(viewer, "performance.campanhas.editar"), remove: can(viewer, "performance.campanhas.excluir") };
  const needsForm = capabilities.create || capabilities.edit;
  const [{ items }, options] = await Promise.all([getVisibleCampaigns(viewer), needsForm ? getCampaignFormOptions() : Promise.resolve({ kpis: [], users: [] })]);
  return (
    <PageContainer>
      <PageHeader title="Campanhas" description="Desafios com meta por pessoa, prêmio e ranking próprio." breadcrumbs={[{ label: "Performance", href: "/performance" }, { label: "Campanhas" }]} />
      <CampaignsWorkspace items={items} options={options} canManage={capabilities.create} canEdit={capabilities.edit} canDelete={capabilities.remove} today={localDayKey()} />
    </PageContainer>
  );
}
