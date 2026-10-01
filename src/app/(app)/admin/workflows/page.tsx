import type { Metadata } from "next";
import { can, requireScreen } from "@/server/auth/session";
import { listWorkflowTemplates } from "@/server/workflow/queries";
import { listProcessSummaries } from "@/server/process-engine/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { TemplatesTable } from "@/components/workflow/templates-table";
import { ProcessList } from "@/components/workflow-builder/process-list";
import { NewProcessButton } from "@/components/workflow-builder/new-process-button";

export const metadata: Metadata = { title: "Workflows" };

/**
 * Os dois tipos de workflow. Jornada do cliente (6 etapas com gates, editor em lista) e Processos com ramificações
 * (construtor visual). Cada bloco aparece só com a seção correspondente do catálogo (dados negados não são lidos).
 */
export default async function AdminWorkflowsPage() {
  const user = await requireScreen("admin.workflows");
  const showProcesses = can(user, "admin.workflows.processos.ver");
  const showJourney = can(user, "admin.workflows.jornada.ver");
  const canCreateProcess = showProcesses && can(user, "admin.workflows.processos.criar");
  const [templates, processes] = await Promise.all([showJourney ? listWorkflowTemplates() : Promise.resolve([]), showProcesses ? listProcessSummaries() : Promise.resolve([])]);
  const published = templates.filter((t) => t.published).length;
  const running = processes.reduce((sum, p) => sum + p.runs.em_andamento, 0);
  return (
    <PageContainer>
      <PageHeader
        title="Workflows"
        description="Jornada do cliente e processos com ramificações. Versões publicadas são imutáveis: editar cria uma nova versão; o que já está em andamento continua na versão em que começou."
        breadcrumbs={[{ label: "Administração" }, { label: "Workflows" }]}
      />
      {showProcesses ? (
      <section className="flex flex-col gap-3" aria-labelledby="sec-processos">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="sec-processos" className="text-lg font-semibold">
              Processos
            </h2>
            <p className="text-sm text-muted">
              Construtor visual: tarefas, aprovações, condições, esperas e notificações · {processes.length} processo(s) · {running} execução(ões) em andamento
            </p>
          </div>
          {processes.length > 0 && canCreateProcess ? <NewProcessButton /> : null}
        </div>
        <ProcessList processes={processes} canCreate={canCreateProcess} />
      </section>
      ) : null}
      {showJourney ? (
      <section className="mt-8 flex flex-col gap-3" aria-labelledby="sec-jornada">
        <div>
          <h2 id="sec-jornada" className="text-lg font-semibold">
            Jornada do cliente
          </h2>
          <p className="text-sm text-muted">
            Seis etapas lineares com gates (editor em lista) · {templates.length} versão(ões) de template · {published} publicada(s)
          </p>
        </div>
        <TemplatesTable templates={templates} />
      </section>
      ) : null}
    </PageContainer>
  );
}
