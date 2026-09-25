import "server-only";
/**
 * Teste a seco ("Testar fluxo"): percorre o grafo com um cliente real e mostra o caminho, as tarefas que seriam
 * criadas, os responsáveis resolvidos, prazos e SLAs. NÃO grava nada.
 *
 * Decisões humanas (tarefas com resultado e aprovações) usam a resposta escolhida na tela (padrão: Sim);
 * condições de contexto são avaliadas com os dados atuais do cliente e de um registro de exemplo do tipo que o
 * gatilho carrega (ex.: a cobrança mais recente do cliente para payment.overdue).
 */
import { getById, list } from "@/server/db";
import { ENTITY_COLLECTIONS } from "@/server/automations/actions-registry";
import { renderTemplate } from "@/server/automations/conditions";
import { addBusinessHours, businessDaysToHours, getHolidays } from "@/server/sla";
import { formatDateTime } from "@/lib/format";
import { COLLECTIONS, type BaseEntity, type Client } from "@/domain/types";
import { DEPARTMENT_LABELS, type DepartmentKey } from "@/domain/constants";
import {
  PROCESS_NODE_LABELS,
  TRIGGER_ENTITY_TYPES,
  nextEdges,
  nodeHasOutcome,
  validateProcessGraph,
  type GraphIssue,
  type ProcessDefinition,
  type ProcessNode,
  type ProcessNodeType,
  type ProcessOutcome,
} from "@/domain/workflow-graph";
import { approvalTitle, approverDepartment, buildEvalContext, evaluateCondition, resolveAssignee, resolveNotifyRecipients } from "./resolve";

export interface SimulatedTask {
  title: string;
  department: string;
  assigneeName: string;
  assigneeHow: string;
  fallback: boolean;
  dueAt?: string;
  slaHours: number;
  slaDueAt?: string;
  checklist: { label: string; required: boolean }[];
  question?: string;
}

export interface SimulationStep {
  nodeId: string;
  label: string;
  type: ProcessNodeType;
  via?: string;
  result: string;
  detail: string;
  task?: SimulatedTask;
  /** Nó com decisão Sim/Não escolhida na simulação. */
  decision?: ProcessOutcome;
}

export interface SimulationResult {
  client: { id: string; name: string };
  entity?: { type: string; id: string; label: string };
  steps: SimulationStep[];
  pathNodeIds: string[];
  pathEdgeIds: string[];
  tasksCount: number;
  ending: "fim" | "laco" | "limite";
  issues: GraphIssue[];
}

type SimulatableDefinition = Pick<ProcessDefinition, "name" | "trigger" | "nodes" | "edges">;

/** Registro de exemplo do tipo que o gatilho carrega, do próprio cliente. */
async function sampleEntity(def: SimulatableDefinition, client: Client): Promise<{ type: string; id: string; label: string } | undefined> {
  const type = def.trigger.type === "evento" ? TRIGGER_ENTITY_TYPES[def.trigger.eventType] : undefined;
  if (!type || type === "client") return type ? { type, id: client.id, label: client.tradeName } : undefined;
  const collection = ENTITY_COLLECTIONS[type];
  if (!collection) return undefined;
  const items = await list<BaseEntity & Record<string, unknown>>(collection, { where: [["clientId", "==", client.id]] });
  if (items.length === 0) return undefined;
  // Cobrança: prefere uma vencida ou em aberto, que é o caso real do gatilho.
  const rank = (i: Record<string, unknown>) => (i.status === "vencida" ? 2 : i.status === "aberta" ? 1 : 0);
  items.sort((a, b) => rank(b) - rank(a) || (a.updatedAt < b.updatedAt ? 1 : -1));
  const pick = items[0];
  const label = [pick.number, pick.title, pick.name, pick.subject, pick.type && pick.amount ? `${String(pick.type)} ${String(pick.amount)}` : undefined, pick.status].find(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  return { type, id: pick.id, label: label ?? pick.id };
}

export async function simulateProcess(def: SimulatableDefinition, clientId: string, answers: Record<string, ProcessOutcome> = {}): Promise<SimulationResult> {
  const client = await getById<Client>(COLLECTIONS.clients, clientId);
  if (!client) throw new Error("Cliente não encontrado");
  const issues = validateProcessGraph(def);
  const nodes = new Map(def.nodes.map((n) => [n.id, n]));
  const start = def.nodes.find((n) => n.type === "inicio");
  if (!start) throw new Error("O processo não tem bloco Início");

  const entity = await sampleEntity(def, client);
  const outcomes: Record<string, ProcessOutcome> = {};
  const ctx = await buildEvalContext({ clientId: client.id, entity, context: { payload: {}, outcomes } });
  const holidays = await getHolidays();
  // O relógio avança com as esperas, para os prazos simulados serem realistas.
  let clock = new Date();

  const steps: SimulationStep[] = [];
  const pathEdgeIds: string[] = [];
  const visited = new Set<string>();
  const queue: { node: ProcessNode; via?: string }[] = [{ node: start }];
  let ending: SimulationResult["ending"] = "fim";

  while (queue.length > 0) {
    if (steps.length > 80) {
      ending = "limite";
      break;
    }
    const { node, via } = queue.shift() as { node: ProcessNode; via?: string };
    if (via) pathEdgeIds.push(via);
    if (visited.has(node.id)) {
      steps.push({ nodeId: node.id, label: node.data.label, type: node.type, via, result: "laco", detail: `O fluxo voltaria para "${node.data.label}" (etapa repetida; a simulação para aqui)` });
      ending = "laco";
      continue;
    }
    visited.add(node.id);

    const step: SimulationStep = { nodeId: node.id, label: node.data.label, type: node.type, via, result: "ok", detail: "" };
    let outcome: ProcessOutcome | undefined;
    switch (node.type) {
      case "inicio":
        step.detail = def.trigger.type === "evento" ? `Gatilho: evento ${def.trigger.eventType}${entity ? ` (exemplo: ${entity.label})` : ""}` : "Início manual";
        break;
      case "fim":
        step.detail = "Processo concluído";
        break;
      case "tarefa":
      case "aprovacao": {
        const isApproval = node.type === "aprovacao";
        const department: DepartmentKey = isApproval ? (node.data.department ?? (await approverDepartment(node.data.approverRole))) : node.data.department;
        const assignee = await resolveAssignee(isApproval ? `papel:${node.data.approverRole}` : node.data.assignee, department, client);
        const dueDays = isApproval ? 0 : node.data.dueBusinessDays;
        const dueAt = dueDays > 0 ? addBusinessHours(clock, businessDaysToHours(dueDays), holidays).toISOString() : undefined;
        const slaDueAt = node.data.slaHours > 0 ? addBusinessHours(clock, node.data.slaHours, holidays).toISOString() : undefined;
        const manual = node.type === "tarefa" && !node.data.autoCreateTask;
        step.task = manual
          ? undefined
          : {
              title: isApproval ? approvalTitle(node.data.label) : node.data.label,
              department: DEPARTMENT_LABELS[department],
              assigneeName: assignee.name ?? "sem responsável",
              assigneeHow: assignee.how,
              fallback: assignee.fallback,
              dueAt,
              slaHours: node.data.slaHours,
              slaDueAt,
              checklist: isApproval ? [] : [...node.data.requiredFields.map((label) => ({ label, required: true })), ...node.data.checklist.map((label) => ({ label, required: false }))],
              question: isApproval ? "Aprovar ou reprovar?" : node.data.outcome === "sim_nao" ? node.data.outcomeQuestion || node.data.label : undefined,
            };
        step.detail = manual ? "Etapa manual (sem tarefa automática): seria concluída na tela de execuções" : `Criaria a tarefa para ${assignee.name ?? "ninguém"}`;
        if (nodeHasOutcome(node)) {
          outcome = answers[node.id] ?? "sim";
          outcomes[node.id] = outcome;
          step.decision = outcome;
          step.result = outcome;
        }
        break;
      }
      case "condicao": {
        const result = evaluateCondition(node.data, { ...ctx, outcomes }, (id) => nodes.get(id)?.data.label ?? id);
        outcome = result.outcome;
        outcomes[node.id] = outcome;
        step.result = outcome;
        step.detail = result.detail;
        break;
      }
      case "espera":
        if (node.data.mode === "evento") step.detail = `Aguardaria o evento ${node.data.untilEvent ?? "—"}`;
        else {
          clock = addBusinessHours(clock, Number(node.data.businessHours) || 0, holidays);
          step.detail = `Aguardaria ${node.data.businessHours ?? 0}h úteis (até ${formatDateTime(clock)})`;
        }
        break;
      case "notificacao": {
        const { names, unresolved } = await resolveNotifyRecipients(node.data.to, node.data.department, client);
        step.detail = names.length
          ? `Notificaria ${names.join(", ")}: "${renderTemplate(node.data.title, ctx)}"${unresolved.length ? ` · sem destinatário para ${unresolved.join(", ")}` : ""}`
          : `Nenhum destinatário encontrado para ${node.data.to}`;
        break;
      }
      case "integracao":
        step.detail = `${process.env.AUTOMATION_WEBHOOKS_ENABLED === "true" ? "Chamaria" : "Simularia (webhooks desligados)"} ${node.data.method} ${node.data.url}`;
        break;
    }
    if (!step.detail) step.detail = PROCESS_NODE_LABELS[node.type];
    steps.push(step);

    for (const e of nextEdges(def.edges, node.id, outcome)) {
      const target = nodes.get(e.target);
      if (target) queue.push({ node: target, via: e.id });
    }
  }

  return {
    client: { id: client.id, name: client.tradeName },
    entity,
    steps,
    pathNodeIds: Array.from(visited),
    pathEdgeIds,
    tasksCount: steps.filter((s) => s.task).length,
    ending,
    issues,
  };
}
