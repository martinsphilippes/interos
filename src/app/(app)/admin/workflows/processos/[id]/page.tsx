import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/server/auth/session";
import { getBuilderData } from "@/server/process-engine/queries";
import { PageContainer } from "@/components/layout/page-container";
import { ProcessBuilder } from "@/components/workflow-builder/process-builder";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const data = await getBuilderData(id);
  return { title: data ? `${data.definition.name} v${data.definition.version}` : "Processo não encontrado" };
}

/** Admin: construtor visual de um processo (uma versão). */
export default async function ProcessBuilderPage({ params }: { params: Params }) {
  await requireRole("admin");
  const { id } = await params;
  const data = await getBuilderData(id);
  if (!data) notFound();
  return (
    <PageContainer size="full">
      <ProcessBuilder key={data.definition.id} data={data} webhooksEnabled={process.env.AUTOMATION_WEBHOOKS_ENABLED === "true"} />
    </PageContainer>
  );
}
