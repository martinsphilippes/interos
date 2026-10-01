import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ACCESS_DENIED_REDIRECT, can, canSeeHref, requireScreen } from "@/server/auth/session";
import { getProject, getProjectRecord } from "@/server/implementation/queries";
import { canSeeProject, implementationCapabilities, projectSections } from "@/server/implementation/access";
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
import { ProjectTabs, type ProjectTab } from "@/components/implementation/project-tabs";
import { AgentSuggestions } from "@/components/automations/agent-suggestions";
import { TrainingsTab } from "@/components/implementation/trainings-tab";
import { SaleDataCard } from "@/components/implementation/sale-data-card";

type Params = Promise<{ projectId: string }>;

export const metadata: Metadata = { title: "Projeto de implantação" };

/**
 * Projeto de implantação: cabeçalho (cliente, produtos, equipe, datas, SLA, progresso) e abas Plano,
 * Checklist, Treinamentos, Pendências, Documentos, Histórico e Go-live (gate + aprovação + handoff).
 *
 * Acesso: tela "Projetos de implantação" + escopo do projeto (responsável/equipe; fora dele → acesso negado, A29).
 * Cada aba/bloco tem a sua seção no catálogo: seção negada não aparece e os dados dela não são lidos. Os botões
 * seguem as ações do catálogo (implementationCapabilities); sem nenhuma, a página fica somente leitura. O título
 * da aba do navegador é fixo (não lê dados, A30).
 */
export default async function ProjectPage({ params }: { params: Params }) {
  const user = await requireScreen("implantacao.projetos");
  const { projectId } = await params;
  const record = await getProjectRecord(projectId);
  if (!record) notFound();
  if (!(await canSeeProject(user, record))) redirect(ACCESS_DENIED_REDIRECT);
  const sections = projectSections(user);
  const detail = await getProject(projectId, {
    project: record,
    include: { sale: sections.saleData, documents: sections.documents, history: sections.history },
    hideValues: !can(user, "financeiro.valores.ver"),
  });
  if (!detail) notFound();

  const { project, row, client, tasks, trainings, users } = detail;
  const caps = implementationCapabilities(user);
  const readOnly = project.status === "concluida" || project.status === "cancelada";
  const active = !readOnly;
  const now = new Date().toISOString();
  const required = tasks.filter((t) => t.required && t.status !== "cancelada");
  const userOptions = users.map((u) => ({ id: u.id, name: u.name }));
  const productNames = new Map(row.products.map((p) => [p.id, p.name]));
  const userNames = new Map(users.map((u) => [u.id, u.name]));
  const trainingItems = trainings.map((t) => ({ ...t, instructorName: userNames.get(t.instructorId) ?? "—", productName: t.productId ? productNames.get(t.productId) : undefined }));
  const openRequired = required.filter((t) => t.status !== "concluida").length;
  const canApprove = caps.approveGoLive && canApproveGoLive(project, user, detail.settings);

  const tabs: ProjectTab[] = [];
  if (sections.plan) {
    tabs.push({
      value: "plano",
      label: "Plano",
      count: openRequired,
      content: (
        <PlanTab
          projectId={project.id}
          tasks={tasks}
          currentPhase={project.currentPhase}
          users={userOptions}
          ownerId={project.ownerId}
          permissions={{ add: caps.addTask, complete: caps.completeTask, reopen: caps.reopenTask, assign: caps.assignTask }}
          readOnly={readOnly}
          now={now}
        />
      ),
    });
  }
  if (sections.checklist) {
    tabs.push({
      value: "checklist",
      label: "Checklist",
      count: project.checklist.filter((c) => !c.done && c.required !== false).length,
      content: <ChecklistTab projectId={project.id} items={project.checklist} users={userOptions} canToggle={caps.toggleChecklist && active} canAdd={caps.addChecklistItem && active} />,
    });
  }
  if (sections.trainings) {
    tabs.push({
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
          permissions={{ schedule: caps.scheduleTraining, complete: caps.completeTraining, cancel: caps.cancelTraining }}
          allowNew={!readOnly}
        />
      ),
    });
  }
  if (sections.pending) {
    tabs.push({
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
          canRegister={caps.registerPending && active}
          canResolve={caps.resolvePending && active}
        />
      ),
    });
  }
  if (sections.documents) {
    tabs.push({
      value: "documentos",
      label: "Documentos",
      count: detail.documents.length,
      content: <DocumentsTab projectId={project.id} documents={detail.documents} users={userOptions} editable={caps.attachDocument} />,
    });
  }
  if (sections.history) {
    tabs.push({ value: "historico", label: "Histórico", content: <HistoryTab events={detail.events} goLiveAt={project.goLiveAt} tickets={detail.postGoLiveTickets} /> });
  }
  if (sections.goLive) {
    tabs.push({
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
          canValidate={caps.validateGoLive}
          canAccept={caps.registerAcceptance}
          showApprove={caps.approveGoLive}
          canApprove={canApprove}
          requiresManager={detail.settings.exigeAprovacaoGestor}
          currentUserName={user.name}
          defaultContactName={detail.primaryContactName}
          today={dateKey(now)}
        />
      ),
    });
  }
  const preferred = project.status === "pronta_para_go_live" ? "go-live" : "plano";
  const defaultTab = tabs.some((t) => t.value === preferred) ? preferred : (tabs[0]?.value ?? preferred);

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
        editable={caps.assignTeam && active}
      />
      {detail.sale ? <SaleDataCard sale={detail.sale} showDocumentLink={canSeeHref(user, `/financeiro/contratos/${detail.sale.summary.id}/documento`)} /> : null}
      {!readOnly && sections.suggestions ? <AgentSuggestions kind="implantacao" subjectId={project.id} title="Sugestões do assistente de implantação" limit={3} className="mb-4" /> : null}
      {tabs.length > 0 ? <ProjectTabs defaultTab={defaultTab} tabs={tabs} /> : null}
    </PageContainer>
  );
}
