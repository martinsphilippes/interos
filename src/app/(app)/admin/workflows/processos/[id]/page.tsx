import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, getCurrentUser, requireScreen } from "@/server/auth/session";
import { getBuilderData } from "@/server/process-engine/queries";
import { PageContainer } from "@/components/layout/page-container";
import { ProcessBuilder } from "@/components/workflow-builder/process-builder";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  // A30: sem acesso à seção, nada é lido (título genérico).
  const user = await getCurrentUser();
  if (!user || !can(user, "admin.workflows.processos.ver")) return { title: "Processo" };
  const data = await getBuilderData(id);
  return { title: data ? `${data.definition.name} v${data.definition.version}` : "Processo não encontrado" };
}

/** Construtor visual de um processo (uma versão). */
export default async function ProcessBuilderPage({ params }: { params: Params }) {
  const user = await requireScreen("admin.workflows.processos.ver");
  const { id } = await params;
  const data = await getBuilderData(id);
  if (!data) notFound();
  return (
    <PageContainer size="full">
      <ProcessBuilder
        key={data.definition.id}
        data={data}
        webhooksEnabled={process.env.AUTOMATION_WEBHOOKS_ENABLED === "true"}
        access={{ save: can(user, "admin.workflows.processos.editar"), publish: can(user, "admin.workflows.processos.publicar"), test: can(user, "admin.workflows.processos.testar") }}
      />
    </PageContainer>
  );
}
