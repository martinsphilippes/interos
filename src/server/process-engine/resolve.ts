import "server-only";
/**
 * Resolução usada tanto na execução real quanto no teste a seco: responsáveis, destinatários, contexto de
 * avaliação e condições. Reaproveita os resolvedores do motor de automações (papéis, gestor do departamento,
 * dono do cliente) para não haver duas regras de atribuição no sistema.
 */
import { getById } from "@/server/db";
import { ENTITY_COLLECTIONS, cachedUsers, clientOwnerFor, managerOf, resolveRecipients, type AutomationContext } from "@/server/automations/actions-registry";
import { compare, getPath } from "@/server/automations/conditions";
import { COLLECTIONS, type BaseEntity, type Client } from "@/domain/types";
import { DEPARTMENT_LABELS, ROLE_LABELS, type DepartmentKey, type RoleKey } from "@/domain/constants";
import {
  CLIENT_OWNER_FIELDS,
  CLIENT_OWNER_LABELS,
  PROCESS_CONDITION_OPERATOR_LABELS,
  type ClientOwnerField,
  type ConditionNodeData,
  type ProcessOutcome,
  type ProcessRunContext,
} from "@/domain/workflow-graph";

export interface ResolvedAssignee {
  id?: string;
  name?: string;
  /** Texto de como foi resolvido ("Gestor de Financeiro", "papel Customer Success"...). */
  how: string;
  /** true quando a regra não achou ninguém e caiu no gestor do departamento. */
  fallback: boolean;
}

function minimalCtx(client: Client | null, department: DepartmentKey | undefined): AutomationContext {
  return {
    now: new Date().toISOString(),
    rule: { id: "process", name: "Processo" },
    payload: {},
    client: client ?? undefined,
    department: department ? { key: department, name: DEPARTMENT_LABELS[department] } : undefined,
  };
}

/** Descrição legível de uma especificação de responsável. */
export function describeAssigneeSpec(spec: string, department?: DepartmentKey): string {
  if (spec === "gestor_departamento") return department ? `Gestor de ${DEPARTMENT_LABELS[department]}` : "Gestor do departamento";
  if (spec.startsWith("papel:")) return `Papel ${ROLE_LABELS[spec.slice(6) as RoleKey] ?? spec.slice(6)}`;
  if (spec.startsWith("responsavel_cliente")) {
    const field = spec.split(":")[1] as ClientOwnerField | undefined;
    return field && CLIENT_OWNER_LABELS[field] ? CLIENT_OWNER_LABELS[field] : "Responsável do cliente";
  }
  if (spec.startsWith("departamento:")) return `Equipe de ${DEPARTMENT_LABELS[spec.slice(13) as DepartmentKey] ?? spec.slice(13)}`;
  return "Usuário específico";
}

/** Responsável de uma tarefa do processo; sem resultado, cai no gestor do departamento. */
export async function resolveAssignee(spec: string, department: DepartmentKey, client: Client | null): Promise<ResolvedAssignee> {
  const users = await cachedUsers();
  const active = (id: string | undefined) => (id && users.has(id) && users.get(id)?.active !== false ? id : undefined);
  let id: string | undefined;
  const s = spec.trim();
  if (s === "gestor_departamento") id = await managerOf(department);
  else if (s.startsWith("responsavel_cliente")) {
    const field = s.split(":")[1] as ClientOwnerField | undefined;
    id = active(field && (CLIENT_OWNER_FIELDS as readonly string[]).includes(field) ? client?.[field] : client ? clientOwnerFor(client, department) : undefined);
  } else if (s.startsWith("papel:") || s.startsWith("departamento:")) {
    id = (await resolveRecipients(s, minimalCtx(client, department), { mode: "assignee", department })).ids[0];
  } else id = active(s);

  let fallback = false;
  if (!id) {
    id = await managerOf(department);
    fallback = true;
  }
  const how = describeAssigneeSpec(s, department) + (fallback ? ` (não encontrado; usado o gestor de ${DEPARTMENT_LABELS[department]})` : "");
  return { id, name: id ? users.get(id)?.name : undefined, how, fallback };
}

/** Destinatários de uma notificação (lista separada por vírgula; mesmos formatos do responsável). */
export async function resolveNotifyRecipients(to: string, department: DepartmentKey | undefined, client: Client | null): Promise<{ ids: string[]; names: string[]; unresolved: string[] }> {
  const users = await cachedUsers();
  const ids: string[] = [];
  const unresolved: string[] = [];
  for (const raw of to.split(",").map((s) => s.trim()).filter(Boolean)) {
    let found: string[] = [];
    if (raw.startsWith("responsavel_cliente:")) {
      const field = raw.split(":")[1] as ClientOwnerField;
      const id = (CLIENT_OWNER_FIELDS as readonly string[]).includes(field) ? client?.[field] : undefined;
      found = id && users.get(id)?.active !== false && users.has(id) ? [id] : [];
    } else {
      found = (await resolveRecipients(raw, minimalCtx(client, department), { mode: "notify", department })).ids;
    }
    if (found.length === 0) unresolved.push(raw);
    for (const id of found) if (!ids.includes(id)) ids.push(id);
  }
  return { ids, names: ids.map((id) => users.get(id)?.name ?? id), unresolved };
}

/** Departamento natural de um papel aprovador (o do primeiro usuário ativo com o papel). */
export async function approverDepartment(role: RoleKey): Promise<DepartmentKey> {
  const users = await cachedUsers();
  return Array.from(users.values()).find((u) => u.active !== false && u.role === role)?.departmentId ?? "diretoria";
}

/** Título da tarefa de aprovação ("Aprovar plano" fica como está; "Desconto" vira "Aprovar: Desconto"). */
export function approvalTitle(label: string): string {
  return /^aprova/i.test(label.trim()) ? label : `Aprovar: ${label}`;
}

export interface EvalContext {
  now: string;
  client?: Client;
  entity?: Record<string, unknown> & { id: string };
  entityType?: string;
  payload: Record<string, unknown>;
  outcomes: Record<string, ProcessOutcome>;
  [alias: string]: unknown;
}

/** Contexto lido na hora da avaliação (cliente e entidade frescos do banco, não a foto do início). */
export async function buildEvalContext(input: { clientId?: string; entity?: { type: string; id: string }; context: Pick<ProcessRunContext, "payload" | "outcomes"> }): Promise<EvalContext> {
  const client = input.clientId ? await getById<Client>(COLLECTIONS.clients, input.clientId) : null;
  const collection = input.entity ? ENTITY_COLLECTIONS[input.entity.type] : undefined;
  const entity = collection && input.entity ? await getById<BaseEntity & Record<string, unknown>>(collection, input.entity.id) : null;
  const ctx: EvalContext = {
    now: new Date().toISOString(),
    client: client ?? undefined,
    entity: entity ?? undefined,
    entityType: input.entity?.type,
    payload: input.context.payload ?? {},
    outcomes: input.context.outcomes ?? {},
  };
  // Apelido pelo tipo ("billing.status", "cs_account.ownerId"), como no motor de automações.
  if (entity && input.entity) ctx[input.entity.type] = entity;
  return ctx;
}

export interface ConditionEvaluation {
  outcome: ProcessOutcome;
  detail: string;
}

/** Avalia um nó de condição: resposta Sim/Não de um nó anterior ou comparação de um campo do contexto. */
export function evaluateCondition(data: ConditionNodeData, ctx: EvalContext, labelOf: (nodeId: string) => string): ConditionEvaluation {
  if (data.mode === "resultado") {
    const answer = data.fromNode ? ctx.outcomes[data.fromNode] : undefined;
    const source = data.fromNode ? labelOf(data.fromNode) : "etapa anterior";
    if (!answer) return { outcome: "nao", detail: `Sem resposta registrada em "${source}"; seguiu por Não` };
    return { outcome: answer, detail: `Resposta de "${source}": ${answer === "sim" ? "Sim" : "Não"}` };
  }
  const path = data.path ?? "";
  const operator = data.operator ?? "==";
  const actual = getPath(ctx, path);
  const ok = compare(actual, operator, data.value);
  const shown = actual === undefined || actual === null || actual === "" ? "vazio" : typeof actual === "object" ? "[objeto]" : String(actual);
  return {
    outcome: ok ? "sim" : "nao",
    detail: `${path} ${PROCESS_CONDITION_OPERATOR_LABELS[operator]}${operator === "exists" ? "" : ` "${data.value ?? ""}"`} → valor atual "${shown}": ${ok ? "Sim" : "Não"}`,
  };
}
