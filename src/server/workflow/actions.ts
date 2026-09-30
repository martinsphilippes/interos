"use server";
/**
 * Server Actions do Workflow. Padrão: requirePermission(chave do catálogo operacao.workflow.* / admin.workflows.*)
 * → validação zod → etapa dentro do escopo (canSeeStepId) → serviço → revalidação. Falhas por failAction; todas
 * devolvem ActionResult com mensagem em português. Quem pode aprovar/concluir por exceção continua decidido no serviço
 * (canApproveStage/canCompleteWithException, A22) com as permissões efetivas do ator.
 */
import { revalidatePath } from "next/cache";
import { BusinessError, PermissionError, failAction, requirePermission } from "@/server/auth/session";
import { create, getById, list, nowIso, update } from "@/server/db";
import { emitEvent } from "@/server/events";
import { COLLECTIONS, type ActionResult, type CurrentUser, type WorkflowInstance, type WorkflowStep, type WorkflowTemplate } from "@/domain/types";
import type { GateEvaluation } from "./gates";
import { canSeeStepId } from "./access";
import {
  addStepNoteSchema,
  completeGateSchema,
  rejectGateSchema,
  reassignStepSchema,
  saveTemplateSchema,
  stepIdSchema,
  templateIdSchema,
  toggleChecklistSchema,
  updateStepFieldsSchema,
  waitingClientSchema,
} from "./schemas";
import {
  addStepNote,
  approveGate,
  completeGate,
  reassignStep,
  rejectGate,
  resumeStep,
  setStepWaitingClient,
  updateStepChecklist,
  updateStepFields,
  type WorkflowActor,
} from "./service";

function fail(error: unknown): { ok: false; error: string } {
  return failAction(error, "Não foi possível concluir a operação. Tente novamente.", "workflow");
}

/** Etapa fora do escopo do usuário na tela Workflow = acesso negado. */
async function assertStepVisible(user: CurrentUser, stepId: string): Promise<void> {
  if (!(await canSeeStepId(user, stepId))) throw new PermissionError();
}

/** Ator com as permissões efetivas da sessão: o servidor decide aprovação/exceção como a UI (perfil, exceções, módulos). */
function actorOf(user: CurrentUser): WorkflowActor {
  return { id: user.id, name: user.name, role: user.role, permissions: user.permissions };
}

function revalidateStepPaths(step: Pick<WorkflowStep, "clientId" | "instanceId"> | null | undefined): void {
  revalidatePath("/workflow");
  revalidatePath("/tarefas");
  revalidatePath("/meu-dia");
  revalidatePath("/notificacoes");
  if (step?.instanceId) revalidatePath(`/workflow/${step.instanceId}`);
  if (step?.clientId) revalidatePath(`/clientes/${step.clientId}`);
}

async function loadStep(id: string): Promise<WorkflowStep> {
  const step = await getById<WorkflowStep>(COLLECTIONS.workflowSteps, id);
  if (!step) throw new BusinessError("Etapa não encontrada");
  return step;
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export interface CompleteGateActionData {
  status: "completed" | "awaiting_approval";
  stepId: string;
  nextStepId?: string;
  nextStageName?: string;
  instanceCompleted?: boolean;
  approverNames?: string[];
}

/** Erro estruturado para o drawer destacar o que falta. */
export interface GateBlockedError {
  missingFields: { path: string; label: string }[];
  missingChecklist: { key: string; label: string }[];
  needsDocuments: boolean;
}

export type CompleteGateActionResult = ActionResult<CompleteGateActionData> | { ok: false; error: string; blocked: GateBlockedError };

function blocked(evaluation: GateEvaluation, message: string): CompleteGateActionResult {
  return {
    ok: false,
    error: message,
    blocked: {
      missingFields: evaluation.missingFields.map((f) => ({ path: f.path, label: f.label })),
      missingChecklist: evaluation.missingChecklist,
      needsDocuments: evaluation.needsDocuments,
    },
  };
}

export async function completeGateAction(input: unknown): Promise<CompleteGateActionResult> {
  try {
    const user = await requirePermission("operacao.workflow.concluir");
    const data = completeGateSchema.parse(input);
    await assertStepVisible(user, data.stepId);
    // Motivo de exceção exige a chave própria (catálogo: checkedIn); o serviço confere de novo com o ator.
    if (data.exceptionReason) await requirePermission("operacao.workflow.concluir-com-excecao");
    const result = await completeGate({
      stepId: data.stepId,
      actor: actorOf(user),
      fields: data.fields as Record<string, unknown> | undefined,
      checklist: data.checklist,
      notes: data.notes || undefined,
      exceptionReason: data.exceptionReason || undefined,
    });
    revalidateStepPaths(result.step);
    if (result.status === "blocked") return blocked(result.evaluation, result.message);
    if (result.status === "awaiting_approval") return { ok: true, data: { status: "awaiting_approval", stepId: result.step.id, approverNames: result.approverNames } };
    return {
      ok: true,
      data: { status: "completed", stepId: result.step.id, nextStepId: result.nextStep?.id, nextStageName: result.nextStep?.stageName, instanceCompleted: result.instanceCompleted },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function approveGateAction(input: unknown): Promise<CompleteGateActionResult> {
  try {
    const user = await requirePermission("operacao.workflow.aprovar");
    const { stepId } = stepIdSchema.parse(input);
    await assertStepVisible(user, stepId);
    const result = await approveGate(stepId, actorOf(user));
    revalidateStepPaths(result.step);
    if (result.status === "blocked") return blocked(result.evaluation, result.message);
    if (result.status === "awaiting_approval") return { ok: true, data: { status: "awaiting_approval", stepId, approverNames: result.approverNames } };
    return { ok: true, data: { status: "completed", stepId, nextStepId: result.nextStep?.id, nextStageName: result.nextStep?.stageName, instanceCompleted: result.instanceCompleted } };
  } catch (error) {
    return fail(error);
  }
}

export async function rejectGateAction(input: unknown): Promise<ActionResult<{ stepId: string }>> {
  try {
    const user = await requirePermission("operacao.workflow.aprovar");
    const { stepId, reason } = rejectGateSchema.parse(input);
    await assertStepVisible(user, stepId);
    const step = await rejectGate(stepId, actorOf(user), reason);
    revalidateStepPaths(step);
    return { ok: true, data: { stepId } };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Aguardando cliente, retomar, reatribuir
// ---------------------------------------------------------------------------

export async function setWaitingClientAction(input: unknown): Promise<ActionResult<{ stepId: string }>> {
  try {
    const user = await requirePermission("operacao.workflow.pausar");
    const { stepId, reason } = waitingClientSchema.parse(input);
    await assertStepVisible(user, stepId);
    const step = await setStepWaitingClient(stepId, reason, actorOf(user));
    revalidateStepPaths(step);
    return { ok: true, data: { stepId } };
  } catch (error) {
    return fail(error);
  }
}

export async function resumeStepAction(input: unknown): Promise<ActionResult<{ stepId: string }>> {
  try {
    const user = await requirePermission("operacao.workflow.pausar");
    const { stepId } = stepIdSchema.parse(input);
    await assertStepVisible(user, stepId);
    const step = await resumeStep(stepId, actorOf(user));
    revalidateStepPaths(step);
    return { ok: true, data: { stepId } };
  } catch (error) {
    return fail(error);
  }
}

export async function reassignStepAction(input: unknown): Promise<ActionResult<{ stepId: string }>> {
  try {
    const user = await requirePermission("operacao.workflow.atribuir");
    const { stepId, assigneeId } = reassignStepSchema.parse(input);
    await assertStepVisible(user, stepId);
    const step = await reassignStep(stepId, assigneeId, actorOf(user));
    revalidateStepPaths(step);
    return { ok: true, data: { stepId } };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Checklist, campos e notas
// ---------------------------------------------------------------------------

export async function toggleStepChecklistAction(input: unknown): Promise<ActionResult<{ stepId: string; done: boolean }>> {
  try {
    const user = await requirePermission("operacao.workflow.editar");
    const { stepId, itemId, done } = toggleChecklistSchema.parse(input);
    await assertStepVisible(user, stepId);
    const step = await updateStepChecklist(stepId, [{ id: itemId, done }], actorOf(user));
    revalidateStepPaths(step);
    return { ok: true, data: { stepId, done } };
  } catch (error) {
    return fail(error);
  }
}

export async function updateStepFieldsAction(input: unknown): Promise<ActionResult<{ stepId: string }>> {
  try {
    const user = await requirePermission("operacao.workflow.editar");
    const { stepId, fields } = updateStepFieldsSchema.parse(input);
    await assertStepVisible(user, stepId);
    const step = await updateStepFields(stepId, fields as Record<string, unknown>, actorOf(user));
    revalidateStepPaths(step);
    return { ok: true, data: { stepId } };
  } catch (error) {
    return fail(error);
  }
}

export async function addStepNoteAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("operacao.workflow.editar");
    const { stepId, note } = addStepNoteSchema.parse(input);
    await assertStepVisible(user, stepId);
    const step = await loadStep(stepId);
    const comment = await addStepNote(stepId, note, actorOf(user));
    revalidateStepPaths(step);
    return { ok: true, data: { id: comment.id } };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------------------
// Admin de templates (catálogo admin.workflows.jornada.*; padrão: só admin)
// ---------------------------------------------------------------------------

/**
 * Salva o template. Versões publicadas são imutáveis: salvar a partir de uma publicada cria a versão
 * seguinte como rascunho (published=false); salvar um rascunho atualiza no lugar. Instâncias existentes
 * continuam na versão em que começaram (`templateVersion`).
 */
export async function saveWorkflowTemplateAction(input: unknown): Promise<ActionResult<{ id: string; version: number; created: boolean }>> {
  try {
    const user = await requirePermission("admin.workflows.jornada.editar");
    const data = saveTemplateSchema.parse(input);
    const source = await getById<WorkflowTemplate>(COLLECTIONS.workflowTemplates, data.id);
    if (!source) throw new BusinessError("Template não encontrado");
    const stages = data.stages.map((stage, index) => ({
      ...stage,
      order: index + 1,
      description: stage.description || undefined,
      defaultAssigneeRole: stage.defaultAssigneeRole || undefined,
      slaHours: stage.slaHours || undefined,
      slaRuleKey: stage.slaRuleKey || undefined,
      gate: {
        ...stage.gate,
        approverRole: stage.gate.requiresApproval ? stage.gate.approverRole : undefined,
        requiresDocuments: Boolean(stage.gate.requiresDocuments),
        requiredFields: stage.gate.requiredFields.map((f) => ({ ...f, options: f.type === "selecao" ? f.options?.filter(Boolean) : undefined })),
      },
      autoTasks: stage.autoTasks.map((t) => ({ ...t, description: t.description || undefined })),
    }));
    const actor = { id: user.id, name: user.name };

    if (!source.published) {
      await update<WorkflowTemplate>(COLLECTIONS.workflowTemplates, source.id, { name: data.name, description: data.description || undefined, stages });
      await emitEvent({
        type: "automation.executed",
        actor,
        entity: { type: "workflow_template", id: source.id },
        title: `Rascunho do template "${data.name}" v${source.version} atualizado`,
        payload: { templateKey: source.key, version: source.version, stages: stages.length, kind: "workflow_template.saved" },
      });
      revalidatePath("/admin/workflows");
      revalidatePath(`/admin/workflows/${source.id}`);
      return { ok: true, data: { id: source.id, version: source.version, created: false } };
    }

    const siblings = await list<WorkflowTemplate>(COLLECTIONS.workflowTemplates, { where: [["key", "==", source.key]] });
    const version = Math.max(...siblings.map((t) => t.version), 0) + 1;
    const created = await create<WorkflowTemplate>(COLLECTIONS.workflowTemplates, {
      key: source.key,
      name: data.name,
      description: data.description || undefined,
      version,
      published: false,
      stages,
      createdBy: user.id,
    });
    await emitEvent({
      type: "automation.executed",
      actor,
      entity: { type: "workflow_template", id: created.id },
      title: `Nova versão v${version} do template "${data.name}" criada (rascunho)`,
      payload: { templateKey: source.key, version, fromVersion: source.version, stages: stages.length, kind: "workflow_template.version_created" },
    });
    revalidatePath("/admin/workflows");
    revalidatePath(`/admin/workflows/${created.id}`);
    return { ok: true, data: { id: created.id, version, created: true } };
  } catch (error) {
    return fail(error);
  }
}

/** Publica a versão informada e despublica as demais do mesmo template. */
export async function publishWorkflowTemplateAction(input: unknown): Promise<ActionResult<{ id: string; version: number }>> {
  try {
    const user = await requirePermission("admin.workflows.jornada.publicar");
    const { id } = templateIdSchema.parse(input);
    const target = await getById<WorkflowTemplate>(COLLECTIONS.workflowTemplates, id);
    if (!target) throw new BusinessError("Template não encontrado");
    if (!target.stages || target.stages.length === 0) throw new BusinessError("Não é possível publicar um template sem etapas");
    const siblings = await list<WorkflowTemplate>(COLLECTIONS.workflowTemplates, { where: [["key", "==", target.key]] });
    const now = nowIso();
    for (const t of siblings) {
      if (t.id === id && !t.published) await update<WorkflowTemplate>(COLLECTIONS.workflowTemplates, t.id, { published: true, updatedAt: now });
      if (t.id !== id && t.published) await update<WorkflowTemplate>(COLLECTIONS.workflowTemplates, t.id, { published: false, updatedAt: now });
    }
    const active = await list<WorkflowInstance>(COLLECTIONS.workflowInstances, { where: [["templateKey", "==", target.key]] });
    await emitEvent({
      type: "automation.executed",
      actor: { id: user.id, name: user.name },
      entity: { type: "workflow_template", id },
      title: `Template "${target.name}" v${target.version} publicado`,
      description: `${active.filter((i) => i.status === "ativo").length} jornada(s) ativa(s) continuam na versão em que começaram.`,
      payload: { templateKey: target.key, version: target.version, kind: "workflow_template.published" },
    });
    revalidatePath("/admin/workflows");
    revalidatePath(`/admin/workflows/${id}`);
    revalidatePath("/workflow");
    return { ok: true, data: { id, version: target.version } };
  } catch (error) {
    return fail(error);
  }
}
