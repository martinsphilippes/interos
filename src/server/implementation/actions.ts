"use server";
/**
 * Server Actions da Implantação. Padrão: requirePermission(chave do catálogo src/domain/permissions/implantacao.ts)
 * → validação zod → escopo do registro (projeto, tarefa ou treinamento; A29) → serviço (regras e eventos) →
 * revalidatePath. Todas devolvem ActionResult com mensagem em português; falhas pelo tratamento único (failAction,
 * que relança redirect/notFound e esconde erros técnicos).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { failAction, requirePermission } from "@/server/auth/session";
import { type ActionResult, type CurrentUser, type ImplementationTask, type Training } from "@/domain/types";
import {
  addChecklistItem,
  addImplementationTask,
  addProjectDocument,
  approveGoLive,
  assignImplementationTask,
  blockProject,
  cancelTraining,
  changePhase,
  completeImplementationTask,
  completeTraining,
  getGoLiveSettings,
  loadProject,
  registerAcceptance,
  registerValidation,
  reopenImplementationTask,
  resumeProject,
  saveGoLiveSettings,
  scheduleTraining,
  setProjectWaitingClient,
  toggleChecklistItem,
  unblockProject,
  updateProjectTeam,
  type ImplementationActor,
} from "./service";
import { saveTemplate, setTemplateActive } from "./templates";
import {
  acceptanceSchema,
  addChecklistItemSchema,
  addTaskSchema,
  assignTaskSchema,
  blockSchema,
  changePhaseSchema,
  completeTaskSchema,
  completeTrainingSchema,
  documentSchema,
  goLiveSettingsSchema,
  projectIdSchema,
  taskIdSchema,
  templateActiveSchema,
  templateSchema,
  toggleChecklistSchema,
  trainingIdSchema,
  trainingSchema,
  updateTeamSchema,
  validationSchema,
  waitingClientSchema,
  zodMessage,
} from "./schemas";
import { assertProjectAccess, assertTaskAccess, assertTrainingAccess } from "./access";

type Failure = { ok: false; error: string };

/** Validação: a primeira mensagem do zod (como antes); o resto pelo tratamento único (failAction). */
function fail(error: unknown, fallback: string): Failure {
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  return failAction(error, fallback, "implantacao");
}

/** Ator com departamento e permissões efetivas da sessão: o go-live é decidido no servidor como na UI. */
const actorOf = (user: CurrentUser): ImplementationActor => ({ id: user.id, name: user.name, role: user.role, isManager: user.isManager, departmentId: user.departmentId, permissions: user.permissions });

/** Mensagem de negação da regra de aprovação do go-live (a mesma de antes do catálogo). */
const CONFIGURE_GO_LIVE_DENIED = "Só gestores ou administradores alteram a regra de aprovação do go-live";

/** Template com id = edição; sem id = criação (a chave depende do argumento, antes da validação). */
function templateIdOf(input: unknown): string | undefined {
  const id = input && typeof input === "object" ? (input as { id?: unknown }).id : undefined;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

function revalidateProject(projectId?: string, clientId?: string) {
  revalidatePath("/implantacao", "layout");
  if (projectId) revalidatePath(`/implantacao/${projectId}`);
  if (clientId) revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/workflow", "layout");
  revalidatePath("/meu-dia");
}

// ---------------------------------------------------------------------------
// Fases e tarefas
// ---------------------------------------------------------------------------

export async function changeProjectPhase(input: unknown): Promise<ActionResult<{ status: string; phase: string }>> {
  try {
    const user = await requirePermission("implantacao.kanban.editar");
    const data = changePhaseSchema.parse(input);
    await assertProjectAccess(user, data.projectId, "implantacao.kanban");
    const project = await changePhase(data.projectId, data.phase, actorOf(user));
    revalidateProject(project.id, project.clientId);
    return { ok: true, data: { status: project.status, phase: project.currentPhase } };
  } catch (error) {
    return fail(error, "Não foi possível mudar a fase do projeto");
  }
}

export async function completeProjectTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("implantacao.projetos.plano.concluir");
    const data = completeTaskSchema.parse(input);
    await assertTaskAccess(user, data.taskId);
    const task = await completeImplementationTask(data.taskId, data.evidence, actorOf(user));
    revalidateProject(task.projectId, task.clientId);
    revalidatePath("/tarefas");
    return { ok: true, data: { id: task.id } };
  } catch (error) {
    return fail(error, "Não foi possível concluir a tarefa");
  }
}

export async function reopenProjectTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("implantacao.projetos.plano.reabrir");
    const { taskId } = taskIdSchema.parse(input);
    await assertTaskAccess(user, taskId);
    const task = await reopenImplementationTask(taskId, actorOf(user));
    revalidateProject(task.projectId, task.clientId);
    return { ok: true, data: { id: task.id } };
  } catch (error) {
    return fail(error, "Não foi possível reabrir a tarefa");
  }
}

export async function assignProjectTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("implantacao.projetos.plano.atribuir");
    const data = assignTaskSchema.parse(input);
    await assertTaskAccess(user, data.taskId);
    const task = await assignImplementationTask(data.taskId, data.assigneeId, actorOf(user));
    revalidateProject(task.projectId, task.clientId);
    return { ok: true, data: { id: task.id } };
  } catch (error) {
    return fail(error, "Não foi possível atribuir a tarefa");
  }
}

export async function addProjectTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("implantacao.projetos.plano.criar");
    const data = addTaskSchema.parse(input);
    await assertProjectAccess(user, data.projectId);
    const task: ImplementationTask = await addImplementationTask(data, actorOf(user));
    revalidateProject(task.projectId, task.clientId);
    return { ok: true, data: { id: task.id } };
  } catch (error) {
    return fail(error, "Não foi possível adicionar a tarefa");
  }
}

// ---------------------------------------------------------------------------
// Equipe, checklist, documentos
// ---------------------------------------------------------------------------

export async function updateTeam(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("implantacao.projetos.atribuir");
    const data = updateTeamSchema.parse(input);
    await assertProjectAccess(user, data.projectId);
    const project = await updateProjectTeam(data.projectId, data.ownerId, data.teamIds, actorOf(user));
    revalidateProject(project.id, project.clientId);
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    return fail(error, "Não foi possível atualizar a equipe");
  }
}

export async function toggleProjectChecklist(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("implantacao.projetos.checklist.concluir");
    const data = toggleChecklistSchema.parse(input);
    await assertProjectAccess(user, data.projectId);
    const project = await toggleChecklistItem(data.projectId, data.itemId, data.done, actorOf(user));
    revalidateProject(project.id, project.clientId);
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    return fail(error, "Não foi possível atualizar o checklist");
  }
}

export async function addProjectChecklistItem(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("implantacao.projetos.checklist.criar");
    const data = addChecklistItemSchema.parse(input);
    await assertProjectAccess(user, data.projectId);
    const project = await addChecklistItem(data.projectId, data.label, data.required, actorOf(user));
    revalidateProject(project.id, project.clientId);
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    return fail(error, "Não foi possível adicionar o item");
  }
}

export async function addDocument(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("implantacao.projetos.documentos.anexar");
    const data = documentSchema.parse(input);
    await assertProjectAccess(user, data.projectId);
    const doc = await addProjectDocument(data, actorOf(user));
    revalidateProject(data.projectId, doc.clientId);
    return { ok: true, data: { id: doc.id } };
  } catch (error) {
    return fail(error, "Não foi possível anexar o documento");
  }
}

// ---------------------------------------------------------------------------
// Treinamentos
// ---------------------------------------------------------------------------

export async function createTraining(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("implantacao.treinamentos.criar");
    const data = trainingSchema.parse(input);
    await assertProjectAccess(user, data.projectId, "implantacao.treinamentos");
    const training = await scheduleTraining(data, actorOf(user));
    revalidateProject(data.projectId, training.clientId);
    return { ok: true, data: { id: training.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o treinamento");
  }
}

export async function markTrainingDone(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("implantacao.treinamentos.concluir");
    const data = completeTrainingSchema.parse(input);
    await assertTrainingAccess(user, data.trainingId);
    const training: Training = await completeTraining(data.trainingId, data.evidence, data.notes, actorOf(user));
    revalidateProject(training.projectId, training.clientId);
    return { ok: true, data: { id: training.id } };
  } catch (error) {
    return fail(error, "Não foi possível concluir o treinamento");
  }
}

export async function cancelProjectTraining(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("implantacao.treinamentos.cancelar");
    const { trainingId } = trainingIdSchema.parse(input);
    await assertTrainingAccess(user, trainingId);
    const training = await cancelTraining(trainingId, actorOf(user));
    revalidateProject(training.projectId, training.clientId);
    return { ok: true, data: { id: training.id } };
  } catch (error) {
    return fail(error, "Não foi possível cancelar o treinamento");
  }
}

// ---------------------------------------------------------------------------
// Pendência do cliente e bloqueio
// ---------------------------------------------------------------------------

export async function registerWaitingClient(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("implantacao.projetos.pendencias.criar");
    const data = waitingClientSchema.parse(input);
    await assertProjectAccess(user, data.projectId);
    const project = await setProjectWaitingClient(data, actorOf(user));
    revalidateProject(project.id, project.clientId);
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar a pendência do cliente");
  }
}

export async function resumeWaitingProject(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("implantacao.projetos.pendencias.concluir");
    const { projectId } = projectIdSchema.parse(input);
    await assertProjectAccess(user, projectId);
    const project = await resumeProject(projectId, actorOf(user));
    revalidateProject(project.id, project.clientId);
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    return fail(error, "Não foi possível retomar o projeto");
  }
}

export async function registerBlock(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("implantacao.projetos.pendencias.criar");
    const data = blockSchema.parse(input);
    await assertProjectAccess(user, data.projectId);
    const project = await blockProject(data.projectId, data.reason, actorOf(user));
    revalidateProject(project.id, project.clientId);
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    return fail(error, "Não foi possível bloquear o projeto");
  }
}

export async function resolveBlock(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("implantacao.projetos.pendencias.concluir");
    const { projectId } = projectIdSchema.parse(input);
    await assertProjectAccess(user, projectId);
    const project = await unblockProject(projectId, actorOf(user));
    revalidateProject(project.id, project.clientId);
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    return fail(error, "Não foi possível resolver o bloqueio");
  }
}

// ---------------------------------------------------------------------------
// Go-live
// ---------------------------------------------------------------------------

export async function saveValidation(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("implantacao.go-live.validar");
    const data = validationSchema.parse(input);
    await assertProjectAccess(user, data.projectId, "implantacao.go-live");
    const project = await registerValidation(data, actorOf(user));
    revalidateProject(project.id, project.clientId);
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar a validação");
  }
}

export async function saveAcceptance(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("implantacao.go-live.registrar-aceite");
    const data = acceptanceSchema.parse(input);
    await assertProjectAccess(user, data.projectId, "implantacao.go-live");
    const project = await registerAcceptance(data, actorOf(user));
    revalidateProject(project.id, project.clientId);
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o aceite");
  }
}

export async function approveProjectGoLive(input: unknown): Promise<ActionResult<{ id: string; csOwnerName: string; onboardingTaskId: string }>> {
  try {
    const user = await requirePermission("implantacao.go-live.aprovar");
    const { projectId } = projectIdSchema.parse(input);
    await assertProjectAccess(user, projectId, "implantacao.go-live");
    // checkedIn (A22): sem ser o responsável, ou com a regra "exige gestor", só quem aprova qualquer projeto.
    const [project, settings] = await Promise.all([loadProject(projectId), getGoLiveSettings()]);
    if (settings.exigeAprovacaoGestor || project.ownerId !== user.id) {
      await requirePermission("implantacao.go-live.aprovar-qualquer", settings.exigeAprovacaoGestor ? "Só gestores ou administradores podem aprovar o go-live" : "Só o responsável do projeto ou gestores podem aprovar o go-live");
    }
    const result = await approveGoLive(projectId, actorOf(user));
    revalidateProject(result.project.id, result.project.clientId);
    revalidatePath("/clientes");
    revalidatePath("/cs", "layout");
    revalidatePath("/tarefas");
    return { ok: true, data: { id: result.project.id, csOwnerName: result.csOwner.name, onboardingTaskId: result.onboardingTaskId } };
  } catch (error) {
    return fail(error, "Não foi possível aprovar o go-live");
  }
}

export async function updateGoLiveSettings(input: unknown): Promise<ActionResult<{ exigeAprovacaoGestor: boolean }>> {
  try {
    const user = await requirePermission("implantacao.go-live.configurar", CONFIGURE_GO_LIVE_DENIED);
    const data = goLiveSettingsSchema.parse(input);
    await saveGoLiveSettings(data, { id: user.id, name: user.name });
    revalidatePath("/implantacao", "layout");
    return { ok: true, data };
  } catch (error) {
    return fail(error, "Não foi possível salvar a configuração do go-live");
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function saveImplementationTemplate(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = templateIdOf(input) ? await requirePermission("implantacao.checklists.editar") : await requirePermission("implantacao.checklists.criar");
    const data = templateSchema.parse(input);
    const template = await saveTemplate(data, { id: user.id, name: user.name });
    revalidatePath("/implantacao/checklists");
    revalidatePath("/admin/produtos");
    return { ok: true, data: { id: template.id } };
  } catch (error) {
    return fail(error, "Não foi possível salvar o template");
  }
}

export async function toggleImplementationTemplate(input: unknown): Promise<ActionResult<{ id: string; active: boolean }>> {
  try {
    await requirePermission("implantacao.checklists.ativar");
    const data = templateActiveSchema.parse(input);
    const template = await setTemplateActive(data.templateId, data.active);
    revalidatePath("/implantacao/checklists");
    return { ok: true, data: { id: template.id, active: template.active } };
  } catch (error) {
    return fail(error, "Não foi possível alterar o template");
  }
}

