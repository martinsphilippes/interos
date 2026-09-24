import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getProject } from "@/server/implementation/queries";
import { canOperateImplementation } from "@/server/implementation/schemas";
import { canApproveGoLive } from "@/server/implementation/service";
import { dateKey } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { ChecklistTab } from "@/components/implementation/checklist-tab";
import { DocumentsTab } from "@/components/implementation/documents-tab";
import { GoLivePanel } from "@/components/implementation/go-live-panel";
import { HistoryTab } from "@/components/implementation/history-tab";
import { PendingTab } from "@/components/implementation/pending-tab";
import { PlanTab } from "@/components/implementation/plan-tab";
import { ProjectHeader } from "@/components/implementation/project-header";
import { ProjectTabs } from "@/components/implementation/project-tabs";
import { TrainingsTab } from "@/components/implementation/trainings-tab";

type Params = Promise<{ projectId: string }>;

export const metadata: Metadata = { title: "Projeto de implantação" };

/**
 * Projeto de implantação: cabeçalho (cliente, produtos, equipe, datas, SLA, progresso) e abas Plano,
 * Checklist, Treinamentos, Pendências, Documentos, Histórico e Go-live (gate + aprovação + handoff).
 */
export default async function ProjectPage({ params }: { params: Params }) {
  const user = await requireUser();
  if (!canAccessModule(user, "implantacao")) redirect("/meu-dia?erro=sem-permissao");
  const { projectId } = await params;
  const detail = await getProject(projectId);
  if (!detail) notFound();

  const { project, row, client, tasks, trainings, users } = detail;
  const canOperate = canOperateImplementation(user);
  const readOnly = project.status === "concluida" || project.status === "cancelada";
  const editable = canOperate && !readOnly;
  const now = new Date().toISOString();
  const required = tasks.filter((t) => t.required && t.status !== "cancelada");
  const userOptions = users.map((u) => ({ id: u.id, name: u.name }));
  const productNames = new Map(row.products.map((p) => [p.id, p.name]));
  const userNames = new Map(users.map((u) => [u.id, u.name]));
  const trainingItems = trainings.map((t) => ({ ...t, instructorName: userNames.get(t.instructorId) ?? "—", productName: t.productId ? productNames.get(t.productId) : undefined }));
  const openRequired = required.filter((t) => t.status !== "concluida").length;
  const defaultTab = project.status === "pronta_para_go_live" ? "go-live" : "plano";

  return (
    <PageContainer>
      <PageHeader
        title={project.name}
        breadcrumbs={[{ label: "Implantação", href: "/implantacao" }, { label: "Projetos", href: "/implantacao" }, { label: client.tradeName }]}
      />
      <ProjectHeader
        row={row}
        scope={project.scope}
        client={client}
        contract={detail.contract}
        sla={detail.sla ? { state: detail.sla.state, remainingMs: detail.sla.remainingMs, dueAt: detail.sla.dueAt } : null}
        users={users}
        workflowStep={detail.workflowStep}
        requiredDone={required.length - openRequired}
        requiredTotal={required.length}
        editable={editable}
      />
      <ProjectTabs
        defaultTab={defaultTab}
        tabs={[
          {
            value: "plano",
            label: "Plano",
            count: openRequired,
            content: <PlanTab projectId={project.id} tasks={tasks} currentPhase={project.currentPhase} users={userOptions} ownerId={project.ownerId} canOperate={canOperate} readOnly={readOnly} now={now} />,
          },
          {
            value: "checklist",
            label: "Checklist",
            count: project.checklist.filter((c) => !c.done && c.required !== false).length,
            content: <ChecklistTab projectId={project.id} items={project.checklist} users={userOptions} editable={editable} />,
          },
          {
            value: "treinamentos",
            label: "Treinamentos",
            count: trainings.length,
            content: (
              <TrainingsTab
                items={trainingItems}
                project={{ id: project.id, name: project.name, clientName: client.tradeName, productIds: project.productIds }}
                products={row.products}
                users={userOptions}
                defaultInstructorId={project.ownerId}
                canOperate={canOperate}
                allowNew={!readOnly}
              />
            ),
          },
          {
            value: "pendencias",
            label: "Pendências",
            alert: project.status === "aguardando_cliente" || project.status === "bloqueada",
            content: (
              <PendingTab
                projectId={project.id}
                clientName={client.tradeName}
                status={project.status}
                ownerId={project.ownerId}
                waitingClient={project.waitingClient}
                blocked={project.blocked}
                externalDelayDays={project.externalDelayDays ?? 0}
                internalDelayDays={project.internalDelayDays ?? 0}
                users={userOptions}
                editable={editable}
              />
            ),
          },
          {
            value: "documentos",
            label: "Documentos",
            count: detail.documents.length,
            content: <DocumentsTab projectId={project.id} documents={detail.documents} users={userOptions} editable={canOperate} />,
          },
          {
            value: "historico",
            label: "Histórico",
            content: <HistoryTab events={detail.events} goLiveAt={project.goLiveAt} tickets={detail.postGoLiveTickets} />,
          },
          {
            value: "go-live",
            label: "Go-live",
            alert: project.status === "pronta_para_go_live",
            content: (
              <GoLivePanel
                projectId={project.id}
                clientName={client.tradeName}
                gate={detail.gate}
                status={project.status}
                goLiveAt={project.goLiveAt}
                validation={project.validation}
                acceptance={project.acceptance}
                editable={canOperate}
                canApprove={canApproveGoLive(project, { id: user.id, isManager: user.isManager }, detail.settings)}
                requiresManager={detail.settings.exigeAprovacaoGestor}
                currentUserName={user.name}
                defaultContactName={detail.primaryContactName}
                today={dateKey(now)}
              />
            ),
          },
        ]}
      />
    </PageContainer>
  );
}
