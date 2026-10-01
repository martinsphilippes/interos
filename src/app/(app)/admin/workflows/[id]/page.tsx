import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, getCurrentUser, requireScreen } from "@/server/auth/session";
import { getWorkflowTemplateDetail } from "@/server/workflow/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { TemplateEditor } from "@/components/workflow/template-editor";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  // A30: sem acesso à seção, nada é lido (título genérico).
  const user = await getCurrentUser();
  if (!user || !can(user, "admin.workflows.jornada.ver")) return { title: "Workflow" };
  const detail = await getWorkflowTemplateDetail(id);
  return { title: detail ? `${detail.template.name} v${detail.template.version}` : "Template não encontrado" };
}

/** Editor de uma versão do template (etapas, gates, SLA e tarefas automáticas). */
export default async function AdminWorkflowTemplatePage({ params }: { params: Params }) {
  const user = await requireScreen("admin.workflows.jornada.ver");
  const { id } = await params;
  const detail = await getWorkflowTemplateDetail(id);
  if (!detail) notFound();
  return (
    <PageContainer>
      <PageHeader title={detail.template.name} description={detail.template.description} breadcrumbs={[{ label: "Administração" }, { label: "Workflows", href: "/admin/workflows" }, { label: `v${detail.template.version}` }]} />
      <TemplateEditor key={detail.template.id} template={detail.template} versions={detail.versions} instances={detail.instances} slaRuleKeys={detail.slaRuleKeys} canSave={can(user, "admin.workflows.jornada.editar")} canPublish={can(user, "admin.workflows.jornada.publicar")} />
    </PageContainer>
  );
}
