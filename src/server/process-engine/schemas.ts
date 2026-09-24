/**
 * Validação zod das entradas das Server Actions do construtor de processos. Sem dependências de servidor.
 */
import { z } from "zod";
import { DEPARTMENT_KEYS, EVENT_TYPES, NOTIFICATION_KINDS, PRIORITIES, ROLE_KEYS } from "@/domain/constants";
import { PROCESS_CONDITION_OPERATORS } from "@/domain/workflow-graph";

const id = z.string().trim().min(1, "Identificador obrigatório").max(120);
const label = z.string().trim().max(120);
const position = z.object({ x: z.number().finite(), y: z.number().finite() });
const texts = z.array(z.string().trim().max(160)).max(40).transform((items) => items.filter(Boolean));

const nodeSchema = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("inicio"), position, data: z.object({ label }) }),
  z.object({ id, type: z.literal("fim"), position, data: z.object({ label }) }),
  z.object({
    id,
    type: z.literal("tarefa"),
    position,
    data: z.object({
      label,
      description: z.string().trim().max(2000).optional(),
      department: z.enum(DEPARTMENT_KEYS),
      assignee: z.string().trim().min(1, "Escolha o responsável padrão").max(160),
      priority: z.enum(PRIORITIES).default("media"),
      dueBusinessDays: z.number().int().min(0).max(365),
      slaHours: z.number().min(0).max(2000),
      requiredFields: texts,
      checklist: texts,
      autoCreateTask: z.boolean(),
      notify: z.boolean(),
      outcome: z.literal("sim_nao").optional(),
      outcomeQuestion: z.string().trim().max(160).optional(),
    }),
  }),
  z.object({
    id,
    type: z.literal("aprovacao"),
    position,
    data: z.object({ label, approverRole: z.enum(ROLE_KEYS), department: z.enum(DEPARTMENT_KEYS).optional(), slaHours: z.number().min(0).max(2000) }),
  }),
  z.object({
    id,
    type: z.literal("condicao"),
    position,
    data: z.object({
      label,
      mode: z.enum(["contexto", "resultado"]),
      path: z.string().trim().max(160).optional(),
      operator: z.enum(PROCESS_CONDITION_OPERATORS).optional(),
      value: z.string().trim().max(200).optional(),
      fromNode: z.string().trim().max(120).optional(),
    }),
  }),
  z.object({
    id,
    type: z.literal("espera"),
    position,
    data: z.object({ label, mode: z.enum(["horas_uteis", "evento"]), businessHours: z.number().min(0).max(2000).optional(), untilEvent: z.enum(EVENT_TYPES).optional() }),
  }),
  z.object({
    id,
    type: z.literal("notificacao"),
    position,
    data: z.object({
      label,
      to: z.string().trim().max(300),
      department: z.enum(DEPARTMENT_KEYS).optional(),
      kind: z.enum(NOTIFICATION_KINDS),
      title: z.string().trim().max(200),
      body: z.string().trim().max(2000).optional(),
    }),
  }),
  z.object({
    id,
    type: z.literal("integracao"),
    position,
    data: z.object({ label, url: z.string().trim().max(500), method: z.enum(["GET", "POST", "PUT", "PATCH"]) }),
  }),
]);

const handle = z.string().trim().max(20).optional();
const edgeSchema = z.object({ id, source: id, target: id, label: z.string().trim().max(40).optional(), sourceHandle: handle, targetHandle: handle });

const triggerSchema = z.discriminatedUnion("type", [z.object({ type: z.literal("evento"), eventType: z.enum(EVENT_TYPES) }), z.object({ type: z.literal("manual") })]);

export const graphSchema = z.object({
  name: z.string().trim().min(3, "Nome com pelo menos 3 caracteres").max(120),
  description: z.string().trim().max(500).optional(),
  trigger: triggerSchema,
  nodes: z.array(nodeSchema).max(200),
  edges: z.array(edgeSchema).max(400),
});

export const saveDefinitionSchema = graphSchema.extend({ id });
export const createDefinitionSchema = z.object({
  name: z.string().trim().min(3, "Nome com pelo menos 3 caracteres").max(120),
  description: z.string().trim().max(500).optional(),
});
export const definitionIdSchema = z.object({ id });
export const simulateSchema = z.object({
  graph: graphSchema,
  clientId: id,
  answers: z.record(z.string(), z.enum(["sim", "nao"])).default({}),
});
export const completeProcessTaskSchema = z.object({ taskId: id, outcome: z.enum(["sim", "nao"]).optional() });
export const answerOutcomeSchema = z.object({ runId: id, nodeId: id, outcome: z.enum(["sim", "nao"]) });
export const completeNodeSchema = z.object({ runId: id, nodeId: id, outcome: z.enum(["sim", "nao"]).optional() });
export const cancelRunSchema = z.object({ runId: id, reason: z.string().trim().max(500).optional() });
export const startManualRunSchema = z.object({ definitionId: id, clientId: id.optional() });

export type GraphInput = z.infer<typeof graphSchema>;
