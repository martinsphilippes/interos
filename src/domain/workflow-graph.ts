/**
 * Modelo dos PROCESSOS com ramificações (construtor visual de workflows).
 *
 * A jornada de 6 etapas (workflow_templates / workflow_instances) continua existindo à parte. Processos são
 * grafos de nós (início, tarefa, aprovação, condição, espera, notificação, integração, fim) executados pelo
 * motor em src/server/process-engine, que usa as MESMAS tarefas, SLAs, notificações e eventos do sistema.
 *
 * Coleções (a incluir em COLLECTIONS pelo integrador): process_definitions e process_runs.
 * Sem dependências de servidor: pode ser importado por Client Components.
 */
import type { BaseEntity, UserRef } from "./types";
import type { DepartmentKey, EventType, NotificationKind, Priority, RoleKey } from "./constants";

export const PROCESS_COLLECTIONS = {
  processDefinitions: "process_definitions",
  processRuns: "process_runs",
} as const;

// ---------------------------------------------------------------------------
// Nós
// ---------------------------------------------------------------------------

export const PROCESS_NODE_TYPES = ["inicio", "tarefa", "aprovacao", "condicao", "espera", "notificacao", "integracao", "fim"] as const;
export type ProcessNodeType = (typeof PROCESS_NODE_TYPES)[number];

export const PROCESS_NODE_LABELS: Record<ProcessNodeType, string> = {
  inicio: "Início",
  tarefa: "Tarefa",
  aprovacao: "Aprovação",
  condicao: "Condição",
  espera: "Espera",
  notificacao: "Notificação",
  integracao: "Integração",
  fim: "Fim",
};

export const PROCESS_NODE_DESCRIPTIONS: Record<ProcessNodeType, string> = {
  inicio: "Ponto de partida do processo (gatilho).",
  tarefa: "Cria uma tarefa na Central de Tarefas com responsável, prazo e SLA.",
  aprovacao: "Tarefa de aprovação para um papel: aprovar ou reprovar.",
  condicao: "Desvia o fluxo em Sim/Não conforme um dado ou uma resposta anterior.",
  espera: "Aguarda horas úteis ou a ocorrência de um evento.",
  notificacao: "Envia uma notificação interna.",
  integracao: "Chama um webhook externo (respeita AUTOMATION_WEBHOOKS_ENABLED).",
  fim: "Encerra o processo.",
};

/**
 * Responsável de uma tarefa:
 * "papel:<role>" · "gestor_departamento" · "responsavel_cliente:<ownerSalesId|ownerCsId|ownerImplementationId>" · ID de usuário.
 */
export type AssigneeSpec = string;

export const CLIENT_OWNER_FIELDS = ["ownerSalesId", "ownerImplementationId", "ownerCsId"] as const;
export type ClientOwnerField = (typeof CLIENT_OWNER_FIELDS)[number];
export const CLIENT_OWNER_LABELS: Record<ClientOwnerField, string> = {
  ownerSalesId: "Vendedor do cliente",
  ownerImplementationId: "Responsável de implantação do cliente",
  ownerCsId: "Responsável de CS do cliente",
};

export type StartNodeData = { label: string };

export type TaskNodeData = {
  label: string;
  description?: string;
  department: DepartmentKey;
  assignee: AssigneeSpec;
  priority: Priority;
  /** Prazo da tarefa em dias úteis (0 = sem prazo). */
  dueBusinessDays: number;
  /** SLA da tarefa em horas úteis (0 = sem SLA). */
  slaHours: number;
  /** Itens obrigatórios (viram itens de checklist obrigatórios da tarefa). */
  requiredFields: string[];
  /** Itens opcionais de checklist. */
  checklist: string[];
  /** Ao entrar na etapa: criar a tarefa automaticamente (senão a etapa é concluída na tela de execuções). */
  autoCreateTask: boolean;
  /** Ao entrar na etapa: notificar o responsável. */
  notify: boolean;
  /** Decisão humana: a conclusão pede Sim/Não (lido por uma condição com fromNode). */
  outcome?: "sim_nao";
  /** Pergunta exibida ao concluir (ex.: "Cliente homologou?"). */
  outcomeQuestion?: string;
};

export type ApprovalNodeData = {
  label: string;
  approverRole: RoleKey;
  /** Departamento da tarefa de aprovação (padrão: o do aprovador). */
  department?: DepartmentKey;
  slaHours: number;
};

export const PROCESS_CONDITION_OPERATORS = ["==", "!=", ">", "<", ">=", "<=", "contains", "exists"] as const;
export type ProcessConditionOperator = (typeof PROCESS_CONDITION_OPERATORS)[number];
export const PROCESS_CONDITION_OPERATOR_LABELS: Record<ProcessConditionOperator, string> = {
  "==": "é igual a",
  "!=": "é diferente de",
  ">": "maior que",
  "<": "menor que",
  ">=": "maior ou igual a",
  "<=": "menor ou igual a",
  contains: "contém",
  exists: "está preenchido",
};

export type ConditionNodeData = {
  label: string;
  /** "contexto": compara um caminho do contexto; "resultado": lê o Sim/Não de uma tarefa/aprovação anterior. */
  mode: "contexto" | "resultado";
  path?: string;
  operator?: ProcessConditionOperator;
  value?: string;
  fromNode?: string;
};

export type WaitNodeData = {
  label: string;
  mode: "horas_uteis" | "evento";
  businessHours?: number;
  untilEvent?: EventType;
};

export type NotificationNodeData = {
  label: string;
  /** Mesmos formatos de destinatário das tarefas, mais "departamento:<key>". */
  to: string;
  /** Departamento usado por "gestor_departamento" e para preferir quem tem o papel. */
  department?: DepartmentKey;
  kind: NotificationKind;
  title: string;
  body?: string;
};

export type IntegrationNodeData = {
  label: string;
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
};

export type EndNodeData = { label: string };

export interface ProcessNodeDataMap {
  inicio: StartNodeData;
  tarefa: TaskNodeData;
  aprovacao: ApprovalNodeData;
  condicao: ConditionNodeData;
  espera: WaitNodeData;
  notificacao: NotificationNodeData;
  integracao: IntegrationNodeData;
  fim: EndNodeData;
}

export type ProcessNodeOf<T extends ProcessNodeType> = {
  id: string;
  type: T;
  position: { x: number; y: number };
  data: ProcessNodeDataMap[T];
};

export type ProcessNode = { [T in ProcessNodeType]: ProcessNodeOf<T> }[ProcessNodeType];

export type EdgeLabel = "sim" | "nao" | (string & {});

export interface ProcessEdge {
  id: string;
  source: string;
  target: string;
  /** Saídas de condição (e de tarefa/aprovação com resultado): "sim" | "nao". */
  label?: EdgeLabel;
  /** Pontos de conexão no desenho (só visual): "b"/"r" de saída, "t"/"l" de entrada, "sim"/"nao" da condição. */
  sourceHandle?: string;
  targetHandle?: string;
}

export type ProcessTrigger = { type: "evento"; eventType: EventType } | { type: "manual" };

export const PROCESS_STATUS = ["rascunho", "publicado", "arquivado"] as const;
export type ProcessDefinitionStatus = (typeof PROCESS_STATUS)[number];
export const PROCESS_STATUS_LABELS: Record<ProcessDefinitionStatus, string> = { rascunho: "Rascunho", publicado: "Publicado", arquivado: "Arquivado" };

export interface ProcessDefinition extends BaseEntity {
  key: string;
  name: string;
  description?: string;
  version: number;
  status: ProcessDefinitionStatus;
  trigger: ProcessTrigger;
  nodes: ProcessNode[];
  edges: ProcessEdge[];
  publishedAt?: string;
  publishedBy?: string;
}

// ---------------------------------------------------------------------------
// Execuções
// ---------------------------------------------------------------------------

export const PROCESS_RUN_STATUS = ["em_andamento", "concluido", "cancelado", "erro"] as const;
export type ProcessRunStatus = (typeof PROCESS_RUN_STATUS)[number];
export const PROCESS_RUN_STATUS_LABELS: Record<ProcessRunStatus, string> = { em_andamento: "Em andamento", concluido: "Concluído", cancelado: "Cancelado", erro: "Erro" };

export type ProcessOutcome = "sim" | "nao";

export interface ProcessRunHistoryEntry {
  nodeId: string;
  nodeLabel?: string;
  at: string;
  /** "entrou", "concluido", "sim", "nao", "aguardando", "aguardando_resposta", "notificado", "erro", "ignorado"… */
  result: string;
  detail?: string;
  /** Aresta pela qual o fluxo chegou ao nó (desenho do caminho percorrido). */
  via?: string;
  actorId?: string;
}

/** O que um nó em andamento está esperando. */
export interface ProcessPendingNode {
  kind: "tarefa" | "aprovacao" | "manual" | "espera_horas" | "espera_evento";
  since: string;
  taskId?: string;
  slaInstanceId?: string;
  assigneeId?: string;
  assigneeName?: string;
  waitUntil?: string;
  untilEvent?: EventType;
  /** Decisão Sim/Não pendente (tarefa com resultado ou aprovação). */
  needsOutcome?: boolean;
  /** A tarefa foi concluída sem informar o resultado: responder na tela de execuções. */
  awaitingOutcome?: boolean;
}

export interface ProcessRunContext {
  /** Payload do evento gatilho (ou dados informados no início manual). */
  payload: Record<string, unknown>;
  /** Respostas Sim/Não por nó (tarefas com resultado, aprovações e condições avaliadas). */
  outcomes: Record<string, ProcessOutcome>;
  trigger: { type: "evento" | "manual"; eventType?: EventType; eventId?: string; eventTitle?: string };
}

export interface ProcessRun extends BaseEntity {
  definitionId: string;
  definitionKey: string;
  definitionName: string;
  version: number;
  clientId?: string;
  clientName?: string;
  entity?: { type: string; id: string };
  status: ProcessRunStatus;
  currentNodeIds: string[];
  context: ProcessRunContext;
  history: ProcessRunHistoryEntry[];
  pending: Record<string, ProcessPendingNode>;
  /** Tipos de evento aguardados por nós de espera (consulta array-contains no handler). */
  waitingEventTypes: EventType[];
  startedAt: string;
  startedBy: UserRef;
  completedAt?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Padrões e utilidades de grafo
// ---------------------------------------------------------------------------

export function defaultNodeData<T extends ProcessNodeType>(type: T): ProcessNodeDataMap[T] {
  const map: ProcessNodeDataMap = {
    inicio: { label: "Início" },
    tarefa: {
      label: "Nova tarefa",
      department: "implantacao",
      assignee: "gestor_departamento",
      priority: "media",
      dueBusinessDays: 2,
      slaHours: 16,
      requiredFields: [],
      checklist: [],
      autoCreateTask: true,
      notify: true,
    },
    aprovacao: { label: "Aprovação", approverRole: "gestor", slaHours: 8 },
    condicao: { label: "Condição?", mode: "resultado" },
    espera: { label: "Aguardar", mode: "horas_uteis", businessHours: 10 },
    notificacao: { label: "Notificar", to: "gestor_departamento", department: "implantacao", kind: "informativa", title: "Aviso do processo" },
    integracao: { label: "Integração", url: "https://", method: "POST" },
    fim: { label: "Fim" },
  };
  return map[type];
}

export function outgoingEdges(edges: ProcessEdge[], nodeId: string): ProcessEdge[] {
  return edges.filter((e) => e.source === nodeId);
}

/** Nós que produzem Sim/Não ao serem concluídos. */
export function nodeHasOutcome(node: ProcessNode | undefined): boolean {
  if (!node) return false;
  return node.type === "aprovacao" || (node.type === "tarefa" && node.data.outcome === "sim_nao");
}

export function normalizeEdgeLabel(label: string | undefined): ProcessOutcome | undefined {
  if (!label) return undefined;
  const v = label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (v === "sim" || v === "aprovado" || v === "aprovar") return "sim";
  if (v === "nao" || v === "reprovado" || v === "reprovar") return "nao";
  return undefined;
}

/**
 * Próximos nós a partir de um nó concluído: arestas sem rótulo Sim/Não sempre seguem; arestas Sim/Não seguem
 * apenas quando batem com o resultado informado.
 */
export function nextEdges(edges: ProcessEdge[], nodeId: string, outcome?: ProcessOutcome): ProcessEdge[] {
  return outgoingEdges(edges, nodeId).filter((e) => {
    const branch = normalizeEdgeLabel(e.label);
    return !branch || branch === outcome;
  });
}

/** Tipo de entidade que cada evento gatilho costuma carregar (simulação e descrição do gatilho). */
export const TRIGGER_ENTITY_TYPES: Partial<Record<EventType, string>> = {
  "payment.overdue": "billing",
  "payment.pending": "billing",
  "payment.approved": "contract",
  "billing.created": "billing",
  "contract.created": "contract",
  "contract.signed": "contract",
  "financial.released": "contract",
  "customer.activated": "cs_account",
  "customer.risk.detected": "cs_account",
  "customer.health_changed": "cs_account",
  "implementation.created": "project",
  "implementation.go_live": "project",
  "opportunity.won": "opportunity",
  "opportunity.lost": "opportunity",
  "support.ticket.created": "ticket",
  "support.ticket.resolved": "ticket",
  "lead.created": "lead",
  "lead.qualified": "lead",
  "client.created": "client",
  "renewal.due": "renewal",
};

// ---------------------------------------------------------------------------
// Validação (publicação)
// ---------------------------------------------------------------------------

export interface GraphIssue {
  nodeId?: string;
  message: string;
}

/**
 * Regras de publicação: um início, ao menos um fim, todos os nós alcançáveis a partir do início, condições com
 * duas saídas (Sim e Não), nós (exceto fim) com saída e configuração mínima de cada tipo.
 */
export function validateProcessGraph(def: Pick<ProcessDefinition, "nodes" | "edges" | "trigger" | "name">): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const { nodes, edges } = def;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!def.name?.trim()) issues.push({ message: "Informe o nome do processo." });
  if (def.trigger.type === "evento" && !def.trigger.eventType) issues.push({ message: "Escolha o evento que dispara o processo." });

  const starts = nodes.filter((n) => n.type === "inicio");
  if (starts.length !== 1) issues.push({ message: starts.length === 0 ? "O processo precisa de um bloco Início." : "Use apenas um bloco Início." });
  if (!nodes.some((n) => n.type === "fim")) issues.push({ message: "O processo precisa de pelo menos um bloco Fim." });

  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) issues.push({ message: "Há uma ligação apontando para um bloco removido." });
  }
  for (const s of starts) {
    if (edges.some((e) => e.target === s.id)) issues.push({ nodeId: s.id, message: "O Início não pode receber ligações." });
  }

  // Alcançabilidade a partir do início.
  if (starts.length === 1) {
    const seen = new Set<string>([starts[0].id]);
    const queue = [starts[0].id];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      for (const e of outgoingEdges(edges, id)) {
        if (!seen.has(e.target)) {
          seen.add(e.target);
          queue.push(e.target);
        }
      }
    }
    for (const n of nodes) if (!seen.has(n.id)) issues.push({ nodeId: n.id, message: `"${n.data.label}" não é alcançável a partir do Início.` });
  }

  for (const n of nodes) {
    const out = outgoingEdges(edges, n.id);
    const name = `"${n.data.label || PROCESS_NODE_LABELS[n.type]}"`;
    if (!n.data.label?.trim()) issues.push({ nodeId: n.id, message: `Um bloco ${PROCESS_NODE_LABELS[n.type]} está sem nome.` });
    if (n.type !== "fim" && out.length === 0) issues.push({ nodeId: n.id, message: `${name} não tem saída.` });
    if (n.type === "fim" && out.length > 0) issues.push({ nodeId: n.id, message: `${name} (Fim) não pode ter saídas.` });

    const branches = out.map((e) => normalizeEdgeLabel(e.label));
    if (n.type === "condicao") {
      if (out.length !== 2 || !branches.includes("sim") || !branches.includes("nao")) issues.push({ nodeId: n.id, message: `${name} precisa de exatamente duas saídas: Sim e Não.` });
      if (n.data.mode === "contexto" && !n.data.path?.trim()) issues.push({ nodeId: n.id, message: `${name}: informe o campo avaliado.` });
      if (n.data.mode === "contexto" && n.data.operator !== "exists" && (n.data.value ?? "") === "") issues.push({ nodeId: n.id, message: `${name}: informe o valor comparado.` });
      if (n.data.mode === "resultado") {
        const from = n.data.fromNode ? byId.get(n.data.fromNode) : undefined;
        if (!from || !nodeHasOutcome(from)) issues.push({ nodeId: n.id, message: `${name}: escolha a tarefa (com resposta Sim/Não) ou aprovação cuja resposta é lida.` });
      }
    } else if (branches.some(Boolean) && !nodeHasOutcome(n)) {
      issues.push({ nodeId: n.id, message: `${name} tem saídas Sim/Não, mas não produz resposta.` });
    } else if (branches.some(Boolean) && (!branches.includes("sim") || !branches.includes("nao"))) {
      issues.push({ nodeId: n.id, message: `${name}: com saídas Sim/Não, ligue as duas.` });
    }

    if (n.type === "tarefa") {
      if (!n.data.department) issues.push({ nodeId: n.id, message: `${name}: escolha o departamento.` });
      if (!n.data.assignee?.trim()) issues.push({ nodeId: n.id, message: `${name}: escolha o responsável padrão.` });
      if (n.data.dueBusinessDays < 0 || n.data.slaHours < 0) issues.push({ nodeId: n.id, message: `${name}: prazo e SLA não podem ser negativos.` });
    }
    if (n.type === "espera") {
      if (n.data.mode === "horas_uteis" && !(Number(n.data.businessHours) > 0)) issues.push({ nodeId: n.id, message: `${name}: informe as horas úteis de espera.` });
      if (n.data.mode === "evento" && !n.data.untilEvent) issues.push({ nodeId: n.id, message: `${name}: escolha o evento aguardado.` });
    }
    if (n.type === "notificacao" && (!n.data.to?.trim() || !n.data.title?.trim())) issues.push({ nodeId: n.id, message: `${name}: informe destinatário e título.` });
    if (n.type === "integracao" && !/^https?:\/\/[^\s/]+\.[^\s]+/.test(n.data.url ?? "")) issues.push({ nodeId: n.id, message: `${name}: informe uma URL http(s) válida.` });
  }
  return issues;
}

/** Chave estável a partir do nome ("Cobrança de inadimplente" → "cobranca-de-inadimplente"). */
export function slugifyProcessKey(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "processo"
  );
}

/** processId das tarefas criadas pelo motor: "<runId>#<nodeId>". */
export function processTaskId(runId: string, nodeId: string): string {
  return `${runId}#${nodeId}`;
}

export function parseProcessTaskId(processId: string | undefined): { runId: string; nodeId: string } | null {
  if (!processId) return null;
  const i = processId.indexOf("#");
  if (i <= 0 || i === processId.length - 1) return null;
  return { runId: processId.slice(0, i), nodeId: processId.slice(i + 1) };
}
