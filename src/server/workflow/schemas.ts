/**
 * Esquemas zod das Server Actions de workflow. Mensagens em português (chegam ao usuário via toast).
 */
import { z } from "zod";
import { DEPARTMENT_KEYS, PRIORITIES, ROLE_KEYS } from "@/domain/constants";

const idSchema = z.string().trim().min(1, "Identificador obrigatório");
const reasonSchema = z.string().trim().min(3, "Descreva o motivo (mínimo 3 caracteres)").max(1000, "Motivo muito longo (máx. 1000)");

/** Valores manuais do gate, chaveados pelo path do campo. */
export const gateFieldsSchema = z.record(z.string().min(1), z.union([z.string(), z.number(), z.boolean(), z.null()]).optional());

export const checklistUpdateSchema = z.array(z.object({ id: idSchema, done: z.boolean() })).max(100);

export const completeGateSchema = z.object({
  stepId: idSchema,
  fields: gateFieldsSchema.optional(),
  checklist: checklistUpdateSchema.optional(),
  notes: z.string().trim().max(2000, "Observação muito longa").optional(),
  exceptionReason: z.string().trim().max(1000, "Motivo de exceção muito longo").optional(),
});
export type CompleteGateInput = z.input<typeof completeGateSchema>;

export const stepIdSchema = z.object({ stepId: idSchema });

export const rejectGateSchema = z.object({ stepId: idSchema, reason: reasonSchema });

export const waitingClientSchema = z.object({ stepId: idSchema, reason: reasonSchema });

export const reassignStepSchema = z.object({ stepId: idSchema, assigneeId: idSchema });

export const toggleChecklistSchema = z.object({ stepId: idSchema, itemId: idSchema, done: z.boolean() });

export const updateStepFieldsSchema = z.object({ stepId: idSchema, fields: gateFieldsSchema });

export const addStepNoteSchema = z.object({ stepId: idSchema, note: z.string().trim().min(1, "Escreva uma nota").max(5000, "Nota muito longa") });

// ---------------------------------------------------------------------------
// Admin de templates
// ---------------------------------------------------------------------------

const label = (max: number, what: string) => z.string().trim().min(1, `${what} obrigatório`).max(max, `${what} muito longo (máx. ${max})`);
const keySchema = z
  .string()
  .trim()
  .min(1, "Chave obrigatória")
  .max(40, "Chave muito longa")
  .regex(/^[a-z0-9_.-]+$/, "Chave deve ter só letras minúsculas, números, ponto, hífen ou sublinhado");

export const gateFieldSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1, "Path do campo obrigatório")
    .max(120, "Path muito longo")
    .regex(/^[a-zA-Z0-9_.]+$/, "Path deve ser no formato objeto.campo (ex.: lead.phone)"),
  label: label(120, "Rótulo do campo"),
  type: z.enum(["texto", "numero", "data", "booleano", "selecao"], { message: "Tipo de campo inválido" }),
  options: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
});

export const stageSchema = z.object({
  key: keySchema,
  name: label(80, "Nome da etapa"),
  department: z.enum(DEPARTMENT_KEYS, { message: "Departamento inválido" }),
  description: z.string().trim().max(500, "Descrição muito longa").optional(),
  defaultAssigneeRole: z.enum(ROLE_KEYS, { message: "Papel inválido" }).optional(),
  slaHours: z.number().positive("Horas de SLA devem ser positivas").max(5000, "Horas de SLA acima do limite").optional(),
  slaRuleKey: z.string().trim().max(60).optional(),
  gate: z.object({
    name: label(80, "Nome do gate"),
    requiredFields: z.array(gateFieldSchema).max(30, "No máximo 30 campos obrigatórios"),
    checklist: z.array(z.object({ key: keySchema, label: label(200, "Item do checklist"), required: z.boolean() })).max(50, "No máximo 50 itens de checklist"),
    requiresApproval: z.boolean(),
    approverRole: z.enum(ROLE_KEYS, { message: "Papel aprovador inválido" }).optional(),
    requiresDocuments: z.boolean().optional(),
    exitCriteria: z.string().trim().max(500, "Critério de saída muito longo"),
  }),
  autoTasks: z
    .array(
      z.object({
        title: label(200, "Título da tarefa"),
        description: z.string().trim().max(1000).optional(),
        dueInHours: z.number().positive("Prazo em horas deve ser positivo").max(5000, "Prazo acima do limite"),
        priority: z.enum(PRIORITIES, { message: "Prioridade inválida" }),
      }),
    )
    .max(20, "No máximo 20 tarefas automáticas"),
});

export const saveTemplateSchema = z
  .object({
    /** Versão de origem (publicada → cria nova versão; rascunho → atualiza no lugar). */
    id: idSchema,
    name: label(120, "Nome do template"),
    description: z.string().trim().max(500, "Descrição muito longa").optional(),
    stages: z.array(stageSchema).min(1, "O template precisa de pelo menos uma etapa").max(20, "No máximo 20 etapas"),
  })
  .superRefine((value, ctx) => {
    const keys = new Set<string>();
    value.stages.forEach((stage, index) => {
      if (keys.has(stage.key)) ctx.addIssue({ code: "custom", message: `Chave de etapa repetida: ${stage.key}`, path: ["stages", index, "key"] });
      keys.add(stage.key);
      if (stage.gate.requiresApproval && !stage.gate.approverRole) ctx.addIssue({ code: "custom", message: `Etapa ${stage.name}: informe o papel aprovador`, path: ["stages", index, "gate", "approverRole"] });
    });
  });
export type SaveTemplateInput = z.input<typeof saveTemplateSchema>;

export const templateIdSchema = z.object({ id: idSchema });
