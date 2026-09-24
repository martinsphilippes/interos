/**
 * Modelo de dados do INTEROS. Fonte da verdade para todas as coleções do Firestore.
 *
 * Convenções:
 * - Toda entidade persistida estende `BaseEntity` (organizationId, createdAt, updatedAt em ISO 8601).
 * - IDs referenciam documentos de outras coleções pelo nome do campo (`clientId` -> clients/{id}).
 * - Datas são strings ISO. Valores monetários são números em reais.
 * - Nomes de coleção estão em `COLLECTIONS`; nunca use strings soltas.
 */
import type {
  ClientStatus,
  DepartmentKey,
  EventType,
  HealthLevel,
  JourneyStage,
  NotificationKind,
  Priority,
  ProductCategory,
  RoleKey,
  SlaState,
  TaskStatus,
  WorkflowStepStatus,
} from "./constants";

export const COLLECTIONS = {
  organizations: "organizations",
  users: "users",
  departments: "departments",
  clients: "clients",
  contacts: "contacts",
  clientProducts: "client_products",
  leads: "leads",
  leadSources: "lead_sources",
  campaigns: "campaigns",
  prospectLists: "prospect_lists",
  prospects: "prospects",
  opportunities: "opportunities",
  products: "products",
  proposals: "proposals",
  contracts: "contracts",
  billing: "billing",
  implementationProjects: "implementation_projects",
  implementationTemplates: "implementation_templates",
  implementationTasks: "implementation_tasks",
  trainings: "trainings",
  csAccounts: "cs_accounts",
  healthScores: "health_scores",
  successPlans: "success_plans",
  renewals: "renewals",
  churnRecords: "churn_records",
  supportTickets: "support_tickets",
  ticketInteractions: "ticket_interactions",
  csatResponses: "csat_responses",
  knowledgeArticles: "knowledge_articles",
  tasks: "tasks",
  comments: "comments",
  documents: "documents",
  events: "events",
  timelineEvents: "timeline_events",
  notifications: "notifications",
  slaRules: "sla_rules",
  slaInstances: "sla_instances",
  kpis: "kpis",
  kpiSnapshots: "kpi_snapshots",
  goals: "goals",
  performanceResults: "performance_results",
  bonusRules: "bonus_rules",
  bonusResults: "bonus_results",
  bonusBlocks: "bonus_blocks",
  commissionRules: "commission_rules",
  commissions: "commissions",
  gamificationPoints: "gamification_points",
  gamificationCampaigns: "gamification_campaigns",
  achievements: "achievements",
  workflowTemplates: "workflow_templates",
  workflowInstances: "workflow_instances",
  workflowSteps: "workflow_steps",
  automationRules: "automation_rules",
  automationRuns: "automation_runs",
  visits: "visits",
  communications: "communications",
  settings: "settings",
} as const;
export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export interface BaseEntity {
  id: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

/** Referência resumida a um usuário para exibição sem consulta extra. */
export interface UserRef {
  id: string;
  name: string;
}

export interface Address {
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lng?: number;
}

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  required?: boolean;
  doneAt?: string;
  doneBy?: string;
}

// ---------------------------------------------------------------------------
// Organização, usuários, departamentos
// ---------------------------------------------------------------------------

export interface Organization extends BaseEntity {
  name: string;
  slug: string;
  timezone: string;
  logoUrl?: string;
}

export interface User extends BaseEntity {
  /** Igual ao uid do Firebase Auth. */
  name: string;
  email: string;
  role: RoleKey;
  departmentId: DepartmentKey;
  /** Gestor direto; usado no dashboard do gestor e no RBAC hierárquico. */
  managerId?: string;
  jobTitle?: string;
  phone?: string;
  avatarUrl?: string;
  active: boolean;
  /** Salário base mensal (R$), usado na projeção de bônus. Visível só para o próprio usuário, gestor e admin. */
  baseSalary?: number;
  /** Metas padrão do colaborador (usadas no Meu Desempenho até haver `goals`). */
  monthlyGoals?: Record<string, number>;
}

export interface Department extends BaseEntity {
  key: DepartmentKey;
  name: string;
  managerId?: string;
  color?: string;
  order: number;
  description?: string;
}

// ---------------------------------------------------------------------------
// Cliente 360º
// ---------------------------------------------------------------------------

export interface Client extends BaseEntity {
  legalName: string;
  tradeName: string;
  document?: string; // CNPJ ou CPF
  segment?: string;
  status: ClientStatus;
  origin?: string; // chave de lead_sources
  campaignId?: string;
  leadId?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  website?: string;
  address: Address;
  /** Vendedor responsável. */
  ownerSalesId?: string;
  /** Responsável de CS. */
  ownerCsId?: string;
  /** Responsável de implantação. */
  ownerImplementationId?: string;
  mrr: number;
  healthScore?: number;
  healthLevel?: HealthLevel;
  tags: string[];
  notes?: string;
  activatedAt?: string;
  /** Data da última interação registrada na timeline. */
  lastInteractionAt?: string;
  nextInteractionAt?: string;
  /** Instância de workflow atual (jornada principal). */
  workflowInstanceId?: string;
  currentStage?: JourneyStage;
}

export interface Contact extends BaseEntity {
  clientId: string;
  name: string;
  role?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  isPrimary: boolean;
  isDecisionMaker?: boolean;
}

export interface ClientProduct extends BaseEntity {
  clientId: string;
  productId: string;
  productName: string;
  plan?: string;
  quantity: number;
  setupValue: number;
  monthlyValue: number;
  hardwareValue: number;
  status: "ativo" | "em_implantacao" | "suspenso" | "cancelado";
  contractId?: string;
  startedAt?: string;
  cancelledAt?: string;
}

// ---------------------------------------------------------------------------
// Catálogo de produtos
// ---------------------------------------------------------------------------

export interface Product extends BaseEntity {
  name: string;
  category: ProductCategory;
  description?: string;
  setupPrice: number;
  monthlyPrice: number;
  hardwarePrice: number;
  billingType: "recorrente" | "unico" | "ambos";
  /** Regras de comissão padrão (sobrescritas por commission_rules). */
  commission: {
    setupPct: number;
    recurringPct: number;
    hardwarePct: number;
    /** Parcela em que a comissão de recorrência é liberada (ex.: 3). */
    recurringReleaseInstallment: number;
  };
  implementationTemplateId?: string;
  /** Prazo padrão de implantação em dias úteis. */
  implementationDays?: number;
  active: boolean;
  order: number;
}

// ---------------------------------------------------------------------------
// Marketing e prospecção (Onda 2)
// ---------------------------------------------------------------------------

export type LeadTemperature = "quente" | "morno" | "frio";
export type LeadStatus = "novo" | "em_contato" | "qualificado" | "desqualificado" | "convertido";

export interface LeadSource extends BaseEntity {
  key: string;
  name: string;
  channel: "instagram" | "tiktok" | "site" | "whatsapp" | "telegram" | "anuncio" | "indicacao" | "contador" | "evento" | "lista" | "manual";
  active: boolean;
}

export interface Campaign extends BaseEntity {
  name: string;
  channel: string;
  startDate: string;
  endDate?: string;
  budget: number;
  spent: number;
  status: "planejada" | "ativa" | "pausada" | "encerrada";
  ownerId?: string;
}

export interface Lead extends BaseEntity {
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  origin: string;
  campaignId?: string;
  interest?: string;
  productInterestIds: string[];
  ownerId?: string;
  score: number;
  temperature: LeadTemperature;
  status: LeadStatus;
  consent: boolean;
  consentAt?: string;
  disqualificationReason?: string;
  duplicateOfId?: string;
  clientId?: string;
  opportunityId?: string;
  lastContactAt?: string;
  nextActionAt?: string;
  nextAction?: string;
  qualifiedAt?: string;
  notes?: string;
}

export interface ProspectList extends BaseEntity {
  name: string;
  description?: string;
  segment?: string;
  ownerId?: string;
  campaignId?: string;
  status: "ativa" | "pausada" | "encerrada";
  totals: { contacts: number; attempts: number; responses: number; opportunities: number };
}

export interface Prospect extends BaseEntity {
  listId: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  city?: string;
  ownerId?: string;
  status: "novo" | "tentativa" | "contatado" | "respondeu" | "convertido" | "descartado";
  attempts: number;
  lastAttemptAt?: string;
  nextActionAt?: string;
  result?: string;
  leadId?: string;
  opportunityId?: string;
}

// ---------------------------------------------------------------------------
// Vendas (Onda 2)
// ---------------------------------------------------------------------------

export type OpportunityStage = "qualificacao" | "diagnostico" | "proposta" | "negociacao" | "fechamento" | "ganho" | "perdido";

export interface OpportunityProduct {
  productId: string;
  productName: string;
  quantity: number;
  setupValue: number;
  monthlyValue: number;
  hardwareValue: number;
}

export interface Opportunity extends BaseEntity {
  clientId: string;
  leadId?: string;
  title: string;
  stage: OpportunityStage;
  stageChangedAt: string;
  ownerId: string;
  temperature: LeadTemperature;
  probability: number;
  products: OpportunityProduct[];
  setupTotal: number;
  monthlyTotal: number;
  hardwareTotal: number;
  diagnosis?: string;
  need?: string;
  objections?: string;
  nextAction?: string;
  nextActionAt?: string;
  lastActivityAt: string;
  billingData?: { legalName?: string; document?: string; email?: string; address?: Address; paymentCondition?: string };
  /** Quem originou (ex.: suporte que identificou upsell). */
  originDepartment?: DepartmentKey;
  originUserId?: string;
  kind: "nova_venda" | "upsell" | "cross_sell" | "renovacao";
  wonAt?: string;
  lostAt?: string;
  lossReason?: string;
  lossCompetitor?: string;
  lossNotes?: string;
  proposalId?: string;
  contractId?: string;
}

export interface Visit extends BaseEntity {
  clientId?: string;
  opportunityId?: string;
  sellerId: string;
  address: Address;
  scheduledAt: string;
  durationMinutes: number;
  objective: string;
  notes?: string;
  result?: string;
  status: "agendada" | "realizada" | "cancelada" | "remarcada";
}

export type ProposalStatus = "rascunho" | "enviada" | "visualizada" | "negociacao" | "aceita" | "recusada" | "vencida";

export interface ProposalItem {
  productId: string;
  productName: string;
  quantity: number;
  setupValue: number;
  monthlyValue: number;
  hardwareValue: number;
  discountPct: number;
}

export interface Proposal extends BaseEntity {
  clientId: string;
  opportunityId: string;
  number: string;
  version: number;
  status: ProposalStatus;
  items: ProposalItem[];
  setupTotal: number;
  monthlyTotal: number;
  hardwareTotal: number;
  discountTotal: number;
  conditions?: string;
  validUntil: string;
  notes?: string;
  sentAt?: string;
  viewedAt?: string;
  acceptedAt?: string;
  rejectedAt?: string;
  ownerId: string;
}

// ---------------------------------------------------------------------------
// Financeiro (Onda 2)
// ---------------------------------------------------------------------------

export type ContractStatus =
  | "aguardando_contrato"
  | "aguardando_assinatura"
  | "assinado"
  | "aguardando_pagamento"
  | "pago"
  | "pendencia"
  | "liberado"
  | "cancelado";

export interface Contract extends BaseEntity {
  clientId: string;
  opportunityId?: string;
  proposalId?: string;
  number: string;
  version: number;
  status: ContractStatus;
  items: ProposalItem[];
  setupTotal: number;
  monthlyTotal: number;
  hardwareTotal: number;
  billingDay: number;
  firstDueDate?: string;
  recurrence: "mensal" | "anual" | "unico";
  termMonths: number;
  startDate?: string;
  endDate?: string;
  signers: { name: string; email: string; role: string; signedAt?: string; status: "pendente" | "assinado" | "recusado" }[];
  signatureProvider?: string;
  signatureEnvelopeId?: string;
  signedAt?: string;
  documentHash?: string;
  paymentCondition?: string;
  financialStatus: "pendente" | "aprovado" | "pendencia";
  releasedAt?: string;
  releasedBy?: string;
  pendingReason?: string;
  ownerId?: string;
  documentIds: string[];
}

export interface Billing extends BaseEntity {
  clientId: string;
  contractId: string;
  type: "setup" | "mensalidade" | "hardware" | "servico";
  competence: string; // AAAA-MM
  installment?: number;
  amount: number;
  dueDate: string;
  paidAt?: string;
  paidAmount?: number;
  status: "aberta" | "paga" | "vencida" | "cancelada";
  method?: string;
  receiptDocumentId?: string;
}

// ---------------------------------------------------------------------------
// Implantação (Onda 3)
// ---------------------------------------------------------------------------

export type ImplementationStatus =
  | "aguardando_inicio"
  | "em_implantacao"
  | "aguardando_cliente"
  | "bloqueada"
  | "pronta_para_go_live"
  | "concluida"
  | "cancelada";

export const IMPLEMENTATION_PHASES = [
  "kickoff",
  "validacao_escopo",
  "configuracao",
  "migracao",
  "integracao",
  "treinamento",
  "validacao",
  "go_live",
] as const;
export type ImplementationPhase = (typeof IMPLEMENTATION_PHASES)[number];

export interface ImplementationTemplate extends BaseEntity {
  name: string;
  productId?: string;
  phases: {
    key: ImplementationPhase;
    name: string;
    order: number;
    tasks: { title: string; description?: string; dueInDays: number; required: boolean; role?: RoleKey }[];
    checklist: { label: string; required: boolean }[];
  }[];
  totalDays: number;
  active: boolean;
}

export interface ImplementationProject extends BaseEntity {
  clientId: string;
  contractId?: string;
  workflowInstanceId?: string;
  name: string;
  productIds: string[];
  scope?: string;
  ownerId: string;
  teamIds: string[];
  status: ImplementationStatus;
  currentPhase: ImplementationPhase;
  startDate?: string;
  dueDate: string;
  completedAt?: string;
  goLiveAt?: string;
  progress: number;
  slaInstanceId?: string;
  waitingClient?: { reason: string; since: string; responsibleId: string; evidence?: string };
  /** Dias úteis pausados por dependência do cliente. */
  externalDelayDays: number;
  internalDelayDays: number;
  checklist: ChecklistItem[];
  acceptance?: { acceptedAt: string; acceptedBy: string; notes?: string };
  /** Validação interna da implantação antes do aceite (Onda 3). */
  validation?: { validatedBy: string; validatedAt: string; notes?: string };
  /** Bloqueio interno ativo (atraso contado em internalDelayDays ao desbloquear). */
  blocked?: { reason: string; since: string; byId: string };
}

export interface ImplementationTask extends BaseEntity {
  projectId: string;
  clientId: string;
  phase: ImplementationPhase;
  title: string;
  description?: string;
  assigneeId?: string;
  dueAt?: string;
  status: TaskStatus;
  required: boolean;
  dependsOn?: string[];
  evidence?: string;
  completedAt?: string;
  taskId?: string;
}

export interface Training extends BaseEntity {
  clientId: string;
  projectId?: string;
  productId?: string;
  subject: string;
  instructorId: string;
  scheduledAt: string;
  completedAt?: string;
  participants: string[];
  materialUrl?: string;
  evidence?: string;
  notes?: string;
  status: "agendado" | "realizado" | "cancelado";
}

// ---------------------------------------------------------------------------
// Customer Success (Onda 3)
// ---------------------------------------------------------------------------

export interface CsAccount extends BaseEntity {
  clientId: string;
  ownerId: string;
  activatedAt?: string;
  adoptionPct: number;
  satisfaction?: number;
  lastInteractionAt?: string;
  nextInteractionAt?: string;
  riskLevel: HealthLevel;
  riskReasons: string[];
  renewalDate?: string;
  notes?: string;
}

export interface HealthScore extends BaseEntity {
  clientId: string;
  score: number;
  level: HealthLevel;
  /** Explicação do cálculo, para drill-down. */
  factors: { key: string; label: string; weight: number; value: number; contribution: number; note?: string }[];
  computedAt: string;
}

export interface SuccessPlan extends BaseEntity {
  clientId: string;
  ownerId: string;
  objective: string;
  actions: { id: string; description: string; responsibleId: string; dueAt: string; done: boolean; doneAt?: string; taskId?: string }[];
  checkpointAt?: string;
  result?: string;
  status: "ativo" | "concluido" | "cancelado";
  origin: "manual" | "automacao";
}

export interface Renewal extends BaseEntity {
  clientId: string;
  contractId: string;
  ownerId: string;
  dueDate: string;
  windowOpensAt: string;
  risk: HealthLevel;
  status: "aguardando" | "em_negociacao" | "renovado" | "perdido";
  result?: string;
  notes?: string;
}

export interface ChurnRecord extends BaseEntity {
  clientId: string;
  productIds: string[];
  lostMrr: number;
  reason: string;
  reasonCategory: "preco" | "concorrente" | "uso" | "tecnico" | "financeiro" | "fechamento" | "outro";
  responsibleId: string;
  date: string;
  context?: string;
  origin?: string;
}

// ---------------------------------------------------------------------------
// Suporte (Onda 3)
// ---------------------------------------------------------------------------

export type TicketPriority = "critico" | "alto" | "medio" | "baixo";
export type TicketStatus = "aberto" | "em_atendimento" | "aguardando_cliente" | "resolvido" | "fechado" | "reaberto";

export interface SupportTicket extends BaseEntity {
  number: string;
  clientId: string;
  contactId?: string;
  productId?: string;
  subject: string;
  description: string;
  channel: "whatsapp" | "telefone" | "email" | "portal" | "interno";
  priority: TicketPriority;
  category?: string;
  assigneeId?: string;
  queue: string;
  status: TicketStatus;
  openedAt: string;
  firstResponseAt?: string;
  resolvedAt?: string;
  closedAt?: string;
  solution?: string;
  rootCause?: string;
  slaInstanceId?: string;
  reopenedFromId?: string;
  reopenCount: number;
  csatScore?: number;
  originatedOpportunityId?: string;
  trainingRelated?: boolean;
  customerConfirmation?: "sim" | "pendente";
  csatRequestedAt?: string;
}

export interface TicketInteraction extends BaseEntity {
  ticketId: string;
  clientId: string;
  authorId?: string;
  kind: "mensagem" | "nota_interna" | "ligacao" | "whatsapp" | "email" | "status";
  body: string;
  attachments?: string[];
  durationSeconds?: number;
  recordingUrl?: string;
  channel?: "whatsapp" | "email" | "portal";
}

export interface CsatResponse extends BaseEntity {
  ticketId: string;
  clientId: string;
  attendantId?: string;
  productId?: string;
  score: number; // escala 0-10
  comment?: string;
  respondedAt: string;
}

export interface KnowledgeArticle extends BaseEntity {
  title: string;
  productId?: string;
  category?: string;
  body: string;
  tags: string[];
  authorId: string;
  views: number;
  published: boolean;
}

// ---------------------------------------------------------------------------
// Tarefas, comentários, documentos
// ---------------------------------------------------------------------------

export type TaskProcessType = "workflow" | "lead" | "opportunity" | "contract" | "project" | "ticket" | "cs" | "renewal" | "prospect";

export interface Task extends BaseEntity {
  title: string;
  description?: string;
  clientId?: string;
  clientName?: string;
  processType?: TaskProcessType;
  processId?: string;
  departmentId: DepartmentKey;
  assigneeId?: string;
  assigneeName?: string;
  creatorId: string;
  priority: Priority;
  dueAt?: string;
  startAt?: string;
  status: TaskStatus;
  checklist: ChecklistItem[];
  tags: string[];
  recurrence?: { freq: "diaria" | "semanal" | "mensal"; interval: number; until?: string };
  completedAt?: string;
  completedBy?: string;
  origin: "manual" | "workflow" | "automacao" | "evento";
  sourceEventId?: string;
  slaInstanceId?: string;
  order?: number;
}

export interface Comment extends BaseEntity {
  entityType: string;
  entityId: string;
  clientId?: string;
  authorId: string;
  authorName: string;
  body: string;
}

export interface Document extends BaseEntity {
  clientId?: string;
  entityType?: string;
  entityId?: string;
  name: string;
  url: string;
  mimeType?: string;
  size?: number;
  version: number;
  uploadedBy: string;
  category?: string;
}

// ---------------------------------------------------------------------------
// Eventos, timeline, notificações
// ---------------------------------------------------------------------------

export interface DomainEvent extends BaseEntity {
  type: EventType;
  occurredAt: string;
  actorId: string;
  actorName: string;
  clientId?: string;
  entityType?: string;
  entityId?: string;
  title: string;
  description?: string;
  payload: Record<string, unknown>;
  department?: DepartmentKey;
  handlerErrors?: string[];
}

export interface TimelineEvent extends BaseEntity {
  clientId: string;
  eventId: string;
  type: EventType;
  occurredAt: string;
  actorId: string;
  actorName: string;
  title: string;
  description?: string;
  entityType?: string;
  entityId?: string;
  department?: DepartmentKey;
  icon?: string;
}

export interface Notification extends BaseEntity {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  entityType?: string;
  entityId?: string;
  readAt?: string;
  eventId?: string;
}

// ---------------------------------------------------------------------------
// SLA
// ---------------------------------------------------------------------------

export interface SlaRule extends BaseEntity {
  key: string;
  name: string;
  appliesTo: "tarefa" | "workflow" | "chamado" | "implantacao" | "cs" | "oportunidade";
  department?: DepartmentKey;
  responseHours?: number;
  resolutionHours: number;
  businessHoursOnly: boolean;
  /** Percentual do prazo consumido em que entra em atenção / risco. */
  attentionPct: number;
  riskPct: number;
  active: boolean;
}

export interface SlaInstance extends BaseEntity {
  ruleKey: string;
  ruleName: string;
  entityType: "tarefa" | "workflow_step" | "chamado" | "projeto" | "cs" | "oportunidade";
  entityId: string;
  clientId?: string;
  ownerId?: string;
  department?: DepartmentKey;
  startedAt: string;
  responseDueAt?: string;
  respondedAt?: string;
  dueAt: string;
  status: "em_andamento" | "pausado" | "concluido" | "violado";
  pausedAt?: string;
  pausedTotalMs: number;
  pauseReason?: string;
  completedAt?: string;
  breachedAt?: string;
  attentionPct: number;
  riskPct: number;
  alertedRisk?: boolean;
  alertedBreach?: boolean;
  supersededBy?: string;
}

/** Estado de SLA calculado na leitura. */
export interface SlaView {
  state: SlaState;
  dueAt: string;
  remainingMs: number;
  consumedPct: number;
}

// ---------------------------------------------------------------------------
// Performance: KPIs, metas, bônus, comissões, gamificação (Onda 4)
// ---------------------------------------------------------------------------

export type KpiDirection = "maior_melhor" | "menor_melhor" | "faixa";

export interface Kpi extends BaseEntity {
  key: string;
  name: string;
  department: DepartmentKey | "empresa";
  description?: string;
  /** Identificador da função de cálculo em src/server/kpis/formulas.ts. */
  formula: string;
  source: string;
  period: "diario" | "semanal" | "mensal";
  unit: "numero" | "percentual" | "moeda" | "horas" | "dias";
  direction: KpiDirection;
  target?: number;
  targetMin?: number;
  targetMax?: number;
  attentionPct: number;
  weight: number;
  ownerId?: string;
  active: boolean;
}

export interface KpiSnapshot extends BaseEntity {
  kpiKey: string;
  period: string; // AAAA-MM ou AAAA-MM-DD
  scope: "empresa" | "departamento" | "usuario";
  scopeId?: string;
  value: number;
  target?: number;
  attainment?: number;
  status?: "atingida" | "atencao" | "critico";
  computedAt: string;
  /** IDs dos registros que compõem o número (drill-down). */
  sourceIds?: string[];
}

export interface Goal extends BaseEntity {
  kpiKey: string;
  scope: "empresa" | "departamento" | "usuario";
  scopeId?: string;
  period: string;
  target: number;
  weight: number;
}

export interface PerformanceResult extends BaseEntity {
  userId: string;
  period: string;
  results: { kpiKey: string; value: number; target: number; attainment: number; weight: number }[];
  overallAttainment: number;
}

export interface BonusRule extends BaseEntity {
  name: string;
  department: DepartmentKey;
  maxPctOfSalary: number;
  individualWeight: number;
  collectiveWeight: number;
  individualKpis: { kpiKey: string; weight: number; target: number }[];
  collectiveKpis: { kpiKey: string; weight: number; target: number }[];
  tiers: { minAttainment: number; payoutPct: number; label: string }[];
  blockers: { key: string; label: string }[];
  extras: { key: string; label: string; amount: number; unit: string }[];
  active: boolean;
  version: number;
}

export interface BonusResult extends BaseEntity {
  userId: string;
  ruleId: string;
  period: string;
  individualAttainment: number;
  collectiveAttainment: number;
  overallAttainment: number;
  tierLabel: string;
  payoutPct: number;
  projectedAmount: number;
  blocked: boolean;
  blockReason?: string;
  extrasAmount: number;
}

export interface BonusBlock extends BaseEntity {
  userId: string;
  period: string;
  blockerKey: string;
  reason: string;
  responsibleId: string;
  evidence?: string;
  notes?: string;
  status: "aberto" | "confirmado" | "revogado";
}

export interface CommissionRule extends BaseEntity {
  name: string;
  productId?: string;
  revenueType: "setup" | "recorrencia" | "hardware";
  mode: "percentual" | "valor";
  value: number;
  releaseCondition: "venda" | "contrato_assinado" | "pagamento" | "parcela";
  releaseInstallment?: number;
  active: boolean;
}

export interface Commission extends BaseEntity {
  userId: string;
  clientId: string;
  contractId?: string;
  opportunityId?: string;
  productId?: string;
  revenueType: "setup" | "recorrencia" | "hardware";
  baseAmount: number;
  amount: number;
  competence: string;
  status: "prevista" | "liberada" | "paga" | "cancelada";
  releaseAt?: string;
  paidAt?: string;
  ruleId?: string;
}

export interface GamificationPoints extends BaseEntity {
  userId: string;
  points: number;
  reason: string;
  sourceType?: string;
  sourceId?: string;
  period: string;
}

export interface GamificationCampaign extends BaseEntity {
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  departments: DepartmentKey[];
  /** Métrica: chave do registro de KPIs ou contagem de eventos de um tipo. */
  metric: { kind: "kpi"; kpiKey: string } | { kind: "evento"; eventType: EventType };
  target: number;
  prize?: string;
  participantIds: string[];
  status: "planejada" | "ativa" | "encerrada";
  ownerId: string;
}

export interface Achievement extends BaseEntity {
  userId: string;
  key: string;
  name: string;
  description?: string;
  icon?: string;
  unlockedAt: string;
}

// ---------------------------------------------------------------------------
// Workflow, gates, automações
// ---------------------------------------------------------------------------

export interface GateField {
  /** Caminho no contexto da instância (ex.: "lead.phone", "opportunity.billingData.document"). */
  path: string;
  label: string;
  type: "texto" | "numero" | "data" | "booleano" | "selecao";
  options?: string[];
}

export interface WorkflowStage {
  key: JourneyStage | string;
  name: string;
  department: DepartmentKey;
  order: number;
  description?: string;
  /** Papel padrão do responsável ao criar a etapa (usa gestor do departamento se vazio). */
  defaultAssigneeRole?: RoleKey;
  slaHours?: number;
  slaRuleKey?: string;
  gate: {
    name: string;
    requiredFields: GateField[];
    checklist: { key: string; label: string; required: boolean }[];
    requiresApproval: boolean;
    approverRole?: RoleKey;
    requiresDocuments?: boolean;
    exitCriteria: string;
  };
  autoTasks: { title: string; description?: string; dueInHours: number; priority: Priority }[];
}

export interface WorkflowTemplate extends BaseEntity {
  key: string;
  name: string;
  description?: string;
  version: number;
  published: boolean;
  stages: WorkflowStage[];
}

export interface WorkflowInstance extends BaseEntity {
  templateId: string;
  templateKey: string;
  templateVersion: number;
  clientId: string;
  clientName: string;
  title: string;
  currentStageKey: string;
  currentStepId?: string;
  status: "ativo" | "concluido" | "cancelado";
  startedAt: string;
  completedAt?: string;
  /** Referências para o gate ler campos (leadId, opportunityId, contractId, projectId...). */
  context: Record<string, string | undefined>;
  /** Valores preenchidos em gates, por etapa. */
  gateData: Record<string, Record<string, unknown>>;
}

export interface WorkflowStep extends BaseEntity {
  instanceId: string;
  clientId: string;
  clientName: string;
  templateKey: string;
  stageKey: string;
  stageName: string;
  department: DepartmentKey;
  order: number;
  status: WorkflowStepStatus;
  assigneeId?: string;
  assigneeName?: string;
  startedAt?: string;
  dueAt?: string;
  completedAt?: string;
  completedBy?: string;
  checklist: ChecklistItem[];
  fields: Record<string, unknown>;
  approval?: { requestedAt?: string; approvedAt?: string; approvedBy?: string; rejectedAt?: string; reason?: string };
  notes?: string;
  exceptionReason?: string;
  waitingClient?: { reason: string; since: string };
  slaInstanceId?: string;
  taskIds: string[];
}

export interface AutomationRule extends BaseEntity {
  name: string;
  description?: string;
  trigger: {
    type: "evento" | "agendado";
    eventType?: EventType;
    /** Frequência ("horaria" | "diaria" | "semanal"); regras antigas podem trazer expressão cron. */
    schedule?: string;
    /** Varredura nativa (src/server/automations/sweeps.ts) cuja frequência a regra agendada controla. */
    sweep?: string;
    /** Tipo de registro varrido por uma regra agendada (só registros em aberto). */
    entity?: "opportunity" | "lead" | "task" | "ticket" | "project" | "renewal" | "client";
  };
  conditions: { path: string; operator: "==" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "exists" | "older_than_hours"; value?: unknown }[];
  actions: {
    type: "criar_tarefa" | "notificar" | "mudar_status" | "iniciar_sla" | "criar_handoff" | "criar_plano_sucesso" | "webhook";
    params: Record<string, unknown>;
  }[];
  active: boolean;
  runCount: number;
  lastRunAt?: string;
  /** Última execução agendada (controle de frequência das regras agendadas). */
  lastScheduledAt?: string;
}

export interface AutomationRun extends BaseEntity {
  ruleId: string;
  ruleName: string;
  eventId?: string;
  status: "sucesso" | "erro" | "ignorada";
  detail?: string;
  ranAt: string;
  eventType?: string;
  entityType?: string;
  entityId?: string;
  clientId?: string;
  trigger?: "evento" | "agendado" | "manual";
  actions?: {
    type: AutomationRule["actions"][number]["type"];
    status: "sucesso" | "ignorada" | "erro" | "simulada";
    detail: string;
    effect?: string;
    clientId?: string;
    href?: string;
  }[];
  conditions?: { path: string; operator: AutomationRule["conditions"][number]["operator"]; expected?: unknown; actual: unknown; ok: boolean }[];
  depth?: number;
}

// ---------------------------------------------------------------------------
// Comunicação (adaptadores) e configurações
// ---------------------------------------------------------------------------

export interface Communication extends BaseEntity {
  clientId?: string;
  contactId?: string;
  channel: "whatsapp" | "voip" | "email" | "interno";
  direction: "entrada" | "saida";
  userId?: string;
  entityType?: string;
  entityId?: string;
  body?: string;
  templateKey?: string;
  status: "enviada" | "entregue" | "lida" | "falha" | "simulada" | "recebida";
  durationSeconds?: number;
  recordingUrl?: string;
  externalId?: string;
  provider: "mock" | "meta" | "twilio" | "outro";
}

export interface Settings extends BaseEntity {
  key: string;
  value: Record<string, unknown>;
  description?: string;
}

/** Usuário autenticado com dados de sessão. */
export interface CurrentUser extends User {
  isAdmin: boolean;
  isManager: boolean;
  isDirector: boolean;
}
