import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { GitBranch } from "lucide-react";
import { requireRole } from "@/server/auth/session";
import { getRunsPageData } from "@/server/process-engine/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { RunViewer } from "@/components/workflow-builder/run-viewer";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export const metadata: Metadata = { title: "Execuções do processo" };

/** Admin: execuções de um processo (todas as versões) com o caminho percorrido desenhado no grafo. */
export default async function ProcessRunsPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await requireRole("admin");
  const { id } = await params;
  const { run } = await searchParams;
  const data = await getRunsPageData(id, typeof run === "string" ? run : undefined);
  if (!data) notFound();
  return (
    <PageContainer size="full">
      <PageHeader
        title={`Execuções · ${data.definition.name}`}
        description="Execuções em andamento e encerradas, com o caminho percorrido e as respostas pendentes."
        breadcrumbs={[{ label: "Administração" }, { label: "Workflows", href: "/admin/workflows" }, { label: data.definition.name, href: `/admin/workflows/processos/${data.definition.id}` }, { label: "Execuções" }]}
        actions={
          <Button asChild variant="outline">
            <Link href={`/admin/workflows/processos/${data.definition.id}`}>
              <GitBranch /> Abrir construtor
            </Link>
          </Button>
        }
      />
      <RunViewer data={data} />
    </PageContainer>
  );
}
