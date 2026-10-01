/**
 * Tipos e helpers do Meu Dia compartilhados entre servidor e cliente (sem dependências de servidor).
 * O servidor monta `MeuDiaData` em src/server/meu-dia/queries.ts; os componentes só renderizam.
 */
import type { Priority, HealthLevel } from "@/domain/constants";
import type { SlaView } from "@/domain/types";
import type { NotificationItem } from "@/components/notifications/model";

export type { NotificationItem } from "@/components/notifications/model";

export type MeuDiaScope = "eu" | "equipe";

/** Filtro da lista de prioridades (vem de ?filtro= e dos StatCards). */
export const PRIORITY_FILTERS = ["todas", "tarefas", "pendencias", "atrasadas", "followups", "sla", "clientes"] as const;
export type PriorityFilter = (typeof PRIORITY_FILTERS)[number];
export const PRIORITY_FILTER_LABELS: Record<PriorityFilter, string> = {
  todas: "Todas",
  tarefas: "Tarefas",
  pendencias: "Pendências",
  atrasadas: "Atrasadas",
  followups: "Follow-ups",
  sla: "SLA",
  clientes: "Clientes",
};

export function parsePriorityFilter(value: string | undefined): PriorityFilter {
  return (PRIORITY_FILTERS as readonly string[]).includes(value ?? "") ? (value as PriorityFilter) : "todas";
}

export type PriorityKind = "tarefa" | "etapa" | "lead" | "oportunidade" | "projeto" | "chamado" | "cliente" | "renovacao" | "sla" | "retorno" | "contrato" | "cobranca" | "titulo" | "comissao";

export const PRIORITY_KIND_LABELS: Record<PriorityKind, string> = {
  tarefa: "Tarefa",
  etapa: "Etapa",
  lead: "Lead",
  oportunidade: "Oportunidade",
  projeto: "Implantação",
  chamado: "Chamado",
  cliente: "Cliente",
  renovacao: "Renovação",
  sla: "SLA",
  retorno: "Aguardando retorno",
  contrato: "Contrato",
  cobranca: "Cobrança",
  titulo: "Título a pagar",
  comissao: "Comissão",
};

export type ReasonTone = "danger" | "warning" | "info" | "muted";

export interface PriorityItem {
  /** `${kind}:${entityId}` — chave de deduplicação. */
  id: string;
  kind: PriorityKind;
  entityId: string;
  title: string;
  clientId?: string;
  clientName?: string;
  /** "Vence em 2h", "Atrasada há 3 dias", "SLA em risco 85%", "Sem próxima ação". */
  reason: string;
  reasonTone: ReasonTone;
  dueAt?: string;
  dueLabel?: string;
  priority?: Priority;
  sla?: SlaView | null;
  /** Impacto em texto ("MRR R$ 1,2 mil", "Crítico", "R$ 350/mês"). */
  impactLabel?: string;
  score: number;
  href: string;
  /** Tarefa concluível inline pela action completeTaskQuick. */
  canComplete: boolean;
  /** Preenchidos no modo equipe. */
  assigneeId?: string;
  assigneeName?: string;
  /** Marca itens atrasados/vencidos (filtro "atrasadas"). */
  overdue: boolean;
  /** Aguarda ação do usuário (entra no filtro "Pendências" mesmo sendo de outro tipo). */
  pending?: boolean;
  /** Horário exibido à direita ("15:00" hoje, "Ontem", "3 out"). */
  timeLabel?: string;
}

export interface MeuDiaStats {
  /** Tarefas abertas ou em andamento (card "Tarefas"). */
  tasksInProgress: number;
  /** Itens aguardando o usuário: etapas atribuídas, clientes aguardando retorno, contratos pendentes e pendências financeiras do perfil. */
  pendingOnYou: number;
  /** Atingimento médio das metas do mês (fração), null sem metas. */
  goalAttainment: number | null;
  tasksToday: number;
  overdueTasks: number;
  followupsOverdue: number;
  slaAtRisk: number;
  clientsAttention: number;
  unreadNotifications: number;
}

export type AgendaKind = "tarefa" | "visita" | "treinamento" | "checkpoint";
export interface AgendaItem {
  id: string;
  kind: AgendaKind;
  at: string;
  timeLabel: string;
  title: string;
  clientId?: string;
  clientName?: string;
  href: string;
  done: boolean;
  assigneeName?: string;
}

export interface FollowupItem {
  id: string;
  kind: "lead" | "oportunidade";
  title: string;
  clientId?: string;
  clientName?: string;
  nextAction?: string;
  nextActionAt: string;
  nextActionLabel: string;
  overdue: boolean;
  href: string;
  valueLabel?: string;
  assigneeName?: string;
}

export interface StepItem {
  id: string;
  stageName: string;
  status: string;
  clientId: string;
  clientName: string;
  sla: SlaView | null;
  dueAt?: string;
  dueLabel?: string;
  checklistDone: number;
  checklistTotal: number;
  href: string;
  assigneeName?: string;
}

export interface AttentionClient {
  id: string;
  tradeName: string;
  healthLevel?: HealthLevel;
  healthScore?: number;
  mrr: number;
  reason: string;
  tone: ReasonTone;
  href: string;
  ownerName?: string;
}

export interface GoalItem {
  id: string;
  kpiKey: string;
  name: string;
  unit: "numero" | "percentual" | "moeda" | "horas" | "dias";
  direction: "maior_melhor" | "menor_melhor" | "faixa";
  scopeLabel: string;
  target: number;
  /** null quando não há snapshot nem fórmula bruta para o KPI. */
  value: number | null;
  /** Fração (0.85 = 85%). */
  attainment: number | null;
  source: "snapshot" | "calculado" | "indisponivel";
  /** Drill-down do indicador no escopo da meta (/gestao/indicadores/<kpi>?...). */
  href?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  avatarUrl?: string;
  jobTitle?: string;
  openTasks: number;
  overdueTasks: number;
  slaRisk: number;
  /** Carga = abertas / média de abertas da equipe (1 = na média). */
  load: number;
  href: string;
}

/** Cliente/lead esperando resposta: mensagem recebida sem retorno ou chamado com resposta do cliente. */
export interface AwaitingItem {
  id: string;
  kind: "lead" | "oportunidade" | "cliente" | "chamado";
  title: string;
  clientId?: string;
  clientName?: string;
  /** Trecho da última mensagem recebida. */
  excerpt?: string;
  channel: string;
  receivedAt: string;
  receivedLabel: string;
  href: string;
  assigneeName?: string;
}

export interface PendingContractItem {
  id: string;
  number: string;
  clientId: string;
  clientName?: string;
  status: string;
  statusLabel: string;
  detail?: string;
  monthlyTotal: number;
  sinceLabel: string;
  href: string;
}

/** Item do bloco "Financeiro do dia" (D17): cobrança, título a pagar ou comissão, sempre com link real. */
export interface FinanceItem {
  /** `${kind}:${entityId}` — mesma chave usada na lista de prioridades. */
  id: string;
  kind: "cobranca" | "titulo" | "comissao";
  title: string;
  detail?: string;
  amount?: number;
  dueAt?: string;
  dueLabel?: string;
  tone: ReasonTone;
  href: string;
  clientId?: string;
  clientName?: string;
  assigneeName?: string;
}

export interface FinanceSection {
  key: "cobrancas_vencidas" | "vencimentos" | "titulos" | "comissoes";
  title: string;
  description?: string;
  /** Link "ver todas" da seção. */
  href?: string;
  /** Total de itens da seção (a lista mostra os primeiros). */
  count: number;
  /** Soma dos valores da seção. */
  total: number;
  items: FinanceItem[];
}

/**
 * Bloco financeiro do Meu Dia, parametrizado pelo perfil: equipe financeira (cobranças vencidas, vencimentos em
 * 3 dias, títulos a aprovar/pagar/vencidos, comissões elegíveis sem título) ou vendedor (cobrança vencida de
 * cliente seu, para acionar). Contratos pendentes continuam no bloco "Contratos pendentes".
 */
export interface FinanceDigest {
  profile: "financeiro" | "vendas";
  title: string;
  description?: string;
  href: string;
  hrefLabel: string;
  sections: FinanceSection[];
  /** Itens que entraram nas prioridades (soma das seções). */
  count: number;
}

/**
 * Seções do Meu Dia que o usuário vê (catálogo: inicio.meu-dia.<secao>.ver), calculadas no servidor. Seção negada:
 * os dados não são carregados nem enviados e o bloco não aparece.
 */
export interface MeuDiaSections {
  prioridades: boolean;
  equipe: boolean;
  insights: boolean;
  financeiro: boolean;
  cobrancasVendas: boolean;
  contratos: boolean;
  agenda: boolean;
  aguardando: boolean;
  followups: boolean;
  etapas: boolean;
  clientesAtencao: boolean;
  metas: boolean;
  notificacoes: boolean;
  /** Visitas na agenda (vem de Vendas › Visitas). */
  visitas: boolean;
  /** Cards do cabeçalho que levam a outras telas (só aparecem para quem abre a tela de destino). */
  tarefas: boolean;
  sla: boolean;
}

export interface MeuDiaData {
  user: { id: string; name: string; firstName: string };
  sections: MeuDiaSections;
  scope: MeuDiaScope;
  canToggleScope: boolean;
  teamSize: number;
  greeting: string;
  todayLabel: string;
  summaryLine: string;
  stats: MeuDiaStats;
  priorities: PriorityItem[];
  agenda: AgendaItem[];
  /** Visitas agendadas nos próximos 7 dias (depois de hoje). */
  upcomingVisits: AgendaItem[];
  followups: FollowupItem[];
  steps: StepItem[];
  attentionClients: AttentionClient[];
  goals: GoalItem[];
  notifications: NotificationItem[];
  team: TeamMember[];
  awaiting: AwaitingItem[];
  contracts: PendingContractItem[];
  /** Presente só para perfis com pendências financeiras (equipe financeira ou vendedor com cobrança vencida). */
  finance?: FinanceDigest;
}

/** Aplica o filtro dos StatCards à lista de prioridades. */
export function filterPriorities(items: PriorityItem[], filter: PriorityFilter): PriorityItem[] {
  switch (filter) {
    case "tarefas":
      return items.filter((i) => i.kind === "tarefa");
    case "pendencias":
      return items.filter((i) => i.pending || i.kind === "etapa" || i.kind === "retorno" || i.kind === "contrato");
    case "atrasadas":
      return items.filter((i) => i.overdue);
    case "followups":
      return items.filter((i) => i.kind === "lead" || i.kind === "oportunidade");
    case "sla":
      return items.filter((i) => i.sla && (i.sla.state === "em_risco" || i.sla.state === "violado"));
    case "clientes":
      return items.filter((i) => i.kind === "cliente" || i.kind === "renovacao");
    default:
      return items;
  }
}
