/**
 * Cópia CONGELADA de NAVIGATION, MOBILE_NAV e QUICK_ACTIONS como eram escritas à mão em src/domain/constants.ts antes
 * de passarem a derivar do catálogo (commit b4606a2). Oráculo do T0 de navegação: não importe no código da aplicação.
 */
import type { ModuleKey } from "@/domain/permissions";
import type { RoleKey } from "@/domain/constants";

export interface LegacyNavItem {
  label: string;
  href: string;
  icon: string;
  wave?: 1 | 2 | 3 | 4 | 5 | 6;
  roles?: readonly RoleKey[];
}

export interface LegacyNavSection {
  key: ModuleKey;
  label: string;
  items: LegacyNavItem[];
}

export interface LegacyQuickAction {
  key: string;
  label: string;
  description: string;
  href: string;
  icon: string;
  module: ModuleKey;
  roles?: readonly RoleKey[];
}

export const LEGACY_NAVIGATION: LegacyNavSection[] = [
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
      { label: "Comissões", href: "/financeiro/comissoes", icon: "BadgePercent", wave: 5 },
      { label: "Contas a Pagar", href: "/financeiro/contas-a-pagar", icon: "HandCoins", wave: 5, roles: ["diretoria", "gestor", "financeiro"] },
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

export const LEGACY_MOBILE_NAV: LegacyNavItem[] = [
  { label: "Início", href: "/meu-dia", icon: "Home" },
  { label: "Tarefas", href: "/tarefas", icon: "CheckSquare" },
  { label: "Clientes", href: "/clientes", icon: "Users" },
  { label: "Mais", href: "/menu", icon: "Menu" },
];

export const LEGACY_QUICK_ACTIONS: LegacyQuickAction[] = [
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
