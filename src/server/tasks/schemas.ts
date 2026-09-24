/**
 * Esquemas zod das Server Actions de tarefas. Mensagens em português (chegam ao usuário via toast).
 */
import { z } from "zod";
import { DEPARTMENT_KEYS, PRIORITIES, TASK_STATUS } from "@/domain/constants";

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), { message: "Data inválida" });
const idSchema = z.string().trim().min(1, "Identificador obrigatório");

export const recurrenceSchema = z.object({
  freq: z.enum(["diaria", "semanal", "mensal"], { message: "Frequência inválida" }),
  interval: z.number().int("Intervalo deve ser inteiro").min(1, "Intervalo mínimo é 1").max(365, "Intervalo máximo é 365"),
  until: isoDate.optional(),
});

const titleSchema = z.string().trim().min(3, "Informe um título com pelo menos 3 caracteres").max(200, "Título muito longo (máx. 200)");
const descriptionSchema = z.string().trim().max(5000, "Descrição muito longa (máx. 5000)");
const tagsSchema = z
  .array(z.string().trim().min(1).max(40, "Tag muito longa"))
  .max(20, "No máximo 20 tags")
  .transform((tags) => Array.from(new Set(tags.map((t) => t.toLowerCase()))));
const checklistLabelSchema = z.string().trim().min(1, "Item do checklist vazio").max(200, "Item do checklist muito longo");

export const PROCESS_TYPES = ["workflow", "lead", "opportunity", "contract", "project", "ticket", "cs", "renewal", "prospect"] as const;

export const createTaskSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.optional(),
  clientId: z.string().trim().optional(),
  assigneeId: z.string().trim().optional(),
  departmentId: z.enum(DEPARTMENT_KEYS, { message: "Departamento inválido" }),
  priority: z.enum(PRIORITIES, { message: "Prioridade inválida" }).default("media"),
  dueAt: isoDate.optional(),
  startAt: isoDate.optional(),
  checklist: z.array(checklistLabelSchema).max(50, "No máximo 50 itens de checklist").default([]),
  tags: tagsSchema.default([]),
  recurrence: recurrenceSchema.optional(),
  processType: z.enum(PROCESS_TYPES).optional(),
  processId: z.string().trim().optional(),
});
export type CreateTaskInput = z.input<typeof createTaskSchema>;

/** Atualização parcial. `null` limpa o campo. */
export const updateTaskSchema = z.object({
  id: idSchema,
  title: titleSchema.optional(),
  description: descriptionSchema.nullable().optional(),
  clientId: z.string().trim().nullable().optional(),
  assigneeId: z.string().trim().nullable().optional(),
  departmentId: z.enum(DEPARTMENT_KEYS, { message: "Departamento inválido" }).optional(),
  priority: z.enum(PRIORITIES, { message: "Prioridade inválida" }).optional(),
  dueAt: isoDate.nullable().optional(),
  startAt: isoDate.nullable().optional(),
  tags: tagsSchema.optional(),
  recurrence: recurrenceSchema.nullable().optional(),
});
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

export const taskIdSchema = z.object({ id: idSchema });

export const changeTaskStatusSchema = z.object({
  id: idSchema,
  status: z.enum(TASK_STATUS, { message: "Status inválido" }),
});

export const cancelTaskSchema = z.object({
  id: idSchema,
  reason: z.string().trim().max(500, "Motivo muito longo").optional(),
});

export const assignTaskSchema = z.object({
  id: idSchema,
  assigneeId: idSchema,
});

export const checklistItemSchema = z.object({
  id: idSchema,
  itemId: idSchema,
});

export const addChecklistItemSchema = z.object({
  id: idSchema,
  label: checklistLabelSchema,
});

export const addCommentSchema = z.object({
  taskId: idSchema,
  body: z.string().trim().min(1, "Escreva um comentário").max(5000, "Comentário muito longo"),
});

export const reorderTaskSchema = z.object({
  status: z.enum(TASK_STATUS, { message: "Status inválido" }),
  orderedIds: z.array(idSchema).min(1).max(500),
});
