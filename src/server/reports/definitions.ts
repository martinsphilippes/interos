/**
 * Catálogo da Central de Relatórios. Os departamentais espelham as abas da planilha "Modelos de
 * Relatórios Departamentais" (uma linha por competência, meta, atingimento e status pela regra da aba),
 * agora alimentados pelo motor de KPIs em vez de entradas manuais. Os operacionais listam registros.
 *
 * Módulo puro (sem Firestore): usado pela página, pela rota de exportação e pelos Client Components.
 */
import type { DepartmentKey } from "@/domain/constants";
import { CLIENT_STATUS_LABELS, TASK_STATUS_LABELS } from "@/domain/constants";

export const REPORT_KEYS = ["marketing", "vendas", "financeiro", "implantacao", "cs", "suporte", "diretoria", "tarefas", "oportunidades", "contratos", "chamados", "clientes", "comissoes"] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export type ColumnType = "texto" | "numero" | "moeda" | "percentual" | "dias" | "horas" | "minutos" | "nota" | "data" | "status";

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  /** Linha de totais: soma ou média da coluna. */
  total?: "soma" | "media";
  /** Largura sugerida (caracteres) para XLSX/PDF. */
  width?: number;
}

export type FilterKey = "periodo_mes" | "periodo_data" | "departamento" | "colaborador" | "cliente" | "produto" | "status";

export interface ReportDefinition {
  key: ReportKey;
  title: string;
  description: string;
  group: "departamental" | "operacional";
  /** Departamento dono (acesso de colaboradores sem gestão). Sem departamento: todos acessam. */
  department?: DepartmentKey;
  filters: FilterKey[];
  statusOptions?: { value: string; label: string }[];
  columns: ReportColumn[];
  /** Regra do status (texto exibido na página e na aba de filtros do XLSX). */
  statusRule?: string;
}

const competencia: ReportColumn = { key: "competencia", label: "Competência", type: "texto", width: 12 };
const meta = (type: ColumnType, label = "Meta"): ReportColumn => ({ key: "meta", label, type, width: 12 });
const atingimento: ReportColumn = { key: "atingimento", label: "Atingimento", type: "percentual", total: "media", width: 12 };
const status: ReportColumn = { key: "status", label: "Status", type: "status", width: 11 };

export const REPORT_DEFINITIONS: Record<ReportKey, ReportDefinition> = {
  marketing: {
    key: "marketing",
    title: "Marketing",
    description: "Leads, MQLs, investimento, CPL, oportunidades e conversão por competência.",
    group: "departamental",
    department: "marketing",
    filters: ["periodo_mes", "colaborador"],
    statusRule: "Atingimento de MQLs sobre a meta: Atingida ≥ 100% · Atenção ≥ 85% · Crítico abaixo disso.",
    columns: [
      competencia,
      { key: "leads", label: "Leads", type: "numero", total: "soma" },
      { key: "mqls", label: "MQLs", type: "numero", total: "soma" },
      { key: "investimento", label: "Investimento", type: "moeda", total: "soma", width: 14 },
      { key: "cpl", label: "CPL", type: "moeda", total: "media" },
      { key: "oportunidades", label: "Reuniões/oportunidades", type: "numero", total: "soma", width: 14 },
      { key: "conversao", label: "Conversão lead → MQL", type: "percentual", total: "media", width: 14 },
      meta("numero", "Meta de MQL"),
      atingimento,
      status,
    ],
  },
  vendas: {
    key: "vendas",
    title: "Vendas",
    description: "MQLs recebidos, propostas, vendas, receita, ticket, conversão e ciclo por competência.",
    group: "departamental",
    department: "vendas",
    filters: ["periodo_mes", "colaborador"],
    statusRule: "Atingimento da receita vendida sobre a meta: Atingida ≥ 100% · Atenção ≥ 85% · Crítico abaixo disso.",
    columns: [
      competencia,
      { key: "mqls", label: "MQLs recebidos", type: "numero", total: "soma" },
      { key: "propostas", label: "Propostas enviadas", type: "numero", total: "soma" },
      { key: "vendas", label: "Vendas", type: "numero", total: "soma" },
      { key: "receita", label: "Receita vendida", type: "moeda", total: "soma", width: 14 },
      { key: "ticket", label: "Ticket médio", type: "moeda", total: "media" },
      { key: "conversao", label: "Conversão do funil", type: "percentual", total: "media" },
      { key: "ciclo", label: "Ciclo (dias)", type: "dias", total: "media" },
      meta("moeda", "Meta de receita"),
      atingimento,
      status,
    ],
  },
  financeiro: {
    key: "financeiro",
    title: "Financeiro",
    description: "Faturado, recebido, vencido, inadimplência, MRR, contratos assinados, prazo de recebimento e orçamento.",
    group: "departamental",
    department: "financeiro",
    filters: ["periodo_mes", "colaborador"],
    statusRule:
      "Regra da planilha: Atingida com variação ≥ 0 sobre o orçamento e inadimplência ≤ 4% · Atenção com variação ≥ −5% e inadimplência ≤ 6% · Crítico nos demais casos. O orçamento é a meta de faturamento do período; sem orçamento, vale só a inadimplência.",
    columns: [
      competencia,
      { key: "faturado", label: "Faturado", type: "moeda", total: "soma", width: 14 },
      { key: "recebido", label: "Recebido", type: "moeda", total: "soma", width: 14 },
      { key: "vencido", label: "Vencido", type: "moeda", total: "soma", width: 14 },
      { key: "inadimplencia", label: "Inadimplência", type: "percentual", total: "media" },
      { key: "mrr", label: "MRR", type: "moeda", width: 14 },
      { key: "contratos", label: "Contratos assinados", type: "numero", total: "soma" },
      { key: "prazo_recebimento", label: "Prazo médio de recebimento (dias)", type: "dias", total: "media", width: 16 },
      { key: "orcamento", label: "Orçamento", type: "moeda", total: "soma", width: 14 },
      { key: "variacao", label: "Variação (R$)", type: "moeda", total: "soma", width: 14 },
      { key: "variacao_pct", label: "Variação (%)", type: "percentual" },
      status,
    ],
  },
  implantacao: {
    key: "implantacao",
    title: "Implantação",
    description: "Projetos novos, em andamento, concluídos e atrasados, tempo médio, % no prazo, qualidade e backlog.",
    group: "departamental",
    department: "implantacao",
    filters: ["periodo_mes", "colaborador"],
    statusRule: "Atingimento de entregas no prazo sobre a meta (90%): Atingida ≥ 100% · Atenção ≥ 90% · Crítico abaixo disso.",
    columns: [
      competencia,
      { key: "novas", label: "Novas", type: "numero", total: "soma" },
      { key: "em_andamento", label: "Em andamento", type: "numero" },
      { key: "concluidas", label: "Concluídas", type: "numero", total: "soma" },
      { key: "atrasadas", label: "Atrasadas", type: "numero" },
      { key: "tempo_medio", label: "Tempo médio (dias)", type: "dias", total: "media" },
      { key: "no_prazo", label: "% no prazo", type: "percentual", total: "media" },
      { key: "satisfacao", label: "Qualidade (sem chamado crítico)", type: "percentual", total: "media", width: 16 },
      { key: "backlog", label: "Backlog", type: "numero" },
      meta("percentual", "Meta % no prazo"),
      atingimento,
      status,
    ],
  },
  cs: {
    key: "cs",
    title: "Customer Success",
    description: "Clientes ativos, onboardings, saúde, satisfação, cancelamentos, churn, upsell, renovações e adoção.",
    group: "departamental",
    department: "cs",
    filters: ["periodo_mes", "colaborador"],
    statusRule: "Saúde média sobre a meta: Atingida ≥ meta · Atenção ≥ 90% da meta · Crítico abaixo disso.",
    columns: [
      competencia,
      { key: "ativos", label: "Clientes ativos", type: "numero" },
      { key: "onboardings", label: "Onboardings", type: "numero", total: "soma" },
      { key: "saude", label: "Saúde média", type: "numero", total: "media" },
      { key: "csat", label: "Satisfação (0–10)", type: "nota", total: "media" },
      { key: "cancelamentos", label: "Cancelamentos", type: "numero", total: "soma" },
      { key: "churn", label: "Churn", type: "percentual", total: "media" },
      { key: "upsell", label: "Upsell", type: "moeda", total: "soma", width: 14 },
      { key: "renovacoes", label: "Renovações", type: "numero", total: "soma" },
      { key: "adocao", label: "Adoção média", type: "percentual", total: "media" },
      meta("numero", "Meta de saúde"),
      status,
    ],
  },
  suporte: {
    key: "suporte",
    title: "Suporte",
    description: "Chamados novos, resolvidos, backlog, SLAs, tempos médios, reabertos, reincidência e CSAT.",
    group: "departamental",
    department: "suporte",
    filters: ["periodo_mes", "colaborador"],
    statusRule:
      "Regra da planilha adaptada à escala 0–10 do INTEROS: Atingida com SLA de solução ≥ 90% e CSAT ≥ meta (metas_referencia.csat) · Atenção com SLA ≥ 85% e CSAT ≥ 93% da meta (4,2 de 4,5 na escala 1–5) · Crítico nos demais casos.",
    columns: [
      competencia,
      { key: "novos", label: "Novos", type: "numero", total: "soma" },
      { key: "resolvidos", label: "Resolvidos", type: "numero", total: "soma" },
      { key: "backlog", label: "Backlog", type: "numero" },
      { key: "sla_resposta", label: "SLA 1ª resposta", type: "percentual", total: "media" },
      { key: "sla_solucao", label: "SLA solução", type: "percentual", total: "media" },
      { key: "resposta_media", label: "Resposta média (min)", type: "minutos", total: "media" },
      { key: "solucao_media", label: "Solução média (h)", type: "horas", total: "media" },
      { key: "reabertos", label: "Reabertos", type: "numero", total: "soma" },
      { key: "reincidencia", label: "Reincidência", type: "percentual", total: "media" },
      { key: "csat", label: "CSAT (0–10)", type: "nota", total: "media" },
      status,
    ],
  },
  diretoria: {
    key: "diretoria",
    title: "Diretoria",
    description: "Destaques da empresa e o indicador principal de cada departamento com realizado, meta, atingimento, responsável e alerta executivo.",
    group: "departamental",
    filters: ["periodo_mes"],
    statusRule: "Status do indicador principal pelo motor de KPIs. Alertas: inadimplência acima de 4%, saúde média abaixo de 70 e indicadores críticos ou em atenção.",
    columns: [
      competencia,
      { key: "departamento", label: "Departamento", type: "texto", width: 16 },
      { key: "indicador", label: "Indicador", type: "texto", width: 24 },
      { key: "realizado", label: "Realizado", type: "texto", width: 14 },
      { key: "meta", label: "Meta", type: "texto", width: 14 },
      { key: "atingimento", label: "Atingimento", type: "percentual", width: 12 },
      status,
      { key: "responsavel", label: "Responsável", type: "texto", width: 18 },
      { key: "alerta", label: "Alerta executivo", type: "texto", width: 34 },
    ],
  },
  tarefas: {
    key: "tarefas",
    title: "Tarefas",
    description: "Tarefas criadas, com prazo ou concluídas no período.",
    group: "operacional",
    filters: ["periodo_data", "departamento", "colaborador", "cliente", "status"],
    statusOptions: [{ value: "atrasadas", label: "Atrasadas" }, ...Object.entries(TASK_STATUS_LABELS).map(([value, label]) => ({ value, label }))],
    columns: [
      { key: "titulo", label: "Tarefa", type: "texto", width: 34 },
      { key: "cliente", label: "Cliente", type: "texto", width: 20 },
      { key: "departamento", label: "Departamento", type: "texto", width: 14 },
      { key: "responsavel", label: "Responsável", type: "texto", width: 18 },
      { key: "prioridade", label: "Prioridade", type: "texto", width: 10 },
      { key: "status", label: "Status", type: "texto", width: 12 },
      { key: "prazo", label: "Prazo", type: "data" },
      { key: "concluida_em", label: "Concluída em", type: "data" },
      { key: "atrasada", label: "Atrasada", type: "texto", width: 9 },
      { key: "origem", label: "Origem", type: "texto", width: 10 },
    ],
  },
  oportunidades: {
    key: "oportunidades",
    title: "Oportunidades",
    description: "Oportunidades criadas, ganhas ou perdidas no período, com valores e responsável.",
    group: "operacional",
    department: "vendas",
    filters: ["periodo_data", "colaborador", "cliente", "produto", "status"],
    statusOptions: [
      { value: "abertas", label: "Abertas" },
      { value: "qualificacao", label: "Qualificação" },
      { value: "diagnostico", label: "Diagnóstico" },
      { value: "proposta", label: "Proposta" },
      { value: "negociacao", label: "Negociação" },
      { value: "fechamento", label: "Fechamento" },
      { value: "ganho", label: "Ganho" },
      { value: "perdido", label: "Perdido" },
    ],
    columns: [
      { key: "titulo", label: "Oportunidade", type: "texto", width: 30 },
      { key: "cliente", label: "Cliente", type: "texto", width: 20 },
      { key: "responsavel", label: "Responsável", type: "texto", width: 18 },
      { key: "etapa", label: "Etapa", type: "texto", width: 12 },
      { key: "tipo", label: "Tipo", type: "texto", width: 11 },
      { key: "probabilidade", label: "Probabilidade", type: "percentual" },
      { key: "setup", label: "Adesão", type: "moeda", total: "soma" },
      { key: "mensalidade", label: "Mensalidade", type: "moeda", total: "soma" },
      { key: "hardware", label: "Hardware", type: "moeda", total: "soma" },
      { key: "valor", label: "Valor total", type: "moeda", total: "soma", width: 14 },
      { key: "criada_em", label: "Criada em", type: "data" },
      { key: "fechada_em", label: "Fechada em", type: "data" },
      { key: "motivo_perda", label: "Motivo da perda", type: "texto", width: 22 },
    ],
  },
  contratos: {
    key: "contratos",
    title: "Contratos",
    description: "Contratos criados, assinados ou liberados no período.",
    group: "operacional",
    department: "financeiro",
    filters: ["periodo_data", "colaborador", "cliente", "produto", "status"],
    statusOptions: [
      { value: "aguardando_contrato", label: "Aguardando contrato" },
      { value: "aguardando_assinatura", label: "Aguardando assinatura" },
      { value: "assinado", label: "Assinado" },
      { value: "aguardando_pagamento", label: "Aguardando pagamento" },
      { value: "pago", label: "Pago" },
      { value: "pendencia", label: "Pendência" },
      { value: "liberado", label: "Liberado" },
      { value: "cancelado", label: "Cancelado" },
    ],
    columns: [
      { key: "numero", label: "Contrato", type: "texto", width: 14 },
      { key: "cliente", label: "Cliente", type: "texto", width: 22 },
      { key: "status", label: "Status", type: "texto", width: 18 },
      { key: "financeiro", label: "Situação financeira", type: "texto", width: 12 },
      { key: "setup", label: "Adesão", type: "moeda", total: "soma" },
      { key: "mensalidade", label: "Mensalidade", type: "moeda", total: "soma" },
      { key: "hardware", label: "Hardware", type: "moeda", total: "soma" },
      { key: "assinado_em", label: "Assinado em", type: "data" },
      { key: "liberado_em", label: "Liberado em", type: "data" },
      { key: "responsavel", label: "Responsável", type: "texto", width: 18 },
    ],
  },
  chamados: {
    key: "chamados",
    title: "Chamados",
    description: "Chamados abertos ou resolvidos no período, com SLA de solução e CSAT.",
    group: "operacional",
    department: "suporte",
    filters: ["periodo_data", "colaborador", "cliente", "produto", "status"],
    statusOptions: [
      { value: "abertos", label: "Em aberto" },
      { value: "aberto", label: "Aberto" },
      { value: "em_atendimento", label: "Em atendimento" },
      { value: "aguardando_cliente", label: "Aguardando cliente" },
      { value: "reaberto", label: "Reaberto" },
      { value: "resolvido", label: "Resolvido" },
      { value: "fechado", label: "Fechado" },
    ],
    columns: [
      { key: "numero", label: "Chamado", type: "texto", width: 10 },
      { key: "assunto", label: "Assunto", type: "texto", width: 30 },
      { key: "cliente", label: "Cliente", type: "texto", width: 20 },
      { key: "produto", label: "Produto", type: "texto", width: 14 },
      { key: "prioridade", label: "Prioridade", type: "texto", width: 9 },
      { key: "status", label: "Status", type: "texto", width: 14 },
      { key: "responsavel", label: "Responsável", type: "texto", width: 18 },
      { key: "aberto_em", label: "Aberto em", type: "data" },
      { key: "primeira_resposta", label: "1ª resposta", type: "data" },
      { key: "resolvido_em", label: "Resolvido em", type: "data" },
      { key: "sla", label: "SLA de solução", type: "texto", width: 12 },
      { key: "csat", label: "CSAT", type: "nota", total: "media" },
      { key: "reaberturas", label: "Reaberturas", type: "numero", total: "soma" },
    ],
  },
  clientes: {
    key: "clientes",
    title: "Clientes",
    description: "Carteira de clientes (fotografia atual) com MRR, saúde e responsáveis.",
    group: "operacional",
    department: "cs",
    filters: ["colaborador", "produto", "status"],
    statusOptions: Object.entries(CLIENT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
    columns: [
      { key: "nome", label: "Cliente", type: "texto", width: 24 },
      { key: "razao_social", label: "Razão social", type: "texto", width: 28 },
      { key: "status", label: "Status", type: "texto", width: 13 },
      { key: "segmento", label: "Segmento", type: "texto", width: 14 },
      { key: "cidade", label: "Cidade", type: "texto", width: 16 },
      { key: "mrr", label: "MRR", type: "moeda", total: "soma" },
      { key: "saude", label: "Saúde", type: "numero", total: "media" },
      { key: "nivel", label: "Nível", type: "texto", width: 9 },
      { key: "cs", label: "Responsável CS", type: "texto", width: 18 },
      { key: "vendedor", label: "Vendedor", type: "texto", width: 18 },
      { key: "ativado_em", label: "Ativado em", type: "data" },
    ],
  },
  comissoes: {
    key: "comissoes",
    title: "Comissões",
    description: "Comissões por competência, com base de cálculo, valor e situação.",
    group: "operacional",
    department: "vendas",
    filters: ["periodo_mes", "colaborador", "cliente", "produto", "status"],
    statusOptions: [
      { value: "prevista", label: "Prevista" },
      { value: "liberada", label: "Liberada" },
      { value: "paga", label: "Paga" },
      { value: "cancelada", label: "Cancelada" },
    ],
    columns: [
      { key: "colaborador", label: "Colaborador", type: "texto", width: 18 },
      { key: "cliente", label: "Cliente", type: "texto", width: 22 },
      { key: "produto", label: "Produto", type: "texto", width: 16 },
      { key: "tipo", label: "Tipo de receita", type: "texto", width: 12 },
      { key: "base", label: "Base", type: "moeda", total: "soma" },
      { key: "valor", label: "Comissão", type: "moeda", total: "soma" },
      { key: "competencia", label: "Competência", type: "texto", width: 11 },
      { key: "status", label: "Situação", type: "texto", width: 10 },
      { key: "liberacao", label: "Liberação", type: "data" },
    ],
  },
};

export const REPORT_GROUP_LABELS: Record<ReportDefinition["group"], string> = { departamental: "Relatórios departamentais", operacional: "Relatórios operacionais" };

export function isReportKey(value: string | undefined | null): value is ReportKey {
  return Boolean(value) && (REPORT_KEYS as readonly string[]).includes(value as string);
}

export const EXPORT_FORMATS = ["csv", "xlsx", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Parâmetros de filtro na URL (página e rota de exportação usam os mesmos). */
export const FILTER_PARAMS = ["de", "ate", "departamento", "colaborador", "cliente", "produto", "status"] as const;
export type FilterParam = (typeof FILTER_PARAMS)[number];
export type ReportFilters = Partial<Record<FilterParam, string>>;

export function readReportFilters(params: URLSearchParams | Record<string, string | string[] | undefined>): ReportFilters {
  const out: ReportFilters = {};
  for (const key of FILTER_PARAMS) {
    const raw = params instanceof URLSearchParams ? params.get(key) : params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value && value.trim()) out[key] = value.trim();
  }
  return out;
}

/** Query string dos filtros (para links de exportação e navegação). */
export function filtersToQuery(filters: ReportFilters): string {
  const params = new URLSearchParams();
  for (const key of FILTER_PARAMS) if (filters[key]) params.set(key, filters[key]!);
  return params.toString();
}

// ---------------------------------------------------------------------------
// Formatação (prévia na página, CSV e PDF; o XLSX grava números com formato de célula)
// ---------------------------------------------------------------------------

export type ReportValue = string | number | null;

const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const oneDecimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

/** Data ISO → dd/mm/aaaa no fuso da operação (UTC-3). */
export function formatReportDate(iso: string): string {
  const d = new Date(Date.parse(iso) - 3 * 3_600_000);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

export function formatReportValue(value: ReportValue, type: ColumnType): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return type === "data" ? formatReportDate(value) : value;
  if (Number.isNaN(value)) return "—";
  switch (type) {
    case "moeda":
      return money.format(value);
    case "percentual":
      return pct.format(value);
    case "dias":
    case "horas":
    case "minutos":
    case "nota":
      return oneDecimal.format(value);
    default:
      return decimal.format(value);
  }
}
