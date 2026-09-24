import type { Metadata } from "next";
import { requireRole } from "@/server/auth/session";
import { listWorkflowTemplates } from "@/server/workflow/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { TemplatesTable } from "@/components/workflow/templates-table";

export const metadata: Metadata = { title: "Workflows" };

/** Admin: templates de workflow (todas as versões). Somente administradores. */
export default async function AdminWorkflowsPage() {
  await requireRole("admin");
  const templates = await listWorkflowTemplates();
  const published = templates.filter((t) => t.published).length;
  return (
    <PageContainer>
      <PageHeader
        title="Workflows"
        description={`${templates.length} versão(ões) de template · ${published} publicada(s). Versões publicadas são imutáveis: editar cria uma nova versão; jornadas em andamento continuam na versão em que começaram.`}
        breadcrumbs={[{ label: "Administração" }, { label: "Workflows" }]}
      />
      <TemplatesTable templates={templates} />
    </PageContainer>
  );
}
