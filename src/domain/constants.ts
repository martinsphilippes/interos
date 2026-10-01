/**
 * Constantes de domínio: departamentos, papéis, navegação, rótulos e tipos de evento.
 * Fonte única para toda a aplicação. Não duplique estes valores em componentes.
 */

import type { ModuleKey } from "./permissions/types";

export const DEPARTMENT_KEYS = [
  "marketing",
  "vendas",
  "financeiro",
  "implantacao",
  "cs",
  "suporte",
  "administrativo",
  "diretoria",
] as const;
export type DepartmentKey = (typeof DEPARTMENT_KEYS)[number];

export const DEPARTMENT_LABELS: Record<DepartmentKey, string> = {
  marketing: "Marketing",
  vendas: "Vendas",
  financeiro: "Financeiro",
  implantacao: "Implantação",
  cs: "Customer Success",
  suporte: "Suporte",
  administrativo: "Administrativo",
  diretoria: "Diretoria",
};

export const ROLE_KEYS = [
  "admin",
  "diretoria",
  "gestor",
  "marketing",
  "vendas",
  "financeiro",
  "implantacao",
  "cs",
  "suporte",
  "colaborador",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  admin: "Administrador",
  diretoria: "Diretoria",
  gestor: "Gestor",
  marketing: "Marketing",
  vendas: "Vendas",
  financeiro: "Financeiro",
  implantacao: "Implantação",
  cs: "Customer Success",
  suporte: "Suporte",
  colaborador: "Colaborador",
};

/**
 * Módulos do sistema e papéis que podiam acessá-los ANTES do catálogo de acessos (registro histórico).
 *
 * @deprecated Não use para decidir acesso nem para responder "quem acessa o módulo": a fonte de verdade é a chave
 * `<modulo>.acessar` do catálogo (`src/domain/permissions`), avaliada por `can`/`canAccessModule` com perfil, exceções
 * e módulos ativos. Já diverge do catálogo em `admin`: aqui só o papel admin, no catálogo `admin.acessar` =
 * gestores (admin, diretoria e gestor — correção A27 menu × rota). Para tipar módulos use `ModuleKey`. Mantido só
 * para os testes de integridade (tests/permissions/catalog.test.ts); remover quando eles deixarem de usá-lo.
 */
export const MODULE_ACCESS: Record<ModuleKey, readonly RoleKey[] | "all"> = {
  inicio: "all",
  operacao: "all",
  marketing: ["diretoria", "gestor", "marketing", "vendas"],
  vendas: ["diretoria", "gestor", "vendas", "marketing", "cs", "suporte"],
  financeiro: ["diretoria", "gestor", "financeiro", "vendas"],
  implantacao: ["diretoria", "gestor", "implantacao", "suporte", "cs"],
  cs: ["diretoria", "gestor", "cs", "vendas", "suporte"],
  suporte: ["diretoria", "gestor", "suporte", "implantacao", "cs"],
  performance: "all",
  gestao: ["diretoria", "gestor"],
  admin: ["admin"],
};

/** Onda de entrega atual: itens com `wave` até este número já têm tela pronta. */
export const CURRENT_WAVE = 5;

export type NavItem = {
  label: string;
  href: string;
  /** Nome do ícone lucide-react (ex.: "Sun", "CheckSquare"). */
  icon: string;
  /** Onda em que a tela é entregue; acima de CURRENT_WAVE a rota ainda mostra "em construção". */
  wave?: 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * Só estes papéis veem o item (admin sempre vê). Histórico: antes do catálogo filtrava o menu; hoje a
   * visibilidade vem das permissões efetivas (src/server/auth/navigation.ts) e os itens derivados não trazem o campo.
   */
  roles?: readonly RoleKey[];
  /** Tela do catálogo dona do item (`<modulo>.<tela>`). */
  screen?: string;
};

export type NavSection = {
  key: ModuleKey;
  label: string;
  items: NavItem[];
};

/*
 * NAVIGATION, MOBILE_NAV e QUICK_ACTIONS (valores) ficam em `src/domain/navigation.ts`, DERIVADOS do catálogo de
 * acessos (`nav` de cada tela em src/domain/permissions); aqui ficam só os tipos. Mantê-los fora deste arquivo evita
 * que Client Components que importam rótulos daqui carreguem o catálogo inteiro no navegador. Para incluir um item de
 * menu, barra do celular ou atalho "+", declare `nav` na tela do catálogo.
 */

export type QuickAction = {
  key: string;
  label: string;
  description: string;
  /** Rota que abre o formulário de criação (contrato de URL do módulo). */
  href: string;
  /** Nome do ícone lucide-react. */
  icon: string;
  /** Módulo exigido (chave `<modulo>.acessar` do catálogo). */
  module: ModuleKey;
  /** Restringe a papéis específicos dentro do módulo (admin sempre vê). Ausente = todos com acesso ao módulo. */
  roles?: readonly RoleKey[];
  /** Tela do catálogo dona do atalho. */
  screen?: string;
  /** Chave da ação de criação exigida (o atalho aparece com can(via) ∧ regra do atalho). */
  via?: string;
};

/**
 * Link fixo do shell (atalhos da busca global, menu de ajuda, menu do usuário). O servidor entrega a cada usuário só
 * os que ele pode abrir: com `quickAction`, vale a visibilidade do atalho "+" correspondente; sem, canSeeHref(href).
 */
export type ShellLink = {
  label: string;
  href: string;
  /** Nome do ícone (NavIcon). */
  icon: string;
  hint?: string;
  quickAction?: string;
};

/** Atalhos da busca global (sem termo digitado). */
export const SEARCH_SHORTCUTS: readonly ShellLink[] = [
  { label: "Meu Dia", href: "/meu-dia", icon: "Sun" },
  { label: "Tarefas", href: "/tarefas", icon: "CheckSquare" },
  { label: "Clientes 360º", href: "/clientes", icon: "Building2" },
  { label: "Workflow", href: "/workflow", icon: "GitBranch" },
  { label: "Notificações", href: "/notificacoes", icon: "Bell" },
  { label: "Meu Desempenho", href: "/performance", icon: "Gauge" },
  { label: "Nova tarefa", href: "/tarefas?novo=1", icon: "Plus", hint: "Criar", quickAction: "tarefa" },
  { label: "Novo cliente", href: "/clientes/novo", icon: "Plus", hint: "Criar", quickAction: "cliente" },
];

/** Criação oferecida pela busca global quando não há resultado. */
export const SEARCH_CREATE_LINKS: readonly ShellLink[] = [
  { label: "Criar cliente", href: "/clientes/novo", icon: "Plus", quickAction: "cliente" },
  { label: "Criar tarefa", href: "/tarefas?novo=1", icon: "Plus", quickAction: "tarefa" },
];

/** Atalhos de navegação do menu de ajuda da top bar. */
export const HELP_LINKS: readonly ShellLink[] = [
  { href: "/menu", label: "Todos os módulos", icon: "LayoutGrid" },
  { href: "/notificacoes", label: "Notificações", icon: "Bell" },
  { href: "/performance", label: "Meu desempenho", icon: "Gauge" },
];

/** Atalhos do menu do usuário. */
export const USER_MENU_LINKS: readonly ShellLink[] = [
  { href: "/performance", label: "Meu desempenho", icon: "Gauge" },
  { href: "/notificacoes", label: "Notificações", icon: "Bell" },
];

export const TASK_STATUS = ["aberta", "em_andamento", "aguardando", "concluida", "cancelada"] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  aberta: "Aberta",
  em_andamento: "Em andamento",
  aguardando: "Aguardando",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export const PRIORITIES = ["baixa", "media", "alta", "critica"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  critica: "Crítica",
};
/** Peso usado na ordenação do Meu Dia (urgência + prazo + impacto + prioridade). */
export const PRIORITY_WEIGHT: Record<Priority, number> = { baixa: 1, media: 2, alta: 3, critica: 5 };

export const CLIENT_STATUS = ["lead", "prospect", "ativo", "em_implantacao", "inativo", "cancelado"] as const;
export type ClientStatus = (typeof CLIENT_STATUS)[number];
export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  lead: "Lead",
  prospect: "Prospect",
  em_implantacao: "Em implantação",
  ativo: "Ativo",
  inativo: "Inativo",
  cancelado: "Cancelado",
};

export const HEALTH_LEVELS = ["saudavel", "atencao", "risco"] as const;
export type HealthLevel = (typeof HEALTH_LEVELS)[number];

export const PRODUCT_CATEGORIES = [
  "erp",
  "tef",
  "maquininha",
  "telefonia",
  "omnichannel",
  "pabx",
  "certificado",
  "ponto",
  "notas",
  "banco",
  "servico",
  "consultoria",
  "outro",
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  erp: "ERP",
  tef: "TEF",
  maquininha: "Maquininha",
  telefonia: "Telefonia",
  omnichannel: "Omnichannel",
  pabx: "PABX",
  certificado: "Certificado digital",
  ponto: "Ponto eletrônico",
  notas: "Notas fiscais",
  banco: "Banco digital",
  servico: "Serviço",
  consultoria: "Consultoria",
  outro: "Outro",
};

/** Etapas da jornada principal do cliente, na ordem. */
export const JOURNEY_STAGES = ["marketing", "vendas", "financeiro", "implantacao", "cs", "suporte"] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number];

export const WORKFLOW_STEP_STATUS = [
  "pendente",
  "em_andamento",
  "aguardando_cliente",
  "aguardando_aprovacao",
  "concluida",
  "pulada",
] as const;
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUS)[number];
export const WORKFLOW_STEP_STATUS_LABELS: Record<WorkflowStepStatus, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  aguardando_cliente: "Aguardando cliente",
  aguardando_aprovacao: "Aguardando aprovação",
  concluida: "Concluída",
  pulada: "Pulada",
};

export const SLA_STATES = ["dentro_do_prazo", "em_atencao", "em_risco", "violado", "pausado", "concluido"] as const;
export type SlaState = (typeof SLA_STATES)[number];
export const SLA_STATE_LABELS: Record<SlaState, string> = {
  dentro_do_prazo: "Dentro do prazo",
  em_atencao: "Em atenção",
  em_risco: "Em risco",
  violado: "Violado",
  pausado: "Pausado",
  concluido: "Concluído",
};

export const NOTIFICATION_KINDS = ["informativa", "acao", "atencao", "critica"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * Tipos de evento do motor de eventos. Todo evento novo entra aqui.
 * Formato: <entidade>.<acao>.
 */
export const EVENT_TYPES = [
  // núcleo
  "client.created",
  "client.updated",
  "client.status_changed",
  "contact.created",
  "task.created",
  "task.updated",
  "task.status_changed",
  "task.completed",
  "task.assigned",
  "comment.added",
  "document.added",
  "note.added",
  "workflow.started",
  "workflow.stage.started",
  "workflow.stage.completed",
  "workflow.stage.blocked",
  "workflow.completed",
  "workflow.gate.rejected",
  "sla.started",
  "sla.at_risk",
  "sla.breached",
  "sla.paused",
  "sla.resumed",
  "sla.completed",
  "notification.sent",
  "user.created",
  "user.updated",
  // marketing / vendas (Onda 2)
  "lead.created",
  "lead.updated",
  "lead.qualified",
  "lead.disqualified",
  "lead.contacted",
  "prospect.contacted",
  "opportunity.created",
  "opportunity.stage_changed",
  "opportunity.followup_scheduled",
  "opportunity.followup_overdue",
  "opportunity.stalled",
  "opportunity.won",
  "opportunity.lost",
  "proposal.created",
  "proposal.sent",
  "proposal.viewed",
  "proposal.accepted",
  "proposal.rejected",
  "visit.scheduled",
  "visit.completed",
  "whatsapp.message.received",
  "whatsapp.message.sent",
  "call.completed",
  // financeiro (Onda 2)
  "contract.created",
  "contract.sent_for_signature",
  "contract.signed",
  "contract.version_created",
  "contract.cancelled",
  "billing.created",
  "payment.pending",
  "payment.approved",
  "payment.overdue",
  "financial.released",
  // implantação (Onda 3)
  "implementation.created",
  "implementation.started",
  "implementation.task.completed",
  "implementation.waiting_client",
  "implementation.resumed",
  "implementation.training.completed",
  "implementation.go_live",
  // cs (Onda 3)
  "customer.activated",
  "customer.health_changed",
  "customer.risk.detected",
  "customer.checkpoint.completed",
  "success_plan.created",
  "renewal.due",
  "renewal.completed",
  "churn.registered",
  "upsell.created",
  // suporte (Onda 3)
  "support.ticket.created",
  "support.ticket.first_response",
  "support.ticket.status_changed",
  "support.ticket.resolved",
  "support.ticket.reopened",
  "support.csat.received",
  // performance (Onda 4)
  "kpi.updated",
  "goal.achieved",
  "commission.calculated",
  "bonus.calculated",
  "bonus.blocked",
  "gamification.points_awarded",
  "achievement.unlocked",
  "automation.executed",
  // gestão, performance e auditoria (Ondas 4 e 5)
  "goal.created",
  "goal.updated",
  "bonus.block_registered",
  "bonus.block_revoked",
  "campaign.progress",
  "report.exported",
  "automation.rule_updated",
  "insight.detected",
  "ai.suggestion_generated",
  // tipos específicos (substituem reusos genéricos nos módulos já existentes)
  "workflow.step.updated",
  "workflow.step.reassigned",
  "workflow.template.published",
  "implementation.phase_changed",
  "implementation.updated",
  "support.ticket.reclassified",
  "success_plan.updated",
  "customer.escalated",
  "campaign.updated",
  "prospect_list.updated",
  "visit.cancelled",
  "commission.released",
  "contract.updated",
  "billing.cancelled",
  "user.deleted",
  "department.updated",
  "product.updated",
  // consolidação das telas conceituais
  "support.ticket.transferred",
  "knowledge.article.created",
  "knowledge.article.voted",
  "opportunity.reassigned",
  "email.sent",
  "settings.updated",
  // comissões v2 e contas a pagar (circuito de receita, etapa 2)
  "commission.paid",
  "commission.cancelled",
  "commission.reversed",
  "commission.updated",
  "commission_rule.changed",
  "payable.created",
  "payable.approved",
  "payable.scheduled",
  "payable.paid",
  "payable.cancelled",
  "payable.updated",
  // financeiro: boleto, baixa, estorno e régua de cobrança (etapa 4)
  "billing.updated",
  "payment.reversed",
  "billing.reminder_due",
  // contratos: aditivos, renovação automática e contas a pagar geral (etapa 5)
  "contract.amendment_created",
  "contract.amendment_sent",
  "contract.amendment_signed",
  "contract.amendment_applied",
  "contract.amendment_cancelled",
  "contract.renewed",
  "supplier.created",
  "supplier.updated",
  // autorização granular (etapa 6A): perfis, exceções individuais e módulos da empresa
  "permissions.updated",
  "permissions.blocked",
  // auditoria transversal (etapa 6B, D29)
  "contract.pendency_resolved",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ORGANIZATION_ID = "intercert";
