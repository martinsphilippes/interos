/**
 * SLA global (/sla): filtros da URL, rótulos por tipo de processo e prioridade normalizada.
 * Módulo puro (sem Firestore): usado pela página, pelos filtros no navegador e pelas leituras.
 */
import type { SlaInstance } from "@/domain/types";
import { DEPARTMENT_KEYS, type DepartmentKey } from "@/domain/constants";

export type SlaEntityType = SlaInstance["entityType"];

export const SLA_ENTITY_TYPES: SlaEntityType[] = ["chamado", "tarefa", "workflow_step", "projeto", "cs", "oportunidade"];

export const SLA_TYPE_LABELS: Record<SlaEntityType, string> = {
  chamado: "Chamado",
  tarefa: "Tarefa",
  workflow_step: "Etapa de workflow",
  projeto: "Implantação",
  cs: "Customer Success",
  oportunidade: "Oportunidade",
};

/** Prioridade única para a tela (chamados usam critico/alto/medio/baixo; tarefas, critica/alta/media/baixa). */
export const SLA_PRIORITIES = ["critica", "alta", "media", "baixa"] as const;
export type SlaPriority = (typeof SLA_PRIORITIES)[number];
export const SLA_PRIORITY_LABELS: Record<SlaPriority, string> = { critica: "Crítica", alta: "Alta", media: "Média", baixa: "Baixa" };

const TICKET_TO_PRIORITY: Record<string, SlaPriority> = { critico: "critica", alto: "alta", medio: "media", baixo: "baixa" };

export function normalizePriority(value: string | undefined | null): SlaPriority | undefined {
  if (!value) return undefined;
  if ((SLA_PRIORITIES as readonly string[]).includes(value)) return value as SlaPriority;
  return TICKET_TO_PRIORITY[value];
}

export interface SlaFilters {
  departamento?: DepartmentKey;
  responsavel?: string;
  cliente?: string;
  prioridade?: SlaPriority;
  tipo?: SlaEntityType;
  /** "1h": só os que vencem na próxima hora. */
  janela?: "1h";
  /** "todos": lista completa em vez dos críticos. */
  lista?: "todos";
  /** Busca por texto (cliente, protocolo, título, responsável). */
  q?: string;
}

type ParamsLike = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseSlaFilters(params: ParamsLike): SlaFilters {
  const dep = one(params.departamento);
  const tipo = one(params.tipo);
  const prioridade = one(params.prioridade);
  const q = one(params.q)?.trim();
  return {
    departamento: dep && (DEPARTMENT_KEYS as readonly string[]).includes(dep) ? (dep as DepartmentKey) : undefined,
    responsavel: one(params.responsavel) || undefined,
    cliente: one(params.cliente) || undefined,
    prioridade: prioridade && (SLA_PRIORITIES as readonly string[]).includes(prioridade) ? (prioridade as SlaPriority) : undefined,
    tipo: tipo && (SLA_ENTITY_TYPES as string[]).includes(tipo) ? (tipo as SlaEntityType) : undefined,
    janela: one(params.janela) === "1h" ? "1h" : undefined,
    lista: one(params.lista) === "todos" ? "todos" : undefined,
    q: q ? q.slice(0, 80) : undefined,
  };
}

/** Link para /sla com os filtros (e o período) informados. */
export function slaHref(params: Partial<Record<keyof SlaFilters | "periodo", string | undefined>>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/sla?${s}` : "/sla";
}
