/**
 * Constantes de domínio: departamentos, papéis, navegação, rótulos e tipos de evento.
 * Fonte única para toda a aplicação. Não duplique estes valores em componentes.
 */

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

/** Módulos do sistema e papéis que podem acessá-los. `admin` sempre acessa tudo. */
export const MODULE_ACCESS: Record<string, readonly RoleKey[] | "all"> = {
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
};

export type NavSection = {
  key: keyof typeof MODULE_ACCESS;
  label: string;
  items: NavItem[];
};

export const NAVIGATION: NavSection[] = [
  {
    key: "inicio",
    label: "Início",
    items: [
      { label: "Meu Dia", href: "/meu-dia", icon: "Sun", wave: 1 },
      { label: "Notificações", href: "/notificacoes", icon: "Bell", wave: 1 },
    ],
  },
  {
    key: "operacao",
    label: "Operação",
    items: [
      { label: "Tarefas", href: "/tarefas", icon: "CheckSquare", wave: 1 },
      { label: "Workflow", href: "/workflow", icon: "GitBranch", wave: 1 },
      { label: "Clientes 360º", href: "/clientes", icon: "Building2", wave: 1 },
      { label: "SLA", href: "/sla", icon: "Timer", wave: 5 },
    ],
  },
  {
    key: "marketing",
    label: "Marketing",
    items: [
      { label: "Visão Geral", href: "/marketing", icon: "Megaphone", wave: 2 },
      { label: "Leads", href: "/marketing/leads", icon: "UserPlus", wave: 2 },
      { label: "Campanhas", href: "/marketing/campanhas", icon: "Flag", wave: 2 },
      { label: "Caixa de Entrada", href: "/marketing/caixa-de-entrada", icon: "Inbox", wave: 2 },
      { label: "Prospecção Ativa", href: "/marketing/prospeccao", icon: "Crosshair", wave: 2 },
    ],
  },
  {
    key: "vendas",
    label: "Vendas",
    items: [
      { label: "Central de Vendas", href: "/vendas", icon: "Handshake", wave: 2 },
      { label: "Pipeline", href: "/vendas/pipeline", icon: "Kanban", wave: 2 },
      { label: "Oportunidades", href: "/vendas/oportunidades", icon: "Target", wave: 2 },
      { label: "Agenda", href: "/vendas/agenda", icon: "Calendar", wave: 2 },
      { label: "Visitas", href: "/vendas/visitas", icon: "MapPin", wave: 2 },
      { label: "Propostas", href: "/vendas/propostas", icon: "FileText", wave: 2 },
    ],
  },
  {
    key: "financeiro",
    label: "Financeiro",
    items: [
      { label: "Visão Geral", href: "/financeiro", icon: "LayoutDashboard", wave: 2 },
      { label: "Contratos", href: "/financeiro/contratos", icon: "FileSignature", wave: 2 },
      { label: "Assinaturas", href: "/financeiro/assinaturas", icon: "PenLine", wave: 2 },
      { label: "Cobranças", href: "/financeiro/cobrancas", icon: "Receipt", wave: 2 },
      { label: "Contas a Receber", href: "/financeiro/contas-a-receber", icon: "Wallet", wave: 2 },
      { label: "Recorrência", href: "/financeiro/recorrencia", icon: "Repeat", wave: 2 },
    ],
  },
  {
    key: "implantacao",
    label: "Implantação",
    items: [
      { label: "Projetos", href: "/implantacao", icon: "Rocket", wave: 3 },
      { label: "Kanban", href: "/implantacao/kanban", icon: "Kanban", wave: 3 },
      { label: "Checklists", href: "/implantacao/checklists", icon: "ListChecks", wave: 3 },
      { label: "Treinamentos", href: "/implantacao/treinamentos", icon: "GraduationCap", wave: 3 },
      { label: "Go-live", href: "/implantacao/go-live", icon: "Flag", wave: 3 },
    ],
  },
  {
    key: "cs",
    label: "Customer Success",
    items: [
      { label: "Carteira", href: "/cs", icon: "Briefcase", wave: 3 },
      { label: "Saúde", href: "/cs/saude", icon: "HeartPulse", wave: 3 },
      { label: "Checkpoints", href: "/cs/checkpoints", icon: "CalendarCheck", wave: 3 },
      { label: "Plano de Sucesso", href: "/cs/planos", icon: "Route", wave: 3 },
      { label: "Renovações", href: "/cs/renovacoes", icon: "RefreshCw", wave: 3 },
      { label: "Riscos", href: "/cs/riscos", icon: "AlertTriangle", wave: 3 },
      { label: "Upsell", href: "/cs/upsell", icon: "TrendingUp", wave: 3 },
      { label: "Churn", href: "/cs/churn", icon: "UserMinus", wave: 3 },
    ],
  },
  {
    key: "suporte",
    label: "Suporte",
    items: [
      { label: "Central de Suporte", href: "/suporte", icon: "Headset", wave: 3 },
      { label: "Chamados", href: "/suporte/chamados", icon: "Ticket", wave: 3 },
      { label: "Base de Conhecimento", href: "/suporte/base-de-conhecimento", icon: "BookOpen", wave: 3 },
    ],
  },
  {
    key: "performance",
    label: "Performance",
    items: [
      { label: "Meu Desempenho", href: "/performance", icon: "Gauge", wave: 4 },
      { label: "Metas", href: "/performance/metas", icon: "Goal", wave: 4 },
      { label: "Bônus", href: "/performance/bonus", icon: "Award", wave: 4 },
      { label: "Ranking", href: "/performance/ranking", icon: "Trophy", wave: 4 },
      { label: "Campanhas", href: "/performance/campanhas", icon: "Sparkles", wave: 4 },
    ],
  },
  {
    key: "gestao",
    label: "Gestão",
    items: [
      { label: "Dashboard do Gestor", href: "/gestao", icon: "LayoutDashboard", wave: 4 },
      { label: "Cockpit Diretoria", href: "/gestao/cockpit", icon: "Radar", wave: 4 },
      { label: "Relatórios", href: "/gestao/relatorios", icon: "BarChart3", wave: 4 },
    ],
  },
  {
    key: "admin",
    label: "Administração",
    items: [
      { label: "Usuários", href: "/admin/usuarios", icon: "Users", wave: 1 },
      { label: "Departamentos", href: "/admin/departamentos", icon: "Network", wave: 1 },
      { label: "Produtos", href: "/admin/produtos", icon: "Package", wave: 1 },
      { label: "Configurações", href: "/admin/configuracoes", icon: "Settings", wave: 1 },
      { label: "Workflows", href: "/admin/workflows", icon: "Workflow", wave: 1 },
      { label: "Indicadores", href: "/admin/indicadores", icon: "Activity", wave: 4 },
      { label: "Automações", href: "/admin/automacoes", icon: "Zap", wave: 5 },
      { label: "Integrações", href: "/admin/integracoes", icon: "Plug", wave: 5 },
    ],
  },
];

/**
 * Itens da barra inferior no celular. São 4 links; o botão central "+" (ações rápidas, QUICK_ACTIONS)
 * é inserido pelo MobileNav entre o 2º e o 3º item: Início · Tarefas · [+] · Clientes · Mais.
 */
export const MOBILE_NAV: NavItem[] = [
  { label: "Início", href: "/meu-dia", icon: "Home" },
  { label: "Tarefas", href: "/tarefas", icon: "CheckSquare" },
  { label: "Clientes", href: "/clientes", icon: "Users" },
  { label: "Mais", href: "/menu", icon: "Menu" },
];

export type QuickAction = {
  key: string;
  label: string;
  description: string;
  /** Rota que abre o formulário de criação (contrato de URL do módulo). */
  href: string;
  /** Nome do ícone lucide-react. */
  icon: string;
  /** Módulo exigido (MODULE_ACCESS). */
  module: keyof typeof MODULE_ACCESS;
  /** Restringe a papéis específicos dentro do módulo (admin sempre vê). Ausente = todos com acesso ao módulo. */
  roles?: readonly RoleKey[];
};

/** Ações rápidas do botão "+" (mobile), filtradas por papel no servidor. */
export const QUICK_ACTIONS: QuickAction[] = [
  { key: "tarefa", label: "Nova tarefa", description: "Crie e atribua uma tarefa", href: "/tarefas?novo=1", icon: "CheckSquare", module: "operacao" },
  { key: "lead", label: "Novo lead", description: "Cadastre um lead captado", href: "/marketing/leads?novo=1", icon: "UserPlus", module: "marketing" },
  {
    key: "oportunidade",
    label: "Nova oportunidade",
    description: "Abra uma negociação",
    href: "/vendas/oportunidades?novo=1",
    icon: "Target",
    module: "vendas",
    roles: ["diretoria", "gestor", "vendas", "cs"],
  },
  { key: "chamado", label: "Novo chamado", description: "Registre um atendimento", href: "/suporte/chamados?novo=1", icon: "Ticket", module: "suporte" },
  { key: "visita", label: "Registrar visita", description: "Agende ou registre uma visita", href: "/vendas/visitas?nova=1", icon: "MapPin", module: "vendas", roles: ["diretoria", "gestor", "vendas"] },
  { key: "cliente", label: "Novo cliente", description: "Cadastre uma empresa", href: "/clientes/novo", icon: "Building2", module: "operacao" },
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
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ORGANIZATION_ID = "intercert";
