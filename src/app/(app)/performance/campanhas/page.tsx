import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { getCampaignFormOptions, getCampaignsProgress } from "@/server/performance/queries";
import { localDayKey } from "@/server/kpis/period";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { CampaignsWorkspace } from "@/components/performance/campaigns-workspace";

export const metadata: Metadata = { title: "Campanhas" };

/** Campanhas e desafios de gamificação: progresso por participante (motor de KPIs ou contagem de eventos) e ranking. */
export default async function CampaignsPage() {
  const viewer = await requireUser();
  const [items, options] = await Promise.all([getCampaignsProgress(viewer.id), viewer.isManager ? getCampaignFormOptions() : Promise.resolve({ kpis: [], users: [] })]);
  // Colaborador vê as campanhas do seu departamento ou em que participa; gestão vê todas.
  const visible = viewer.isManager ? items : items.filter((i) => i.campaign.status !== "planejada" && (i.mine || i.campaign.departments.includes(viewer.departmentId)));
  return (
    <PageContainer>
      <PageHeader title="Campanhas" description="Desafios com meta por pessoa, prêmio e ranking próprio." breadcrumbs={[{ label: "Performance", href: "/performance" }, { label: "Campanhas" }]} />
      <CampaignsWorkspace items={visible} options={options} canManage={viewer.isManager} today={localDayKey()} />
    </PageContainer>
  );
}
