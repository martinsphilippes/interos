import "server-only";
/**
 * Busca global em memória. Carrega as coleções pesquisáveis (até 500 documentos mais recentes por
 * coleção, com cache curto por instância) e compara nome, razão social, CNPJ e telefone (só dígitos),
 * e-mail, número de contrato/chamado e título. Cada resultado já sai com o href do contrato de URL.
 */
import { getManyByIds, list } from "@/server/db";
import {
  COLLECTIONS,
  type BaseEntity,
  type Client,
  type CollectionName,
  type Contact,
  type Contract,
  type ImplementationProject,
  type Campaign,
  type Lead,
  type Opportunity,
  type Proposal,
  type SupportTicket,
  type Task,
  type User,
} from "@/domain/types";
import { CLIENT_STATUS_LABELS, DEPARTMENT_LABELS, ROLE_LABELS, TASK_STATUS_LABELS } from "@/domain/constants";
import { formatCurrency, formatDocument } from "@/lib/format";

export const SEARCH_KINDS = ["cliente", "contato", "tarefa", "oportunidade", "proposta", "contrato", "implantacao", "chamado", "lead", "campanha", "usuario"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const SEARCH_KIND_LABELS: Record<SearchKind, string> = {
  cliente: "Clientes",
  contato: "Contatos",
  tarefa: "Tarefas",
  oportunidade: "Oportunidades",
  proposta: "Propostas",
  contrato: "Contratos",
  implantacao: "Implantações",
  chamado: "Chamados",
  lead: "Leads",
  campanha: "Campanhas",
  usuario: "Usuários",
};

export interface SearchResult {
  id: string;
  kind: SearchKind;
  title: string;
  subtitle?: string;
  href: string;
  score: number;
}

export interface SearchGroup {
  kind: SearchKind;
  label: string;
  items: SearchResult[];
}

export interface SearchResponse {
  term: string;
  total: number;
  groups: SearchGroup[];
}

const PER_COLLECTION = 500;
const PER_GROUP = 5;
const CACHE_TTL_MS = 30_000;

const OPP_STAGE_LABELS: Record<Opportunity["stage"], string> = {
  qualificacao: "Qualificação",
  diagnostico: "Diagnóstico",
  proposta: "Proposta",
  negociacao: "Negociação",
  fechamento: "Fechamento",
  ganho: "Ganho",
  perdido: "Perdido",
};
const CONTRACT_STATUS_LABELS: Record<Contract["status"], string> = {
  aguardando_contrato: "Aguardando contrato",
  aguardando_assinatura: "Aguardando assinatura",
  assinado: "Assinado",
  aguardando_pagamento: "Aguardando pagamento",
  pago: "Pago",
  pendencia: "Pendência",
  liberado: "Liberado",
  cancelado: "Cancelado",
};
const PROPOSAL_STATUS_LABELS: Record<Proposal["status"], string> = {
  rascunho: "Rascunho",
  enviada: "Enviada",
  visualizada: "Visualizada",
  negociacao: "Em negociação",
  aceita: "Aceita",
  recusada: "Recusada",
  vencida: "Vencida",
};
const CAMPAIGN_STATUS_LABELS: Record<Campaign["status"], string> = {
  planejada: "Planejada",
  ativa: "Ativa",
  pausada: "Pausada",
  encerrada: "Encerrada",
};
const PROJECT_STATUS_LABELS: Record<ImplementationProject["status"], string> = {
  aguardando_inicio: "Aguardando início",
  em_implantacao: "Em implantação",
  aguardando_cliente: "Aguardando cliente",
  bloqueada: "Bloqueada",
  pronta_para_go_live: "Pronta para go-live",
  concluida: "Concluída",
  cancelada: "Cancelada",
};
const TICKET_STATUS_LABELS: Record<SupportTicket["status"], string> = {
  aberto: "Aberto",
  em_atendimento: "Em atendimento",
  aguardando_cliente: "Aguardando cliente",
  resolvido: "Resolvido",
  fechado: "Fechado",
  reaberto: "Reaberto",
};
const LEAD_STATUS_LABELS: Record<Lead["status"], string> = {
  novo: "Novo",
  em_contato: "Em contato",
  qualificado: "Qualificado",
  desqualificado: "Desqualificado",
  convertido: "Convertido",
};

// ---------------------------------------------------------------------------
// Normalização e pontuação
// ---------------------------------------------------------------------------

export function normalizeText(value: string | undefined | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const digitsOf = (value: string | undefined | null) => (value ?? "").replace(/\D/g, "");

/** 100 igual · 80 começa com · 60 alguma palavra começa com · 40 contém · 70 dígitos contêm. */
function matchScore(term: string, termDigits: string, textFields: (string | undefined)[], digitFields: (string | undefined)[] = []): number {
  let best = 0;
  for (const field of textFields) {
    const text = normalizeText(field);
    if (!text) continue;
    if (text === term) best = Math.max(best, 100);
    else if (text.startsWith(term)) best = Math.max(best, 80);
    else if (text.split(/\s+/).some((w) => w.startsWith(term))) best = Math.max(best, 60);
    else if (text.includes(term)) best = Math.max(best, 40);
  }
  if (termDigits.length >= 3) {
    for (const field of digitFields) {
      const digits = digitsOf(field);
      if (!digits) continue;
      if (digits === termDigits) best = Math.max(best, 100);
      else if (digits.includes(termDigits)) best = Math.max(best, 70);
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Carga com cache curto
// ---------------------------------------------------------------------------

interface Loaded {
  clients: Client[];
  contacts: Contact[];
  tasks: Task[];
  opportunities: Opportunity[];
  proposals: Proposal[];
  contracts: Contract[];
  projects: ImplementationProject[];
  tickets: SupportTicket[];
  leads: Lead[];
  campaigns: Campaign[];
  users: User[];
}

let cache: { loadedAt: number; data: Loaded } | null = null;

/** Os N documentos mais recentes da coleção (ordenação em memória para não exigir índice composto). */
async function recent<T extends BaseEntity>(name: CollectionName, where?: [string, "==", unknown]): Promise<T[]> {
  const docs = await list<T>(name, where ? { where: [where] } : {});
  docs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return docs.slice(0, PER_COLLECTION);
}

async function loadAll(): Promise<Loaded> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.data;
  const [clients, contacts, tasks, opportunities, proposals, contracts, projects, tickets, leads, campaigns, users] = await Promise.all([
    recent<Client>(COLLECTIONS.clients),
    recent<Contact>(COLLECTIONS.contacts),
    recent<Task>(COLLECTIONS.tasks),
    recent<Opportunity>(COLLECTIONS.opportunities),
    recent<Proposal>(COLLECTIONS.proposals),
    recent<Contract>(COLLECTIONS.contracts),
    recent<ImplementationProject>(COLLECTIONS.implementationProjects),
    recent<SupportTicket>(COLLECTIONS.supportTickets),
    recent<Lead>(COLLECTIONS.leads),
    recent<Campaign>(COLLECTIONS.campaigns),
    recent<User>(COLLECTIONS.users, ["active", "==", true]),
  ]);
  const data = { clients, contacts, tasks, opportunities, proposals, contracts, projects, tickets, leads, campaigns, users };
  cache = { loadedAt: Date.now(), data };
  return data;
}

/** Invalida o cache (chame após criar entidades pesquisáveis, se necessário). */
export function invalidateSearchCache(): void {
  cache = null;
}

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

export async function searchGlobalQuery(rawTerm: string): Promise<SearchResponse> {
  const term = normalizeText(rawTerm);
  const termDigits = digitsOf(rawTerm);
  if (term.length < 2) return { term: rawTerm, total: 0, groups: [] };
  const data = await loadAll();

  const clientById = new Map(data.clients.map((c) => [c.id, c]));
  const results: (SearchResult & { createdAt: string; clientId?: string })[] = [];
  const add = (kind: SearchKind, doc: BaseEntity & { clientId?: string }, score: number, title: string, href: string, subtitle?: string) => {
    if (score > 0) results.push({ id: doc.id, kind, title, subtitle, href, score, createdAt: doc.createdAt, clientId: doc.clientId });
  };

  for (const c of data.clients) {
    const score = matchScore(term, termDigits, [c.tradeName, c.legalName, c.email, c.address?.city], [c.document, c.phone, c.whatsapp]);
    const parts = [CLIENT_STATUS_LABELS[c.status], c.address?.city, c.document ? formatDocument(c.document) : undefined].filter(Boolean);
    add("cliente", c, score, c.tradeName, `/clientes/${c.id}`, parts.join(" · "));
  }
  for (const c of data.contacts) {
    const score = matchScore(term, termDigits, [c.name, c.email], [c.phone, c.whatsapp]);
    add("contato", c, score, c.name, `/clientes/${c.clientId}`, c.role);
  }
  for (const t of data.tasks) {
    const score = matchScore(term, termDigits, [t.title, t.clientName]);
    add("tarefa", t, score, t.title, `/tarefas?tarefa=${t.id}`, [TASK_STATUS_LABELS[t.status], t.clientName].filter(Boolean).join(" · "));
  }
  for (const o of data.opportunities) {
    const score = matchScore(term, termDigits, [o.title, clientById.get(o.clientId)?.tradeName]);
    add("oportunidade", o, score, o.title, `/vendas/oportunidades?oportunidade=${o.id}`, [OPP_STAGE_LABELS[o.stage], o.monthlyTotal > 0 ? `${formatCurrency(o.monthlyTotal)}/mês` : undefined].filter(Boolean).join(" · "));
  }
  for (const p of data.proposals) {
    const score = matchScore(term, termDigits, [p.number, clientById.get(p.clientId)?.tradeName], [p.number]);
    add("proposta", p, score, `${p.number} v${p.version}`, `/vendas/propostas?proposta=${p.id}`, [PROPOSAL_STATUS_LABELS[p.status], p.monthlyTotal > 0 ? `${formatCurrency(p.monthlyTotal)}/mês` : undefined].filter(Boolean).join(" · "));
  }
  for (const c of data.contracts) {
    const score = matchScore(term, termDigits, [c.number, clientById.get(c.clientId)?.tradeName], [c.number]);
    add("contrato", c, score, c.number, `/financeiro/contratos/${c.id}`, [CONTRACT_STATUS_LABELS[c.status], c.monthlyTotal > 0 ? `${formatCurrency(c.monthlyTotal)}/mês` : undefined].filter(Boolean).join(" · "));
  }
  for (const p of data.projects) {
    const score = matchScore(term, termDigits, [p.name, clientById.get(p.clientId)?.tradeName]);
    add("implantacao", p, score, p.name, `/implantacao?projeto=${p.id}`, `${PROJECT_STATUS_LABELS[p.status]} · ${p.progress}%`);
  }
  for (const t of data.tickets) {
    const score = matchScore(term, termDigits, [t.number, t.subject, clientById.get(t.clientId)?.tradeName], [t.number]);
    add("chamado", t, score, `${t.number} · ${t.subject}`, `/suporte/chamados?chamado=${t.id}`, TICKET_STATUS_LABELS[t.status]);
  }
  for (const l of data.leads) {
    const score = matchScore(term, termDigits, [l.name, l.company, l.email, l.city], [l.phone]);
    add("lead", l, score, `${l.name}${l.company ? ` · ${l.company}` : ""}`, `/marketing/leads?lead=${l.id}`, [LEAD_STATUS_LABELS[l.status], l.city].filter(Boolean).join(" · "));
  }
  for (const c of data.campaigns) {
    const score = matchScore(term, termDigits, [c.name, c.channel]);
    add("campanha", c, score, c.name, `/marketing/campanhas?campanha=${c.id}`, [CAMPAIGN_STATUS_LABELS[c.status], c.channel].filter(Boolean).join(" · "));
  }
  for (const u of data.users) {
    const score = matchScore(term, termDigits, [u.name, u.email, u.jobTitle], [u.phone]);
    add("usuario", u, score, u.name, `/admin/usuarios?usuario=${u.id}`, `${u.jobTitle ?? ROLE_LABELS[u.role]} · ${DEPARTMENT_LABELS[u.departmentId]}`);
  }

  results.sort((a, b) => b.score - a.score || (a.createdAt < b.createdAt ? 1 : -1));

  // Nome do cliente nos subtítulos (contato, oportunidade, contrato, implantação, chamado).
  const groups: SearchGroup[] = [];
  for (const kind of SEARCH_KINDS) {
    const items = results.filter((r) => r.kind === kind).slice(0, PER_GROUP);
    if (items.length > 0) groups.push({ kind, label: SEARCH_KIND_LABELS[kind], items });
  }
  const needClient = groups.flatMap((g) => (g.kind === "contato" || g.kind === "oportunidade" || g.kind === "proposta" || g.kind === "contrato" || g.kind === "implantacao" || g.kind === "chamado" ? g.items : [])) as (SearchResult & { clientId?: string })[];
  const missing = needClient.map((r) => r.clientId ?? "").filter((id) => id && !clientById.has(id));
  const fetched = await getManyByIds<Client>(COLLECTIONS.clients, missing);
  for (const [id, c] of fetched) clientById.set(id, c);
  for (const r of needClient) {
    const name = r.clientId ? clientById.get(r.clientId)?.tradeName : undefined;
    if (name) r.subtitle = r.subtitle ? `${name} · ${r.subtitle}` : name;
  }

  const total = groups.reduce((s, g) => s + g.items.length, 0);
  return {
    term: rawTerm,
    total,
    groups: groups.map((g) => ({ ...g, items: g.items.map(({ id, kind, title, subtitle, href, score }) => ({ id, kind, title, subtitle, href, score })) })),
  };
}
