import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/server/auth/session";
import { getWorkflowTemplateDetail } from "@/server/workflow/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { TemplateEditor } from "@/components/workflow/template-editor";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const detail = await getWorkflowTemplateDetail(id);
  return { title: detail ? `${detail.template.name} v${detail.template.version}` : "Template não encontrado" };
}

/** Admin: editor de uma versão do template (etapas, gates, SLA e tarefas automáticas). */
export default async function AdminWorkflowTemplatePage({ params }: { params: Params }) {
  await requireRole("admin");
  const { id } = await params;
  const detail = await getWorkflowTemplateDetail(id);
  if (!detail) notFound();
  return (
    <PageContainer>
      <PageHeader title={detail.template.name} description={detail.template.description} breadcrumbs={[{ label: "Administração" }, { label: "Workflows", href: "/admin/workflows" }, { label: `v${detail.template.version}` }]} />
      <TemplateEditor key={detail.template.id} template={detail.template} versions={detail.versions} instances={detail.instances} slaRuleKeys={detail.slaRuleKeys} />
    </PageContainer>
  );
}
