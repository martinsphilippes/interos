"use server";
/**
 * Server Actions da Implantação. Padrão: requireUser() → permissão → validação zod → serviço (regras e
 * eventos) → revalidatePath. Todas devolvem ActionResult com mensagem em português.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAccessModule, requireUser } from "@/server/auth/session";
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
  canOperateImplementation,
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

type Failure = { ok: false; error: string };

function fail(error: unknown, fallback: string): Failure {
  if (error instanceof z.ZodError) return { ok: false, error: zodMessage(error) };
  if (error instanceof Error && error.message) {
    // Erros de regra do serviço já vêm em português; erros técnicos ficam no log.
    if (!/firestore|firebase|ECONN|deadline|permission denied|undefined|null|NEXT_/i.test(error.message)) return { ok: false, error: error.message };
  }
  console.error(`[implantacao] ${fallback}`, error);
  return { ok: false, error: fallback };
}

const actorOf = (user: CurrentUser): ImplementationActor => ({ id: user.id, name: user.name, role: user.role, isManager: user.isManager });

/** Quem opera a implantação: equipe de implantação, gestores, diretoria e admin (Suporte e CS só consultam). */
async function requireOperator(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canAccessModule(user, "implantacao")) throw new Error("Seu perfil não tem acesso ao módulo de Implantação");
  if (!canOperateImplementation(user)) throw new Error("Somente a equipe de implantação ou gestores podem executar esta ação");
  return user;
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
    const user = await requireOperator();
    const data = changePhaseSchema.parse(input);
    const project = await changePhase(data.projectId, data.phase, actorOf(user));
    revalidateProject(project.id, project.clientId);
    return { ok: true, data: { status: project.status, phase: project.currentPhase } };
  } catch (error) {
    return fail(error, "Não foi possível mudar a fase do projeto");
  }
}

export async function completeProjectTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireOperator();
    const data = completeTaskSchema.parse(input);
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
    const user = await requireOperator();
    const { taskId } = taskIdSchema.parse(input);
    const task = await reopenImplementationTask(taskId, actorOf(user));
    revalidateProject(task.projectId, task.clientId);
    return { ok: true, data: { id: task.id } };
  } catch (error) {
    return fail(error, "Não foi possível reabrir a tarefa");
  }
}

export async function assignProjectTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireOperator();
    const data = assignTaskSchema.parse(input);
    const task = await assignImplementationTask(data.taskId, data.assigneeId, actorOf(user));
    revalidateProject(task.projectId, task.clientId);
    return { ok: true, data: { id: task.id } };
  } catch (error) {
    return fail(error, "Não foi possível atribuir a tarefa");
  }
}

export async function addProjectTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireOperator();
    const data = addTaskSchema.parse(input);
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
    const user = await requireOperator();
    const data = updateTeamSchema.parse(input);
    const project = await updateProjectTeam(data.projectId, data.ownerId, data.teamIds, actorOf(user));
    revalidateProject(project.id, project.clientId);
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    return fail(error, "Não foi possível atualizar a equipe");
  }
}

export async function toggleProjectChecklist(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireOperator();
    const data = toggleChecklistSchema.parse(input);
    const project = await toggleChecklistItem(data.projectId, data.itemId, data.done, actorOf(user));
    revalidateProject(project.id, project.clientId);
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    return fail(error, "Não foi possível atualizar o checklist");
  }
}

export async function addProjectChecklistItem(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireOperator();
    const data = addChecklistItemSchema.parse(input);
    const project = await addChecklistItem(data.projectId, data.label, data.required, actorOf(user));
    revalidateProject(project.id, project.clientId);
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    return fail(error, "Não foi possível adicionar o item");
  }
}

export async function addDocument(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireOperator();
    const data = documentSchema.parse(input);
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
    const user = await requireOperator();
    const data = trainingSchema.parse(input);
    const training = await scheduleTraining(data, actorOf(user));
    revalidateProject(data.projectId, training.clientId);
    return { ok: true, data: { id: training.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o treinamento");
  }
}

export async function markTrainingDone(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireOperator();
    const data = completeTrainingSchema.parse(input);
    const training: Training = await completeTraining(data.trainingId, data.evidence, data.notes, actorOf(user));
    revalidateProject(training.projectId, training.clientId);
    return { ok: true, data: { id: training.id } };
  } catch (error) {
    return fail(error, "Não foi possível concluir o treinamento");
  }
}

export async function cancelProjectTraining(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireOperator();
    const { trainingId } = trainingIdSchema.parse(input);
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
    const user = await requireOperator();
    const data = waitingClientSchema.parse(input);
    const project = await setProjectWaitingClient(data, actorOf(user));
    revalidateProject(project.id, project.clientId);
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar a pendência do cliente");
  }
}

export async function resumeWaitingProject(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireOperator();
    const { projectId } = projectIdSchema.parse(input);
    const project = await resumeProject(projectId, actorOf(user));
    revalidateProject(project.id, project.clientId);
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    return fail(error, "Não foi possível retomar o projeto");
  }
}

export async function registerBlock(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireOperator();
    const data = blockSchema.parse(input);
    const project = await blockProject(data.projectId, data.reason, actorOf(user));
    revalidateProject(project.id, project.clientId);
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    return fail(error, "Não foi possível bloquear o projeto");
  }
}

export async function resolveBlock(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireOperator();
    const { projectId } = projectIdSchema.parse(input);
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
    const user = await requireOperator();
    const data = validationSchema.parse(input);
    const project = await registerValidation(data, actorOf(user));
    revalidateProject(project.id, project.clientId);
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar a validação");
  }
}

export async function saveAcceptance(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireOperator();
    const data = acceptanceSchema.parse(input);
    const project = await registerAcceptance(data, actorOf(user));
    revalidateProject(project.id, project.clientId);
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    return fail(error, "Não foi possível registrar o aceite");
  }
}

export async function approveProjectGoLive(input: unknown): Promise<ActionResult<{ id: string; csOwnerName: string; onboardingTaskId: string }>> {
  try {
    const user = await requireOperator();
    const { projectId } = projectIdSchema.parse(input);
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
    const user = await requireUser();
    if (!user.isManager) throw new Error("Só gestores ou administradores alteram a regra de aprovação do go-live");
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
    const user = await requireOperator();
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
    await requireOperator();
    const data = templateActiveSchema.parse(input);
    const template = await setTemplateActive(data.templateId, data.active);
    revalidatePath("/implantacao/checklists");
    return { ok: true, data: { id: template.id, active: template.active } };
  } catch (error) {
    return fail(error, "Não foi possível alterar o template");
  }
}

