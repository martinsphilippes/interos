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
import type { EffectivePermissions, ModuleKey, PermissionKey, ScopeKind, ScreenKey } from "./permissions";

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
  /** Definições do construtor visual de processos (grafo de blocos). Ver `src/domain/workflow-graph.ts`. */
  processDefinitions: "process_definitions",
  /** Execuções das definições de processo (uma por gatilho disparado). */
  processRuns: "process_runs",
  /** Contadores transacionais de numeração (VEN, CT, PR…): um documento por prefixo e ano. Ver `nextNumber` em db.ts. */
  counters: "counters",
  /** Contas a pagar (títulos): comissões elegíveis, bônus e lançamentos manuais do Financeiro. */
  payables: "payables",
  /** Eventos de pagamento recebidos do provedor de cobrança (id `<provedor>_<eventId>`): deduplicação da baixa automática. */
  paymentEvents: "payment_events",
  /** Aditivos do MESMO contrato (id `cta_<contractId>_<n>`): itens, condições, renovação e reajuste com antes/depois. */
  contractAmendments: "contract_amendments",
  /** Fornecedores (credores de Contas a Pagar) — NÃO é cadastro de clientes. */
  suppliers: "suppliers",
  /**
   * Ajustes de acesso (A6): `role_<papel>` = ajustes do perfil; `user_<uid>` = exceções individuais. Somente
   * servidor (regra `if false`); ausência de documento = regra padrão do catálogo.
   */
  permissionProfiles: "permission_profiles",
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
  /**
   * Módulos ativos na empresa (A8). Ausente = todos. `inicio` e `admin` nunca são desativados. Módulo inativo nega
   * todo o módulo a todos (admin incluído), sem apagar dados.
   */
  activeModules?: ModuleKey[];
  /**
   * Módulos DESATIVADOS na empresa; ausente/vazio = todos ativos. Tem prioridade sobre `activeModules` (com ele, um
   * módulo novo do catálogo nasce ligado). `saveActiveModules` grava os dois campos.
   */
  inactiveModules?: ModuleKey[];
}

/**
 * Ajustes de acesso (A6), coleção `permission_profiles`. `grants` permite (true) ou nega (false) uma chave do
 * catálogo; chave ausente = valor do nível mais geral (perfil → regra padrão). `scopes` fixa o escopo de dados de
 * uma tela, sempre dentro dos escopos permitidos da tela.
 */
export interface PermissionProfile extends BaseEntity {
  /** "role" = perfil (papel), id `role_<papel>`; "user" = exceções de um usuário, id `user_<uid>`. */
  kind: "role" | "user";
  role?: RoleKey;
  userId?: string;
  grants: Partial<Record<PermissionKey, boolean>>;
  scopes: Partial<Record<ScreenKey, ScopeKind>>;
  /** Motivo (obrigatório nas exceções individuais). */
  reason?: string;
  updatedBy?: UserRef;
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
  /** Presença informada pelo próprio usuário na top bar (telas operacionais). */
  presence?: UserPresence;
  presenceUpdatedAt?: string;
}

export const USER_PRESENCES = ["online", "ausente", "ocupado"] as const;
export type UserPresence = (typeof USER_PRESENCES)[number];
export const USER_PRESENCE_LABELS: Record<UserPresence, string> = { online: "Online", ausente: "Ausente", ocupado: "Ocupado" };

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
  /** Opt-out de comunicação por canal (respeitado por `sendOrRecord`: nada é enviado e o registro fica "não enviada"). */
  communicationOptOut?: { whatsapp?: boolean; email?: boolean };
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
  /** Motivo do cancelamento pelo aditivo (item removido do contrato). */
  cancelReason?: string;
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
  channel:
    | "instagram"
    | "tiktok"
    | "site"
    | "whatsapp"
    | "telegram"
    | "anuncio"
    | "google_ads"
    | "indicacao"
    | "parceiro"
    | "contador"
    | "evento"
    | "lista"
    | "manual";
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
  /** Objetivo da ação (ex.: "Gerar reuniões qualificadas para apresentação de soluções"). */
  objective?: string;
  /** Período da ação (AAAA-MM-DD). */
  startDate?: string;
  endDate?: string;
  /** A lista respeita opt-out: contatos que pediram para não ser abordados ficam de fora. */
  optOut?: boolean;
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
  /** Número da venda "VEN-AAAA-NNNN", gravado quando a oportunidade é ganha (contador transacional). */
  saleNumber?: string;
  /** Condições estruturadas do fechamento (vendas antigas não têm; o contrato usa os padrões). */
  closing?: OpportunityClosing;
}

export const SALE_PAYMENT_METHODS = ["boleto", "pix", "cartao", "transferencia", "dinheiro"] as const;
export type SalePaymentMethod = (typeof SALE_PAYMENT_METHODS)[number];

/** Condições comerciais combinadas no fechamento da venda (bloco "Condições do fechamento" do WonDialog). */
export interface OpportunityClosing {
  paymentMethod: SalePaymentMethod;
  /** Dia de vencimento da mensalidade (1–28). */
  billingDay: number;
  /** 1º vencimento combinado (ISO); sem valor, o Financeiro usa o próximo dia de vencimento. */
  firstDueDate?: string;
  termMonths: number;
  recurrence: "mensal" | "anual" | "unico";
  /** Em quantas cobranças a adesão é dividida (1 = à vista). */
  setupInstallments: number;
  /** Contato responsável do cliente (vira o signatário principal do contrato). */
  contactId?: string;
  contactName?: string;
  implementationRequired: boolean;
  implementationNotes?: string;
  commercialNotes?: string;
  /** Proposta aceita usada como base dos itens (quando houver). */
  proposalId?: string;
  closedAt: string;
  closedBy: string;
  // Renovação (D26) — opcionais: vendas antigas não têm.
  autoRenew?: boolean;
  renewalTermMonths?: number;
  readjustment?: ContractReadjustment;
  noticeDays?: number;
}

/** Reajuste combinado para a renovação: nenhum, percentual informado ou índice (informado pelo CS a cada renovação). */
export interface ContractReadjustment {
  type: "nenhum" | "percentual" | "indice";
  percent?: number;
  index?: "ipca" | "igpm" | "inpc";
  /** Renovação automática com índice: o índice NÃO é buscado — renova sem reajuste e fica pendente para o CS informar. */
  pending?: boolean;
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
  /** Visita comercial (vendas) ou técnica (instalação, suporte presencial). Sem valor = comercial. */
  kind?: "comercial" | "tecnica";
}

export type ProposalStatus = "rascunho" | "enviada" | "visualizada" | "negociacao" | "aceita" | "recusada" | "vencida";

/**
 * Origem de um item incluído por aditivo (D25): a 1ª mensalidade que já o inclui e, quando houver, a cobrança avulsa
 * de adesão/hardware (nº da parcela) gerada pelo aditivo. O motor de comissões só planeja parcelas a partir daí —
 * mensalidades pagas antes do item não geram comissão sobre ele. Ausente = item no contrato desde a origem.
 */
export interface ItemSince {
  amendmentId: string;
  installment: number;
  setupInstallment?: number;
  hardwareInstallment?: number;
}

export interface ProposalItem {
  productId: string;
  productName: string;
  quantity: number;
  setupValue: number;
  monthlyValue: number;
  hardwareValue: number;
  discountPct: number;
  since?: ItemSince;
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

/** Signatário do contrato, com a evidência quando a assinatura é registrada manualmente. */
export interface ContractSignerEntry {
  name: string;
  email: string;
  role: string;
  signedAt?: string;
  status: "pendente" | "assinado" | "recusado";
  /** "manual": registrada pelo Financeiro com evidência; "provedor": confirmada pelo provedor de assinatura. */
  method?: "manual" | "provedor";
  /** Descrição da evidência (papel digitalizado, e-mail de aceite etc.). */
  evidence?: string;
  /** Link do documento assinado. */
  evidenceUrl?: string;
  registeredBy?: string;
  registeredAt?: string;
}

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
  signers: ContractSignerEntry[];
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
  // Campos do circuito Venda → Contrato (opcionais: contratos antigos não têm).
  /** Forma de pagamento combinada na venda (usada nas cobranças geradas). */
  paymentMethod?: SalePaymentMethod;
  /** Adesão dividida em N cobranças (1 = à vista). */
  setupInstallments?: number;
  /** false quando a venda não contratou implantação (o projeto é criado com aviso). */
  implementationRequired?: boolean;
  commercialNotes?: string;
  implementationNotes?: string;
  /** Número da venda (VEN-AAAA-NNNN) que originou o contrato. */
  saleNumber?: string;
  /** Vendedor da venda (dono da oportunidade). */
  sellerId?: string;
  /** Contato responsável do cliente (signatário principal). */
  contactId?: string;
  cancelledAt?: string;
  cancelReason?: string;
  cancelledBy?: string;
  // Renovação (D26) — opcionais: contratos antigos não têm (renovação pelo fluxo humano do CS).
  /** Renova automaticamente ao fim da vigência (varredura `renovacoes`). */
  autoRenew?: boolean;
  /** Prazo de cada renovação em meses (padrão: o prazo do contrato). */
  renewalTermMonths?: number;
  readjustment?: ContractReadjustment;
  /** Dias antes do fim da vigência em que a renovação automática é aplicada (padrão 30). */
  noticeDays?: number;
  // Aditivos e versões (D25) — opcionais.
  /** Aditivos APLICADOS a este contrato, na ordem (`contract_amendments`). */
  amendmentIds?: string[];
  /** Versões anteriores: snapshot completo de cada revisão pré-assinatura e de cada aditivo aplicado. */
  previousVersions?: ContractVersionEntry[];
}

/**
 * Snapshot das cláusulas que o documento/hash cobre: itens, totais e condições (+ signatários e vigência).
 * Guardado em `previousVersions` (versão anterior) e em `ContractAmendment.before/after`.
 */
export interface ContractSnapshot {
  version: number;
  items: ProposalItem[];
  setupTotal: number;
  monthlyTotal: number;
  hardwareTotal: number;
  billingDay: number;
  recurrence: Contract["recurrence"];
  termMonths: number;
  firstDueDate?: string;
  startDate?: string;
  endDate?: string;
  paymentMethod?: SalePaymentMethod;
  setupInstallments?: number;
  paymentCondition?: string;
  documentHash?: string;
  signers?: { name: string; email: string; role: string }[];
  autoRenew?: boolean;
  renewalTermMonths?: number;
  readjustment?: ContractReadjustment;
  noticeDays?: number;
}

/** Entrada de `Contract.previousVersions`: como o contrato estava antes da revisão/aditivo. */
export interface ContractVersionEntry {
  version: number;
  kind: "revisao" | "aditivo";
  at: string;
  by: string;
  reason?: string;
  amendmentId?: string;
  /** Documento gerado para assinatura naquela versão (quando havia). */
  envelopeId?: string;
  snapshot: ContractSnapshot;
}

export type ContractAmendmentKind = "itens" | "condicoes" | "renovacao" | "reajuste" | "misto";
export type ContractAmendmentStatus = "rascunho" | "aguardando_assinatura" | "assinado" | "aplicado" | "cancelado";

/**
 * Aditivo do MESMO contrato (D25): id `cta_<contractId>_<n>`, número `<contrato>-A<nn>`. Fluxo
 * rascunho → aguardando_assinatura → assinado → aplicado (ou cancelado). `before/after` são snapshots completos;
 * `changes` = de → para (auditChanges). A assinatura do aditivo tem hash próprio e NÃO altera o hash do contrato.
 */
export interface ContractAmendment extends BaseEntity {
  number: string;
  contractId: string;
  clientId: string;
  kind: ContractAmendmentKind;
  status: ContractAmendmentStatus;
  /** Vigência do aditivo (AAAA-MM-DD): cobranças abertas com competência ≥ esta data são refeitas. */
  effectiveFrom: string;
  reason: string;
  requiresSignature: boolean;
  before: ContractSnapshot;
  after: ContractSnapshot;
  changes: Record<string, { from: unknown; to: unknown }>;
  signers?: ContractSignerEntry[];
  documentHash?: string;
  sentAt?: string;
  signedAt?: string;
  appliedAt?: string;
  appliedBy?: string;
  /** Versão do contrato depois da aplicação. */
  appliedVersion?: number;
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
  /** Origem: página do contrato, renovação pelo CS ou renovação automática (varredura). */
  source?: "financeiro" | "renovacao_cs" | "renovacao_automatica";
  renewalId?: string;
  /** Reajuste aplicado na renovação (percentual) ou pendente (índice a informar). */
  readjustment?: ContractReadjustment;
  /** Renovação: meses acrescentados à vigência (mensalidades a gerar na aplicação). */
  renewalMonths?: number;
  /** Cobranças refeitas na aplicação (canceladas → recriadas com a mesma numeração). */
  billingsRebuilt?: { cancelled: string[]; created: string[] };
  /** Itens novos que exigem implantação: só aviso ao gestor (nenhum projeto automático). */
  implementationNoticeProductIds?: string[];
}

/** Situação da cobrança no provedor (ou no controle manual do boleto). */
export type BillingChargeStatus = "aguardando_emissao_manual" | "pendente" | "pago" | "vencido" | "cancelado" | "desconhecido";

/** Origem da baixa: registro manual do Financeiro, webhook do provedor ou conciliação (varredura). */
export type PaymentSource = "manual" | "provedor" | "conciliacao";

/** Dados do boleto (emitido no banco/ERP e registrado à mão, ou devolvido pelo provedor). */
export interface BillingBoleto {
  linhaDigitavel?: string;
  nossoNumero?: string;
  codigoBarras?: string;
  pdfUrl?: string;
  /** Documento em `documents` (categoria "Boleto") quando há PDF. */
  documentId?: string;
  emitidoEm?: string;
  banco?: string;
}

/** Pagamento estornado (a cobrança voltou a aberta/vencida). */
export interface BillingReversedPayment {
  paidAt: string;
  paidAmount: number;
  method?: string;
  source?: PaymentSource;
  externalPaymentId?: string;
  receiptDocumentId?: string;
  reversedAt: string;
  reversedBy: string;
  reason: string;
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
  // Boleto, provedor e baixa (etapa 4) — opcionais: cobranças antigas não têm.
  /** "manual" (boleto registrado à mão) ou nome do provedor de cobrança. */
  provider?: string;
  /** Id da cobrança no provedor. */
  externalId?: string;
  chargeStatus?: BillingChargeStatus;
  /** Link de pagamento (boleto/PIX) devolvido pelo provedor. */
  paymentUrl?: string;
  boleto?: BillingBoleto;
  pix?: { copiaECola?: string; qrCodeUrl?: string };
  /** Origem da baixa registrada. */
  paymentSource?: PaymentSource;
  /** Id do pagamento no provedor (deduplicação da baixa automática). */
  externalPaymentId?: string;
  /** Pagamento parcial recebido automaticamente que NÃO baixou a cobrança (pendência registrada). */
  partialPaidAmount?: number;
  partialPaidAt?: string;
  reversedPayments?: BillingReversedPayment[];
}

/**
 * Evento de pagamento recebido de fora (webhook do provedor ou conciliação). Id determinístico
 * `<provedor>_<eventId>`, criado com createIfAbsent ANTES da baixa: o reenvio do mesmo evento é "já processado".
 */
export interface PaymentEvent extends BaseEntity {
  provider: string;
  eventId: string;
  source: PaymentSource;
  billingId?: string;
  externalId?: string;
  externalPaymentId?: string;
  paidAmount?: number;
  paidAt?: string;
  receivedAt: string;
  result?: "processado" | "ja_processado" | "parcial" | "ignorado" | "erro";
  message?: string;
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
  /** Dados da venda congelados na criação do projeto (handoff Vendas → Implantação). Projetos antigos não têm. */
  saleSnapshot?: SaleSnapshot;
}

/** Resumo da venda entregue à Implantação (fotografia no momento da liberação do contrato). */
export interface SaleSnapshot {
  opportunityId?: string;
  saleNumber?: string;
  contractNumber?: string;
  sellerId?: string;
  contactId?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  paymentMethod?: SalePaymentMethod;
  commercialNotes?: string;
  implementationNotes?: string;
  /** false: a venda não contratou implantação (projeto criado apenas para não quebrar a jornada). */
  implementationRequired?: boolean;
  items: { productId: string; productName: string; quantity: number; setupValue: number; monthlyValue: number; hardwareValue: number }[];
  termMonths?: number;
  billingDay?: number;
  monthlyTotal: number;
  setupTotal: number;
  hardwareTotal: number;
  setupInstallments?: number;
  capturedAt: string;
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
  /** Contato feito fora do sistema (canal não conectado) e registrado à mão pelo atendente. */
  manual?: boolean;
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
  /** Módulo do produto (ex.: "PDV", "Fiscal", "Financeiro"). */
  module?: string;
  /** Problema/sintoma que o artigo resolve, como o cliente relata. */
  problem?: string;
  /** Palavras-chave de busca (termos que o cliente ou o atendente digitam). */
  keywords?: string[];
  /** Contadores do "Este artigo foi útil?". */
  helpful?: number;
  notHelpful?: number;
  /** Chamado que originou o artigo. */
  sourceTicketId?: string;
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

export type CommissionRevenueType = "setup" | "recorrencia" | "hardware";
/** Abrangência da regra (precedência: contrato > vendedor > produto > padrão). Regras antigas (sem campo) = "padrao". */
export type CommissionRuleScope = "padrao" | "vendedor" | "contrato";
/** Quando a comissão fica elegível. Regras antigas derivam do `releaseCondition` (ver src/server/commissions/rules.ts). */
export type CommissionTrigger = "venda" | "contrato_assinado" | "primeiro_pagamento" | "pagamento" | "permanencia" | "pagamento_e_permanencia" | "mensalidade_n";
/** Base de cálculo: valor contratado (itens líquidos do contrato) ou valor efetivamente recebido na cobrança. */
export type CommissionBaseSource = "contratado" | "recebido";

export interface CommissionRule extends BaseEntity {
  name: string;
  productId?: string;
  revenueType: CommissionRevenueType;
  mode: "percentual" | "valor";
  value: number;
  releaseCondition: "venda" | "contrato_assinado" | "pagamento" | "parcela";
  /**
   * N-ésima mensalidade paga. Recorrência: 1ª mensalidade que gera comissão (padrão 1; regras antigas "parcela": a N-ésima).
   * Gatilho "mensalidade_n": a comissão (de qualquer tipo) só é adquirida quando a N-ésima mensalidade é paga.
   */
  releaseInstallment?: number;
  active: boolean;
  // Motor v2 (D10) — todos opcionais: regras antigas continuam valendo como "padrão".
  scope?: CommissionRuleScope;
  /** Vendedor (scope "vendedor"). */
  userId?: string;
  /** Contrato da exceção (scope "contrato"). */
  contractId?: string;
  clientId?: string;
  /** Categoria de produto (alternativa ao productId). */
  productCategory?: ProductCategory;
  trigger?: CommissionTrigger;
  /** Carência em dias a partir do início do contrato (startDate, ou releasedAt). */
  minTenureDays?: number;
  /** Recorrência: quantas competências geram comissão a partir de `releaseInstallment` (null/ausente = enquanto ativo). */
  recurringCompetences?: number | null;
  baseSource?: CommissionBaseSource;
  /** Vigência (AAAA-MM-DD) comparada com a data da venda. */
  validFrom?: string;
  validTo?: string;
  /** true (padrão): substitui as regras de nível inferior para o tipo de receita; false: soma-se a elas. */
  overridesDefault?: boolean;
  /** Motivo (obrigatório em exceção por contrato). */
  reason?: string;
  approvedBy?: string;
  updatedBy?: string;
}

/**
 * Situação da comissão: prevista (projeção) → em_carencia / aguardando_recebimento → liberada ("Elegível") →
 * titulo_gerado → paga. cancelada (não adquirida), estornada (revertida manualmente) e bloqueada (retida pelo Financeiro).
 */
export type CommissionStatus = "prevista" | "em_carencia" | "aguardando_recebimento" | "liberada" | "titulo_gerado" | "paga" | "cancelada" | "bloqueada" | "estornada";

/** Passo da memória de cálculo (padrão do BonusBreakdown). */
export interface CommissionCalcStep {
  label: string;
  value: string;
  date?: string;
}

/** Regra efetiva congelada no documento da comissão. */
export interface CommissionRuleSnapshot {
  id: string;
  name: string;
  scope: CommissionRuleScope | "produto";
  revenueType: CommissionRevenueType;
  mode: "percentual" | "valor";
  value: number;
  trigger: CommissionTrigger;
  baseSource: CommissionBaseSource;
  minTenureDays: number;
  recurringCompetences: number | null;
  releaseInstallment: number;
  overridesDefault: boolean;
  userId?: string;
  contractId?: string;
  productId?: string;
  productCategory?: string;
  reason?: string;
  /** Origem da regra: documento em commission_rules ou padrão do cadastro do produto. */
  source: "regra" | "produto";
}

export interface CommissionHistoryEntry {
  at: string;
  by: string;
  byName?: string;
  from?: CommissionStatus;
  to: CommissionStatus;
  note?: string;
}

export interface Commission extends BaseEntity {
  userId: string;
  clientId: string;
  contractId?: string;
  opportunityId?: string;
  productId?: string;
  revenueType: CommissionRevenueType;
  baseAmount: number;
  amount: number;
  competence: string;
  status: CommissionStatus;
  releaseAt?: string;
  paidAt?: string;
  ruleId?: string;
  // Motor v2 (D11) — opcionais: comissões antigas não têm.
  /** COM-AAAA-NNNNN (numeração transacional). */
  code?: string;
  /** Chave de idempotência: contractId|revenueType|productId|parcela|ruleId (o id é com_<hash>). */
  sourceKey?: string;
  /** Parcela da chave: "s1".."sN" (adesão), "hw" (hardware), "m<N>" (N-ésima mensalidade). */
  slot?: string;
  saleNumber?: string;
  productName?: string;
  ruleSnapshot?: CommissionRuleSnapshot;
  calc?: { steps: CommissionCalcStep[]; formula: string };
  /** Cobrança que originou/libera a comissão. */
  billingId?: string;
  installment?: number;
  /** Gatilho "N-ésima mensalidade paga" (D27): cobrança da N-ésima mensalidade e o vencimento dela (previsão). */
  gateBillingId?: string;
  expectedAt?: string;
  /** Data em que ficou (ou fica, na carência) elegível. */
  eligibleAt?: string;
  payableId?: string;
  /** Títulos anteriores cancelados (a comissão voltou a Elegível). */
  previousPayableIds?: string[];
  cancelledAt?: string;
  cancelReason?: string;
  blockedReason?: string;
  reversedAt?: string;
  reverseReason?: string;
  reversedBy?: string;
  /** Título negativo que registra o estorno de uma comissão já paga. */
  reversalPayableId?: string;
  history?: CommissionHistoryEntry[];
}

// ---------------------------------------------------------------------------
// Contas a pagar (D13)
// ---------------------------------------------------------------------------

export type PayableStatus = "previsto" | "aprovado" | "a_pagar" | "pago" | "cancelado";
/** Categorias fixas do circuito + qualquer categoria do setting `contas_a_pagar` (valores antigos preservados). */
export type PayableCategory = "comissao_comercial" | "bonus" | "outros" | "estorno_comissao" | (string & {});
export type PayableOrigin = "comissao_automatica" | "bonus" | "manual" | "estorno" | "recorrencia";

/** Recorrência de um título manual: a varredura `contas_recorrentes` cria a próxima ocorrência 30 dias antes do vencimento. */
export interface PayableRecurrence {
  frequency: "mensal" | "anual";
  dayOfMonth: number;
  /** AAAA-MM-DD: nada é gerado depois desta data. */
  until?: string;
}

/** Fornecedor (credor de Contas a Pagar). Não é cliente. */
export interface Supplier extends BaseEntity {
  name: string;
  document?: string;
  email?: string;
  phone?: string;
  pixKey?: string;
  bank?: { banco?: string; agencia?: string; conta?: string };
  category?: string;
  notes?: string;
  active: boolean;
  updatedBy?: string;
}

export interface PayableHistoryEntry {
  at: string;
  by: string;
  byName?: string;
  action: string;
  from?: PayableStatus;
  to?: PayableStatus;
  reason?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
}

export interface Payable extends BaseEntity {
  /** PAG-AAAA-NNNNN (numeração transacional). */
  code?: string;
  creditorType: "colaborador" | "fornecedor";
  creditorId?: string;
  creditorName: string;
  category: PayableCategory;
  description: string;
  /** Negativo no estorno de comissão já paga (valor a recuperar). */
  amount: number;
  competence: string;
  dueDate: string;
  status: PayableStatus;
  origin: PayableOrigin;
  sourceIds: {
    commissionIds: string[];
    contractId?: string;
    opportunityId?: string;
    saleNumber?: string;
    billingId?: string;
    clientId?: string;
    /** Título original quando este registra um estorno. */
    reversalOf?: string;
  };
  approvedBy?: string;
  approvedAt?: string;
  scheduledBy?: string;
  scheduledAt?: string;
  paidAt?: string;
  paidBy?: string;
  paymentMethod?: string;
  receiptUrl?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
  notes?: string;
  history: PayableHistoryEntry[];
  // Contas a Pagar geral (D28) — opcionais: títulos antigos não têm.
  supplierId?: string;
  costCenter?: string;
  /** Parcela n de N (títulos parcelados: `pag_<base>_p<n>`). */
  installment?: number;
  installments?: number;
  /** Série recorrente (`seriesId`) e regra; ocorrências: `pag_rec_<seriesId>_<AAAA-MM>`. */
  seriesId?: string;
  recurrence?: PayableRecurrence;
  /** Anexos em `documents` (entityType "payable"). */
  attachmentIds?: string[];
  /** Vencido: aviso ao Financeiro já enviado (1× por título). */
  overdueNotifiedAt?: string;
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
  /**
   * "manual": contato feito fora do sistema (canal não conectado) e registrado à mão.
   * "simulada": legado de registros antigos; não é mais gravado.
   */
  status: "enviada" | "entregue" | "lida" | "falha" | "simulada" | "recebida" | "manual" | "nao_enviada";
  durationSeconds?: number;
  recordingUrl?: string;
  externalId?: string;
  /** "manual" = sem provedor (registro manual); "resend" = e-mail transacional; "mock" = legado. */
  provider: "mock" | "meta" | "twilio" | "outro" | "manual" | "resend";
  /** Última atualização de status vinda do provedor (webhook: entregue/lida/falha). */
  statusUpdatedAt?: string;
  /** Motivo de "falha"/"nao_enviada" (erro do provedor, opt-out, canal não conectado). */
  error?: string;
}

export interface Settings extends BaseEntity {
  key: string;
  value: Record<string, unknown>;
  description?: string;
}

/** Contador de numeração (coleção `counters`): último número emitido para prefixo + ano. */
export interface Counter extends BaseEntity {
  prefix: string;
  year?: string;
  value: number;
}

/** Usuário autenticado com dados de sessão. */
export interface CurrentUser extends User {
  isAdmin: boolean;
  isManager: boolean;
  isDirector: boolean;
  /** Permissões efetivas (catálogo + perfil + exceções + módulos ativos), resolvidas em getCurrentUser. */
  permissions: EffectivePermissions;
}
