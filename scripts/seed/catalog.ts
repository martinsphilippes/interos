/**
 * Catálogo e configuração: produtos, templates de implantação, origens de lead, campanhas,
 * settings, regras de SLA, template de workflow, KPIs, regras de comissão/bônus, automações
 * e base de conhecimento.
 */
import {
  COLLECTIONS,
  type AutomationRule,
  type BonusRule,
  type Campaign,
  type CommissionRule,
  type ImplementationPhase,
  type ImplementationTemplate,
  type KnowledgeArticle,
  type LeadSource,
  type Product,
  type Settings,
  type SlaRule,
  type WorkflowStage,
  type WorkflowTemplate,
} from "../../src/domain/types";
import type { Priority, RoleKey } from "../../src/domain/constants";
import { daysAgo, daysFromNow, type SeedDoc } from "./lib";
import type { SeedContext } from "./context";
import { seedKpiDefinitions } from "./kpis";
import { DEFAULT_GAMIFICATION, DEFAULT_SALES_PRIZES } from "../../src/server/performance/schemas";

const createdAt = daysAgo(400);

// ---------------------------------------------------------------------------
// Produtos
// ---------------------------------------------------------------------------

const DEFAULT_COMMISSION = { setupPct: 25, recurringPct: 100, hardwarePct: 2.5, recurringReleaseInstallment: 3 };

export const PRODUCT_IDS = {
  erpIntersys: "prod_erp_intersys",
  erpGdoor: "prod_erp_gdoor",
  tef: "prod_tef",
  maquininha: "prod_maquininha",
  ponto: "prod_ponto",
  internotas: "prod_internotas",
  telefonia: "prod_telefonia",
  pabx: "prod_pabx",
  omnichannel: "prod_omnichannel",
  banco: "prod_banco",
  certificado: "prod_certificado",
  consultoria: "prod_consultoria",
} as const;

const PRODUCTS: (SeedDoc<Product> & { id: string })[] = [
  { id: PRODUCT_IDS.erpIntersys, name: "ERP Intersys", category: "erp", description: "ERP completo para varejo, atacado e serviços: PDV, estoque, fiscal e financeiro.", setupPrice: 1500, monthlyPrice: 350, hardwarePrice: 0, billingType: "recorrente", commission: DEFAULT_COMMISSION, implementationTemplateId: "tpl_impl_erp", implementationDays: 10, active: true, order: 1 },
  { id: PRODUCT_IDS.erpGdoor, name: "ERP Gdoor Web", category: "erp", description: "ERP em nuvem para pequenos negócios com emissão fiscal e controle financeiro.", setupPrice: 1200, monthlyPrice: 290, hardwarePrice: 0, billingType: "recorrente", commission: DEFAULT_COMMISSION, implementationTemplateId: "tpl_impl_erp", implementationDays: 10, active: true, order: 2 },
  { id: PRODUCT_IDS.tef, name: "TEF", category: "tef", description: "Transferência eletrônica de fundos integrada ao PDV.", setupPrice: 400, monthlyPrice: 89, hardwarePrice: 0, billingType: "recorrente", commission: DEFAULT_COMMISSION, implementationTemplateId: "tpl_impl_tef", implementationDays: 3, active: true, order: 3 },
  { id: PRODUCT_IDS.maquininha, name: "Maquininha Pague Assim", category: "maquininha", description: "Maquininha de cartão Pague Assim com taxas negociadas.", setupPrice: 0, monthlyPrice: 0, hardwarePrice: 690, billingType: "unico", commission: DEFAULT_COMMISSION, implementationTemplateId: "tpl_impl_maquininha", implementationDays: 1, active: true, order: 4 },
  { id: PRODUCT_IDS.ponto, name: "Intercert Ponto", category: "ponto", description: "Controle de ponto eletrônico com app e relatórios.", setupPrice: 300, monthlyPrice: 79, hardwarePrice: 0, billingType: "recorrente", commission: DEFAULT_COMMISSION, implementationTemplateId: "tpl_impl_ponto", implementationDays: 3, active: true, order: 5 },
  { id: PRODUCT_IDS.internotas, name: "Internotas", category: "notas", description: "Emissão de NF-e, NFC-e e NFS-e em nuvem.", setupPrice: 200, monthlyPrice: 59, hardwarePrice: 0, billingType: "recorrente", commission: DEFAULT_COMMISSION, implementationTemplateId: "tpl_impl_notas", implementationDays: 2, active: true, order: 6 },
  { id: PRODUCT_IDS.telefonia, name: "Telefonia", category: "telefonia", description: "Telefonia VoIP com números locais e gravação.", setupPrice: 250, monthlyPrice: 120, hardwarePrice: 0, billingType: "recorrente", commission: DEFAULT_COMMISSION, implementationTemplateId: "tpl_impl_telefonia", implementationDays: 5, active: true, order: 7 },
  { id: PRODUCT_IDS.pabx, name: "PABX Virtual", category: "pabx", description: "Central telefônica em nuvem com URA e filas.", setupPrice: 500, monthlyPrice: 190, hardwarePrice: 0, billingType: "recorrente", commission: DEFAULT_COMMISSION, implementationTemplateId: "tpl_impl_pabx", implementationDays: 5, active: true, order: 8 },
  { id: PRODUCT_IDS.omnichannel, name: "Omnichannel", category: "omnichannel", description: "Atendimento unificado: WhatsApp, Instagram e chat com múltiplos atendentes.", setupPrice: 800, monthlyPrice: 249, hardwarePrice: 0, billingType: "recorrente", commission: DEFAULT_COMMISSION, implementationTemplateId: "tpl_impl_omnichannel", implementationDays: 7, active: true, order: 9 },
  { id: PRODUCT_IDS.banco, name: "Banco Intercert", category: "banco", description: "Conta digital PJ integrada ao ERP, sem mensalidade.", setupPrice: 0, monthlyPrice: 0, hardwarePrice: 0, billingType: "unico", commission: DEFAULT_COMMISSION, active: true, order: 10 },
  { id: PRODUCT_IDS.certificado, name: "Certificado Digital A1", category: "certificado", description: "Certificado digital A1 (validade de 1 ano).", setupPrice: 220, monthlyPrice: 0, hardwarePrice: 0, billingType: "unico", commission: DEFAULT_COMMISSION, active: true, order: 11 },
  { id: PRODUCT_IDS.consultoria, name: "Consultoria Vilela", category: "consultoria", description: "Consultoria de gestão e processos com a equipe Vilela.", setupPrice: 2500, monthlyPrice: 0, hardwarePrice: 0, billingType: "unico", commission: DEFAULT_COMMISSION, active: true, order: 12 },
];

// ---------------------------------------------------------------------------
// Templates de implantação
// ---------------------------------------------------------------------------

type PhaseSpec = ImplementationTemplate["phases"][number];
const PHASE_NAMES: Record<ImplementationPhase, string> = {
  kickoff: "Kickoff",
  validacao_escopo: "Validação de escopo",
  configuracao: "Configuração",
  migracao: "Migração de dados",
  integracao: "Integração",
  treinamento: "Treinamento",
  validacao: "Validação",
  go_live: "Go-live",
};

function phase(key: ImplementationPhase, order: number, tasks: [string, number, boolean?][], checklist: [string, boolean?][]): PhaseSpec {
  return {
    key,
    name: PHASE_NAMES[key],
    order,
    tasks: tasks.map(([title, dueInDays, required]) => ({ title, dueInDays, required: required ?? true, role: "implantacao" as RoleKey })),
    checklist: checklist.map(([label, required]) => ({ label, required: required ?? true })),
  };
}

const KICKOFF = (days = 1) => phase("kickoff", 1, [["Reunião de kickoff com o cliente", days], ["Coletar dados cadastrais e fiscais", days], ["Definir cronograma com o cliente", days, false]], [["Contato responsável confirmado"], ["Cronograma aprovado"]]);
const GO_LIVE = (order: number, days: number) => phase("go_live", order, [["Acompanhar primeiro dia de operação", days], ["Coletar aceite formal do cliente", days], ["Registrar handoff para o CS", days]], [["Aceite do cliente assinado"], ["Handoff para CS registrado"]]);

const TEMPLATES: (SeedDoc<ImplementationTemplate> & { id: string })[] = [
  {
    id: "tpl_impl_erp",
    name: "Implantação ERP",
    productId: PRODUCT_IDS.erpIntersys,
    totalDays: 10,
    active: true,
    phases: [
      KICKOFF(1),
      phase("validacao_escopo", 2, [["Validar módulos contratados com o escopo do contrato", 1], ["Levantar regime tributário e certificado digital", 1], ["Mapear processos críticos do cliente", 2, false]], [["Escopo validado com o cliente"], ["Certificado digital disponível"]]),
      phase("configuracao", 3, [["Criar base e usuários no ERP", 1], ["Configurar parâmetros fiscais (NF-e/NFC-e)", 2], ["Configurar PDV e impressoras", 2], ["Configurar plano de contas e financeiro", 2, false]], [["Ambiente criado"], ["Parâmetros fiscais homologados"], ["PDV testado"]]),
      phase("migracao", 4, [["Importar cadastro de produtos", 2], ["Importar clientes e fornecedores", 1], ["Conferir saldos de estoque", 1, false]], [["Produtos importados e conferidos"], ["Clientes importados"]]),
      phase("integracao", 5, [["Integrar TEF e meios de pagamento", 1, false], ["Integrar contador (exportação fiscal)", 1, false]], [["Integrações testadas", false]]),
      phase("treinamento", 6, [["Treinamento de PDV e caixa", 1], ["Treinamento de estoque e compras", 1], ["Treinamento financeiro e fiscal", 1]], [["Equipe do cliente treinada"], ["Material de apoio entregue"]]),
      phase("validacao", 7, [["Emitir notas em homologação", 1], ["Simular dia completo de operação", 1], ["Corrigir pendências levantadas", 1, false]], [["Notas fiscais autorizadas"], ["Simulação aprovada pelo cliente"]]),
      GO_LIVE(8, 1),
    ],
  },
  {
    id: "tpl_impl_tef",
    name: "Implantação TEF",
    productId: PRODUCT_IDS.tef,
    totalDays: 3,
    active: true,
    phases: [
      KICKOFF(1),
      phase("configuracao", 2, [["Cadastrar estabelecimento na adquirente", 1], ["Instalar e configurar cliente TEF no PDV", 1]], [["Estabelecimento credenciado"], ["TEF instalado no PDV"]]),
      phase("integracao", 3, [["Integrar TEF ao PDV do ERP", 1], ["Testar transações de crédito, débito e PIX", 1]], [["Transações de teste aprovadas"]]),
      phase("treinamento", 4, [["Treinar operadores de caixa no TEF", 1, false]], [["Operadores treinados", false]]),
      GO_LIVE(5, 1),
    ],
  },
  {
    id: "tpl_impl_maquininha",
    name: "Entrega Maquininha Pague Assim",
    productId: PRODUCT_IDS.maquininha,
    totalDays: 1,
    active: true,
    phases: [
      KICKOFF(1),
      phase("configuracao", 2, [["Ativar maquininha e vincular conta", 1], ["Entregar e testar no cliente", 1]], [["Maquininha ativada"], ["Primeira transação realizada"]]),
      GO_LIVE(3, 1),
    ],
  },
  {
    id: "tpl_impl_telefonia",
    name: "Implantação Telefonia",
    productId: PRODUCT_IDS.telefonia,
    totalDays: 5,
    active: true,
    phases: [
      KICKOFF(1),
      phase("configuracao", 2, [["Provisionar números e ramais", 2], ["Configurar aparelhos ou softphones", 1]], [["Números ativos"], ["Ramais configurados"]]),
      phase("integracao", 3, [["Solicitar portabilidade numérica", 2, false], ["Integrar gravação de chamadas", 1, false]], [["Portabilidade solicitada", false]]),
      phase("treinamento", 4, [["Treinar equipe no uso dos ramais", 1]], [["Equipe treinada"]]),
      GO_LIVE(5, 1),
    ],
  },
  {
    id: "tpl_impl_pabx",
    name: "Implantação PABX Virtual",
    productId: PRODUCT_IDS.pabx,
    totalDays: 5,
    active: true,
    phases: [
      KICKOFF(1),
      phase("validacao_escopo", 2, [["Desenhar árvore da URA com o cliente", 1], ["Definir filas e horários de atendimento", 1]], [["URA aprovada pelo cliente"]]),
      phase("configuracao", 3, [["Configurar URA, filas e ramais", 2], ["Gravar mensagens de saudação", 1, false]], [["URA configurada"], ["Filas testadas"]]),
      phase("treinamento", 4, [["Treinar atendentes e supervisores", 1]], [["Equipe treinada"]]),
      GO_LIVE(5, 1),
    ],
  },
  {
    id: "tpl_impl_omnichannel",
    name: "Implantação Omnichannel",
    productId: PRODUCT_IDS.omnichannel,
    totalDays: 7,
    active: true,
    phases: [
      KICKOFF(1),
      phase("validacao_escopo", 2, [["Mapear canais e equipes de atendimento", 1], ["Definir fluxo de distribuição de conversas", 1]], [["Canais definidos"], ["Fluxo aprovado"]]),
      phase("configuracao", 3, [["Conectar WhatsApp Business API", 2], ["Conectar Instagram e chat do site", 1], ["Criar filas, etiquetas e respostas rápidas", 1]], [["WhatsApp conectado"], ["Filas configuradas"]]),
      phase("integracao", 4, [["Integrar cadastro de clientes do ERP", 1, false]], [["Integração com ERP testada", false]]),
      phase("treinamento", 5, [["Treinar atendentes na plataforma", 1], ["Treinar gestores nos relatórios", 1, false]], [["Atendentes treinados"]]),
      GO_LIVE(6, 1),
    ],
  },
  {
    id: "tpl_impl_ponto",
    name: "Implantação Intercert Ponto",
    productId: PRODUCT_IDS.ponto,
    totalDays: 3,
    active: true,
    phases: [
      KICKOFF(1),
      phase("configuracao", 2, [["Cadastrar colaboradores e jornadas", 1], ["Configurar app e geolocalização", 1]], [["Colaboradores cadastrados"], ["Jornadas configuradas"]]),
      phase("treinamento", 3, [["Treinar RH e colaboradores", 1]], [["RH treinado"]]),
      GO_LIVE(4, 1),
    ],
  },
  {
    id: "tpl_impl_notas",
    name: "Implantação Internotas",
    productId: PRODUCT_IDS.internotas,
    totalDays: 2,
    active: true,
    phases: [
      KICKOFF(1),
      phase("configuracao", 2, [["Cadastrar empresa e certificado digital", 1], ["Configurar séries e numeração", 1]], [["Certificado instalado"], ["Séries configuradas"]]),
      phase("validacao", 3, [["Emitir nota de teste em homologação", 1], ["Emitir primeira nota em produção", 1]], [["Nota autorizada pela SEFAZ"]]),
      GO_LIVE(4, 1),
    ],
  },
];

// ---------------------------------------------------------------------------
// Origens de lead e campanhas
// ---------------------------------------------------------------------------

const LEAD_SOURCES: (SeedDoc<LeadSource> & { id: string })[] = [
  { id: "src_instagram", key: "instagram", name: "Instagram", channel: "instagram", active: true },
  { id: "src_tiktok", key: "tiktok", name: "TikTok", channel: "tiktok", active: true },
  { id: "src_site", key: "site", name: "Site (formulário)", channel: "site", active: true },
  { id: "src_whatsapp", key: "whatsapp", name: "WhatsApp", channel: "whatsapp", active: true },
  { id: "src_telegram", key: "telegram", name: "Telegram", channel: "telegram", active: true },
  { id: "src_anuncio", key: "anuncio", name: "Anúncios (Meta/Google)", channel: "anuncio", active: true },
  { id: "src_indicacao", key: "indicacao", name: "Indicação de cliente", channel: "indicacao", active: true },
  { id: "src_contador", key: "contador", name: "Contador parceiro", channel: "contador", active: true },
  { id: "src_evento", key: "evento", name: "Evento / feira", channel: "evento", active: true },
  { id: "src_lista", key: "lista", name: "Lista de prospecção", channel: "lista", active: true },
  { id: "src_manual", key: "manual", name: "Cadastro manual", channel: "manual", active: true },
];
export const LEAD_SOURCE_KEYS = LEAD_SOURCES.map((s) => s.key);

export const CAMPAIGN_IDS = ["camp_001", "camp_002", "camp_003", "camp_004", "camp_005", "camp_006"];
const CAMPAIGNS: (SeedDoc<Campaign> & { id: string })[] = [
  { id: "camp_001", name: "ERP + TEF para supermercados do Cariri", channel: "anuncio", startDate: daysAgo(40), budget: 6000, spent: 3850.4, status: "ativa", ownerId: "user_mateus" },
  { id: "camp_002", name: "Farmácias: Internotas e certificado digital", channel: "instagram", startDate: daysAgo(25), budget: 2500, spent: 1120, status: "ativa", ownerId: "user_luciano" },
  { id: "camp_003", name: "Indicação premiada: cliente indica cliente", channel: "indicacao", startDate: daysAgo(90), budget: 3000, spent: 1250, status: "ativa", ownerId: "user_mateus" },
  { id: "camp_004", name: "Feira do Empreendedor Juazeiro 2026", channel: "evento", startDate: daysAgo(150), endDate: daysAgo(120), budget: 8000, spent: 8420, status: "encerrada", ownerId: "user_mateus" },
  { id: "camp_005", name: "Omnichannel para lojas de roupas (TikTok)", channel: "tiktok", startDate: daysAgo(110), endDate: daysAgo(60), budget: 1800, spent: 1795.5, status: "encerrada", ownerId: "user_luciano" },
  { id: "camp_006", name: "Black Friday: pacote ERP + maquininha", channel: "anuncio", startDate: daysFromNow(35), endDate: daysFromNow(70), budget: 9000, spent: 0, status: "planejada", ownerId: "user_mateus" },
];

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const HOLIDAYS = [
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-04-03", "2026-04-21", "2026-05-01", "2026-06-04", "2026-09-07", "2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20", "2026-12-25",
  "2027-01-01", "2027-02-08", "2027-02-09", "2027-03-26", "2027-04-21", "2027-05-01", "2027-05-27", "2027-09-07", "2027-10-12", "2027-11-02", "2027-11-15", "2027-11-20", "2027-12-25",
];

export const LEAD_SCORING = {
  origem: { indicacao: 30, contador: 25, site: 20, whatsapp: 20, evento: 18, anuncio: 15, instagram: 12, tiktok: 8, telegram: 8, lista: 5, manual: 10 } as Record<string, number>,
  interesse: { erp: 30, tef: 20, omnichannel: 18, pabx: 15, telefonia: 12, maquininha: 10, ponto: 10, notas: 10, certificado: 5, consultoria: 15 } as Record<string, number>,
  cidade: { "Juazeiro do Norte": 20, Crato: 18, Barbalha: 18, Fortaleza: 12, Sobral: 10, Iguatu: 10, Petrolina: 8, "Campina Grande": 8, Mossoró: 8 } as Record<string, number>,
  limiares: { quente: 70, morno: 40 },
};

const SETTINGS: (SeedDoc<Settings> & { id: string })[] = [
  { id: "setting_feriados", key: "feriados", description: "Feriados nacionais considerados no cálculo de SLA em horas úteis.", value: { dates: HOLIDAYS } },
  { id: "setting_lead_scoring", key: "lead_scoring", description: "Pontuação de leads por origem, interesse e cidade; limiares de temperatura.", value: LEAD_SCORING },
  { id: "setting_metas_referencia", key: "metas_referencia", description: "Metas de referência da empresa.", value: { csat: 8.5, churnMax: 0.03, reincidenciaMax: 0.1, slaSuporte: 0.9, implantacaoPrazo: 0.9, ativacao7dias: 0.8, mrrCrescimento: 0.08, ticketMedio: 350 } },
  { id: "setting_health_score", key: "health_score", description: "Pesos e limiares do health score de clientes.", value: { pesos: { uso: 25, satisfacao: 20, sla: 15, suporte: 15, reincidencia: 10, financeiro: 15 }, limiares: { saudavel: 75, atencao: 50 } } },
  { id: "setting_horario_comercial", key: "horario_comercial", description: "Expediente considerado pelo SLA.", value: { inicio: 8, fim: 18, dias: [1, 2, 3, 4, 5] } },
  { id: "setting_oportunidade", key: "oportunidade", description: "Parâmetros de acompanhamento de oportunidades.", value: { diasSemMovimentoParaParada: 7, horasSemInteracaoFollowup: 48 } },
  { id: "setting_go_live", key: "go_live", description: "Regras de aprovação do go-live da implantação.", value: { exigeAprovacaoGestor: true } },
  { id: "setting_cs_ativacao", key: "cs_ativacao", description: "Critérios do gate de ativação do cliente pelo Customer Success.", value: { adocaoMinimaPct: 30, exigePlano: true } },
  { id: "setting_gamificacao", key: "gamificacao", description: "Pontos por evento, multiplicadores de equivalência entre funções e níveis da gamificação.", value: { ...DEFAULT_GAMIFICATION } },
  { id: "setting_premios_vendas", key: "premios_vendas", description: "Prêmios por meta mensal batida em Vendas (adesão, recorrência, hardware) e valor do salário mínimo de referência.", value: { ...DEFAULT_SALES_PRIZES } },
];

// ---------------------------------------------------------------------------
// Regras de SLA
// ---------------------------------------------------------------------------

const sla = (key: string, name: string, appliesTo: SlaRule["appliesTo"], resolutionHours: number, extra: Partial<SlaRule> = {}): SeedDoc<SlaRule> & { id: string } => ({
  id: `sla_${key.replace(".", "_")}`,
  key,
  name,
  appliesTo,
  resolutionHours,
  businessHoursOnly: true,
  attentionPct: 50,
  riskPct: 80,
  active: true,
  ...extra,
});

const SLA_RULES = [
  sla("suporte.critico", "Suporte — Crítico (sistema parado)", "chamado", 4, { responseHours: 0.25, businessHoursOnly: false, department: "suporte" }),
  sla("suporte.alto", "Suporte — Alto (impacto na operação)", "chamado", 10, { responseHours: 2, department: "suporte" }),
  sla("suporte.medio", "Suporte — Médio (dificuldade operacional)", "chamado", 20, { responseHours: 8, department: "suporte" }),
  sla("suporte.baixo", "Suporte — Baixo (dúvida ou ajuste)", "chamado", 30, { responseHours: 24, department: "suporte" }),
  sla("workflow.marketing", "Workflow — Marketing (qualificação)", "workflow", 20, { department: "marketing" }),
  sla("workflow.vendas", "Workflow — Vendas (fechamento)", "workflow", 150, { department: "vendas" }),
  sla("workflow.financeiro", "Workflow — Financeiro (liberação)", "workflow", 30, { department: "financeiro" }),
  sla("workflow.implantacao", "Workflow — Implantação (go-live)", "workflow", 100, { department: "implantacao" }),
  sla("workflow.cs", "Workflow — CS (ativação)", "workflow", 70, { department: "cs" }),
  sla("tarefa.padrao", "Tarefa padrão", "tarefa", 10),
  sla("implantacao.projeto", "Projeto de implantação", "implantacao", 100, { department: "implantacao" }),
  sla("oportunidade.followup", "Follow-up de oportunidade", "oportunidade", 48, { businessHoursOnly: false, department: "vendas" }),
];

// ---------------------------------------------------------------------------
// Template de workflow: jornada do cliente
// ---------------------------------------------------------------------------

const field = (path: string, label: string, type: WorkflowStage["gate"]["requiredFields"][number]["type"] = "texto") => ({ path, label, type });
const check = (key: string, label: string, required = true) => ({ key, label, required });
const auto = (title: string, dueInHours: number, priority: Priority, description?: string) => ({ title, dueInHours, priority, description });

export const WORKFLOW_TEMPLATE_ID = "wft_jornada_cliente_v1";
const JOURNEY_STAGES_SPEC: WorkflowStage[] = [
  {
    key: "marketing",
    name: "Marketing",
    department: "marketing",
    order: 1,
    description: "Captação e qualificação do lead até virar MQL.",
    defaultAssigneeRole: "marketing",
    slaRuleKey: "workflow.marketing",
    gate: {
      name: "MQL",
      requiredFields: [field("lead.phone", "Telefone válido"), field("lead.interest", "Interesse declarado"), field("lead.consent", "Consentimento LGPD", "booleano"), field("lead.score", "Score mínimo", "numero")],
      checklist: [check("contato_validado", "Contato validado por telefone ou WhatsApp"), check("interesse_registrado", "Interesse e produto registrados"), check("consentimento", "Consentimento LGPD registrado"), check("origem", "Origem e campanha preenchidas", false)],
      requiresApproval: false,
      exitCriteria: "MQL: contato válido + interesse + consentimento LGPD + score mínimo.",
    },
    autoTasks: [auto("Validar contato do lead", 4, "alta", "Ligar ou chamar no WhatsApp para confirmar telefone e interesse."), auto("Registrar consentimento LGPD", 8, "media"), auto("Pontuar e classificar o lead", 8, "media")],
  },
  {
    key: "vendas",
    name: "Vendas",
    department: "vendas",
    order: 2,
    description: "Diagnóstico, proposta e fechamento do negócio.",
    defaultAssigneeRole: "vendas",
    slaRuleKey: "workflow.vendas",
    gate: {
      name: "Negócio ganho",
      requiredFields: [field("opportunity.products", "Produtos da oportunidade"), field("opportunity.monthlyTotal", "Valor mensal", "numero"), field("opportunity.billingData.document", "CNPJ/CPF de faturamento")],
      checklist: [check("diagnostico", "Diagnóstico registrado"), check("proposta_enviada", "Proposta enviada"), check("proposta_aceita", "Proposta aceita pelo cliente"), check("dados_faturamento", "Dados de faturamento conferidos"), check("visita", "Visita ou reunião realizada", false)],
      requiresApproval: false,
      exitCriteria: "Negócio ganho: proposta aceita + produto + valor + dados de faturamento.",
    },
    autoTasks: [auto("Fazer diagnóstico com o lead", 24, "alta"), auto("Enviar proposta comercial", 72, "alta"), auto("Follow-up da proposta", 120, "media")],
  },
  {
    key: "financeiro",
    name: "Financeiro",
    department: "financeiro",
    order: 3,
    description: "Contrato, assinatura e confirmação de pagamento.",
    defaultAssigneeRole: "financeiro",
    slaRuleKey: "workflow.financeiro",
    gate: {
      name: "Liberação financeira",
      requiredFields: [field("contract.number", "Número do contrato"), field("contract.signedAt", "Data de assinatura", "data"), field("contract.financialStatus", "Situação financeira", "selecao")],
      checklist: [check("contrato_gerado", "Contrato gerado com todos os produtos"), check("assinatura", "Contrato assinado"), check("pagamento", "Pagamento ou condição aprovada"), check("escopo", "Escopo validado com a venda")],
      requiresApproval: true,
      approverRole: "financeiro",
      requiresDocuments: true,
      exitCriteria: "Contrato assinado + pagamento/condição aprovada.",
    },
    autoTasks: [auto("Gerar e enviar contrato para assinatura", 8, "alta"), auto("Confirmar pagamento da adesão", 24, "alta"), auto("Liberar cliente para implantação", 4, "critica")],
  },
  {
    key: "implantacao",
    name: "Implantação",
    department: "implantacao",
    order: 4,
    description: "Projeto de implantação até o go-live com aceite do cliente.",
    defaultAssigneeRole: "implantacao",
    slaRuleKey: "workflow.implantacao",
    gate: {
      name: "Go-live",
      requiredFields: [field("project.checklist", "Checklist de implantação concluído"), field("project.trainingDone", "Treinamento realizado", "booleano"), field("project.acceptance", "Aceite do cliente")],
      checklist: [check("kickoff", "Kickoff realizado"), check("configuracao", "Sistema configurado"), check("treinamento", "Treinamento realizado"), check("aceite", "Aceite do cliente registrado"), check("handoff", "Handoff para CS", false)],
      requiresApproval: true,
      approverRole: "gestor",
      exitCriteria: "Go-live: checklist + treinamento + aceite do cliente.",
    },
    autoTasks: [auto("Agendar kickoff com o cliente", 8, "alta"), auto("Executar checklist de implantação", 60, "alta"), auto("Registrar aceite e go-live", 8, "critica")],
  },
  {
    key: "cs",
    name: "Customer Success",
    department: "cs",
    order: 5,
    description: "Ativação do cliente: adoção mínima, responsável e plano de sucesso.",
    defaultAssigneeRole: "cs",
    slaRuleKey: "workflow.cs",
    gate: {
      name: "Cliente ativado",
      requiredFields: [field("cs.adoptionPct", "Adoção mínima (%)", "numero"), field("cs.ownerId", "Responsável de CS"), field("cs.successPlanId", "Plano de sucesso")],
      checklist: [check("boas_vindas", "Contato de boas-vindas realizado"), check("adocao", "Adoção mínima verificada"), check("plano", "Plano de sucesso criado"), check("checkpoint", "Primeiro checkpoint agendado", false)],
      requiresApproval: false,
      exitCriteria: "Cliente ativado: adoção mínima + responsável + plano de sucesso.",
    },
    autoTasks: [auto("Contato de boas-vindas", 8, "alta"), auto("Criar plano de sucesso", 40, "media"), auto("Agendar checkpoint de 30 dias", 40, "baixa")],
  },
  {
    key: "suporte",
    name: "Suporte",
    department: "suporte",
    order: 6,
    description: "Etapa contínua: chamados resolvidos com solução, confirmação e causa.",
    defaultAssigneeRole: "suporte",
    gate: {
      name: "Atendimento contínuo",
      requiredFields: [],
      checklist: [check("canal", "Canais de atendimento apresentados ao cliente"), check("base", "Cliente orientado sobre a base de conhecimento", false), check("csat", "Pesquisa de satisfação ativa", false)],
      requiresApproval: false,
      exitCriteria: "Chamado resolvido: solução + confirmação do cliente + causa categorizada.",
    },
    autoTasks: [auto("Apresentar canais de suporte ao cliente", 24, "baixa"), auto("Revisar chamados recorrentes do cliente", 160, "baixa")],
  },
];

// ---------------------------------------------------------------------------
// Comissão, bônus, automações e conhecimento
// ---------------------------------------------------------------------------

const COMMISSION_RULES: (SeedDoc<CommissionRule> & { id: string })[] = [
  { id: "comm_rule_setup", name: "Adesão/setup 25%", revenueType: "setup", mode: "percentual", value: 25, releaseCondition: "pagamento", active: true },
  { id: "comm_rule_recorrencia", name: "Recorrência 100% na 3ª mensalidade", revenueType: "recorrencia", mode: "percentual", value: 100, releaseCondition: "parcela", releaseInstallment: 3, active: true },
  { id: "comm_rule_hardware", name: "Hardware 2,5%", revenueType: "hardware", mode: "percentual", value: 2.5, releaseCondition: "pagamento", active: true },
];

const TIERS = [
  { minAttainment: 1, payoutPct: 100, label: "Meta batida" },
  { minAttainment: 0.9, payoutPct: 70, label: "90–99%" },
  { minAttainment: 0.8, payoutPct: 40, label: "80–89%" },
  { minAttainment: 0, payoutPct: 0, label: "Abaixo de 80%" },
];

const BONUS_RULES: (SeedDoc<BonusRule> & { id: string })[] = [
  {
    id: "bonus_rule_suporte",
    name: "Bônus de Suporte (até 20% do salário)",
    department: "suporte",
    maxPctOfSalary: 20,
    individualWeight: 60,
    collectiveWeight: 40,
    individualKpis: [
      { kpiKey: "sla_resposta", weight: 30, target: 0.95 },
      { kpiKey: "sla_solucao", weight: 30, target: 0.9 },
      { kpiKey: "csat", weight: 30, target: 8.5 },
      { kpiKey: "auditoria_qualidade", weight: 10, target: 0.95 },
    ],
    collectiveKpis: [
      { kpiKey: "sla_resposta", weight: 25, target: 0.95 },
      { kpiKey: "sla_solucao", weight: 25, target: 0.9 },
      { kpiKey: "csat", weight: 30, target: 8.5 },
      { kpiKey: "churn", weight: 20, target: 0.03 },
    ],
    tiers: TIERS,
    blockers: [
      { key: "reclamacao_formal", label: "Reclamação formal procedente" },
      { key: "descumprimento_processo", label: "Descumprimento grave de processo (sem registro no CRM, abandono de chamado)" },
      { key: "conduta", label: "Falta grave de conduta" },
    ],
    extras: [{ key: "upsell_suporte", label: "Oportunidade de upsell válida gerada pelo suporte", amount: 50, unit: "por oportunidade" }],
    active: true,
    version: 1,
  },
  {
    id: "bonus_rule_implantacao",
    name: "Bônus de Implantação (até 20% do salário)",
    department: "implantacao",
    maxPctOfSalary: 20,
    individualWeight: 60,
    collectiveWeight: 40,
    individualKpis: [
      { kpiKey: "entregas_prazo", weight: 30, target: 0.9 },
      { kpiKey: "ativacao_7_dias", weight: 30, target: 0.8 },
      { kpiKey: "chamados_30_dias", weight: 20, target: 2 },
      { kpiKey: "auditoria_qualidade", weight: 20, target: 0.95 },
    ],
    collectiveKpis: [
      { kpiKey: "entregas_prazo", weight: 25, target: 0.9 },
      { kpiKey: "ativacao_7_dias", weight: 25, target: 0.8 },
      { kpiKey: "chamados_pos_implantacao", weight: 30, target: 2 },
      { kpiKey: "churn_inicial_90_dias", weight: 20, target: 0.03 },
    ],
    tiers: TIERS,
    blockers: [
      { key: "escopo_divergente", label: "Implantação divergente do escopo" },
      { key: "reclamacao_formal", label: "Reclamação formal procedente" },
      { key: "descumprimento_manual", label: "Descumprimento técnico dos manuais" },
    ],
    extras: [],
    active: true,
    version: 1,
  },
  {
    id: "bonus_rule_financeiro",
    name: "Bônus do Financeiro (até 20% do salário)",
    department: "financeiro",
    maxPctOfSalary: 20,
    individualWeight: 60,
    collectiveWeight: 40,
    individualKpis: [
      { kpiKey: "inadimplencia", weight: 40, target: 0.04 },
      { kpiKey: "tempo_liberacao_dias", weight: 30, target: 2 },
      { kpiKey: "faturamento", weight: 30, target: 35000 },
    ],
    collectiveKpis: [
      { kpiKey: "mrr", weight: 40, target: 18000 },
      { kpiKey: "crescimento_mrr", weight: 30, target: 0.08 },
      { kpiKey: "churn", weight: 30, target: 0.03 },
    ],
    tiers: TIERS,
    blockers: [
      { key: "descumprimento_processo", label: "Descumprimento grave de processo financeiro" },
      { key: "venda_fora_conformidade", label: "Liberação de venda fora da conformidade" },
      { key: "churn_erro_operacional", label: "Churn causado por erro operacional do financeiro" },
    ],
    extras: [],
    active: true,
    version: 1,
  },
];

const AUTOMATION_RULES: (SeedDoc<AutomationRule> & { id: string })[] = [
  {
    id: "auto_followup_48h",
    name: "Follow-up de oportunidade sem interação há 48h",
    description: "Cria tarefa de follow-up para o vendedor quando uma oportunidade aberta fica 48h sem interação.",
    trigger: { type: "agendado", schedule: "horaria", entity: "opportunity" },
    conditions: [{ path: "opportunity.stage", operator: "!=", value: "ganho" }, { path: "opportunity.hoursSinceLastActivity", operator: ">=", value: 48 }],
    actions: [{ type: "criar_tarefa", params: { title: "Follow-up da oportunidade", priority: "alta", dueInHours: 4, assignee: "opportunity.ownerId" } }, { type: "notificar", params: { kind: "acao", to: "opportunity.ownerId" } }],
    active: true,
    runCount: 0,
  },
  {
    id: "auto_sla_risco",
    name: "SLA em risco notifica responsável e gestor",
    description: "Ao entrar em risco, notifica o responsável e o gestor do departamento.",
    trigger: { type: "evento", eventType: "sla.at_risk" },
    conditions: [],
    actions: [{ type: "notificar", params: { kind: "atencao", to: ["sla.ownerId", "department.managerId"] } }],
    active: true,
    runCount: 0,
  },
  {
    id: "auto_golive_handoff",
    name: "Go-live cria handoff para o CS",
    description: "No go-live, cria a etapa de CS com tarefa de boas-vindas e notifica o gestor de CS.",
    trigger: { type: "evento", eventType: "implementation.go_live" },
    conditions: [],
    actions: [{ type: "criar_handoff", params: { department: "cs" } }, { type: "criar_tarefa", params: { title: "Contato de boas-vindas", priority: "alta", dueInHours: 8, department: "cs" } }],
    active: true,
    runCount: 0,
  },
  {
    id: "auto_baixa_adocao",
    name: "Baixa adoção cria plano de sucesso",
    description: "Quando a saúde muda para risco por baixa adoção, cria um plano de sucesso automático.",
    trigger: { type: "evento", eventType: "customer.health_changed" },
    conditions: [{ path: "payload.to", operator: "==", value: "risco" }, { path: "cs.adoptionPct", operator: "<", value: 40 }],
    actions: [{ type: "criar_plano_sucesso", params: { objective: "Recuperar adoção do sistema", checkpointInDays: 15 } }, { type: "notificar", params: { kind: "atencao", to: "cs.ownerId" } }],
    active: true,
    runCount: 0,
  },
  {
    id: "auto_lead_quente",
    name: "Lead quente cria tarefa imediata",
    description: "Lead com score de quente gera tarefa imediata de contato para vendas.",
    trigger: { type: "evento", eventType: "lead.created" },
    conditions: [{ path: "payload.temperature", operator: "==", value: "quente" }],
    actions: [{ type: "criar_tarefa", params: { title: "Contato imediato com lead quente", priority: "critica", dueInHours: 1, department: "vendas" } }, { type: "notificar", params: { kind: "acao", to: "department.vendas.managerId" } }],
    active: true,
    runCount: 0,
  },
];

const ARTICLES: (SeedDoc<KnowledgeArticle> & { id: string })[] = [
  { id: "kb_001", title: "NFC-e rejeitada: 'Certificado digital expirado'", productId: PRODUCT_IDS.erpIntersys, category: "Fiscal", body: "Quando a SEFAZ rejeita a NFC-e com a mensagem de certificado expirado, verifique a validade do certificado A1 em Configurações > Fiscal. Renove o certificado e importe o novo arquivo .pfx. Após a importação, reinicie o PDV e emita a nota novamente.", tags: ["nfc-e", "certificado", "sefaz"], authorId: "user_larissa", views: 312, published: true },
  { id: "kb_002", title: "TEF não conecta: como reiniciar o cliente TEF", productId: PRODUCT_IDS.tef, category: "TEF", body: "1. Feche o PDV. 2. Encerre o processo do cliente TEF na bandeja. 3. Verifique a conexão com a internet. 4. Abra o cliente TEF e aguarde o status 'Conectado'. 5. Abra o PDV e faça uma transação de teste de R$ 1,00.", tags: ["tef", "pdv", "conexao"], authorId: "user_rafael", views: 458, published: true },
  { id: "kb_003", title: "Como cadastrar um novo colaborador no Intercert Ponto", productId: PRODUCT_IDS.ponto, category: "Cadastros", body: "Acesse Colaboradores > Novo. Preencha nome, CPF, jornada e a filial. Envie o convite para o app. O colaborador precisa aceitar o convite e permitir a geolocalização para registrar o ponto.", tags: ["ponto", "cadastro"], authorId: "user_marcos", views: 127, published: true },
  { id: "kb_004", title: "Fechamento de caixa: diferença entre valor apurado e informado", productId: PRODUCT_IDS.erpIntersys, category: "PDV", body: "Diferenças no fechamento normalmente vêm de sangrias não registradas ou de vendas em cartão lançadas como dinheiro. Use o relatório 'Movimento do caixa' para comparar por forma de pagamento e corrija o lançamento antes de reabrir o caixa.", tags: ["pdv", "caixa", "financeiro"], authorId: "user_larissa", views: 289, published: true },
  { id: "kb_005", title: "Omnichannel: WhatsApp desconectado após troca de número", productId: PRODUCT_IDS.omnichannel, category: "Omnichannel", body: "Ao trocar o número da conta comercial, é necessário refazer a conexão em Canais > WhatsApp > Reconectar e revalidar o número no Gerenciador de Negócios da Meta. As conversas antigas são mantidas.", tags: ["omnichannel", "whatsapp"], authorId: "user_bruno", views: 95, published: true },
  { id: "kb_006", title: "Roteiro de treinamento de PDV (checklist para implantação)", productId: PRODUCT_IDS.erpIntersys, category: "Implantação", body: "Roteiro padrão: abertura de caixa, venda com múltiplas formas de pagamento, cancelamento de item, sangria e suprimento, fechamento e emissão de NFC-e. Registre presença e dúvidas no treinamento.", tags: ["treinamento", "pdv", "implantacao"], authorId: "user_lando", views: 64, published: false },
];

// ---------------------------------------------------------------------------

export async function seedCatalog(ctx: SeedContext): Promise<void> {
  const { store } = ctx;

  ctx.products = {};
  for (const { id, ...p } of PRODUCTS) ctx.products[id] = store.add(COLLECTIONS.products, id, { ...p, createdAt });

  ctx.templates = {};
  for (const { id, ...t } of TEMPLATES) ctx.templates[id] = store.add(COLLECTIONS.implementationTemplates, id, { ...t, createdAt });

  for (const { id, ...s } of LEAD_SOURCES) store.add(COLLECTIONS.leadSources, id, { ...s, createdAt });
  for (const { id, ...c } of CAMPAIGNS) store.add(COLLECTIONS.campaigns, id, { ...c, createdAt: c.startDate < createdAt ? c.startDate : createdAt });
  for (const { id, ...s } of SETTINGS) store.add(COLLECTIONS.settings, id, { ...s, createdAt });
  for (const { id, ...r } of SLA_RULES) store.add(COLLECTIONS.slaRules, id, { ...r, createdAt });
  ctx.holidays = new Set(HOLIDAYS);

  ctx.workflowTemplate = store.add(COLLECTIONS.workflowTemplates, WORKFLOW_TEMPLATE_ID, {
    key: "jornada-cliente",
    name: "Jornada do cliente",
    description: "Fluxo ponta a ponta: Marketing → Vendas → Financeiro → Implantação → CS → Suporte, com gates por etapa.",
    version: 1,
    published: true,
    stages: JOURNEY_STAGES_SPEC,
    createdAt,
  } satisfies SeedDoc<WorkflowTemplate>);

  seedKpiDefinitions(ctx, createdAt);

  for (const { id, ...r } of COMMISSION_RULES) store.add(COLLECTIONS.commissionRules, id, { ...r, createdAt });
  for (const { id, ...r } of BONUS_RULES) store.add(COLLECTIONS.bonusRules, id, { ...r, createdAt });
  for (const { id, ...r } of AUTOMATION_RULES) store.add(COLLECTIONS.automationRules, id, { ...r, createdAt });
  for (const { id, ...a } of ARTICLES) store.add(COLLECTIONS.knowledgeArticles, id, { ...a, createdAt: daysAgo(120) });
}
