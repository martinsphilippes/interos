import "server-only";
/**
 * Busca global em memória. Carrega as coleções pesquisáveis (até 500 documentos mais recentes por
 * coleção, com cache curto por instância) e compara nome, razão social, CNPJ e telefone (só dígitos),
 * e-mail, número de contrato/chamado e título. Cada resultado já sai com o href do contrato de URL.
 *
 * Autorização (A14): o cache é compartilhado (não depende do usuário); o filtro por usuário vem DEPOIS dele — cada
 * resultado só aparece se o usuário vê a tela de destino (canSeeHref) e o registro está no escopo dessa tela
 * (resolveDataScope + scopeAllows). Usuários, relatórios (canAccessReport) e indicadores só para quem vê as telas.
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
  type SuccessPlan,
  type KnowledgeArticle,
  type Task,
  type User,
  type Kpi,
  type GamificationCampaign,
  type AutomationRule,
} from "@/domain/types";
import { REPORT_DEFINITIONS, type ReportKey } from "@/server/reports/definitions";
import { canAccessReport } from "@/server/reports/build";
import { can, canSeeHref } from "@/server/auth/session";
import { resolveDataScope, scopeAllows, type DataScope } from "@/server/auth/scope";
import type { ScreenKey } from "@/domain/permissions";
import type { CurrentUser } from "@/domain/types";
import { CLIENT_STATUS_LABELS, DEPARTMENT_LABELS, ROLE_LABELS, TASK_STATUS_LABELS } from "@/domain/constants";
import { formatCurrency, formatDocument } from "@/lib/format";

export const SEARCH_KINDS = ["cliente", "contato", "tarefa", "oportunidade", "proposta", "contrato", "implantacao", "plano", "chamado", "artigo", "lead", "campanha", "indicador", "relatorio", "desafio", "automacao", "usuario"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const SEARCH_KIND_LABELS: Record<SearchKind, string> = {
  cliente: "Clientes",
  contato: "Contatos",
  tarefa: "Tarefas",
  oportunidade: "Oportunidades",
  proposta: "Propostas",
  contrato: "Contratos",
  implantacao: "Implantações",
  plano: "Planos de sucesso",
  chamado: "Chamados",
  artigo: "Base de conhecimento",
  lead: "Leads",
  campanha: "Campanhas",
  indicador: "Indicadores",
  relatorio: "Relatórios",
  desafio: "Campanhas de gamificação",
  automacao: "Automações",
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

/**
 * Prefixos de numeração → tipo dono do número. Buscar "CT-2026-0031" abre o contrato (não a tarefa ou a proposta
 * que citam o número); "VEN-…" abre a venda (oportunidade ganha); "PR-…" a proposta; "CH-…" o chamado.
 * COM-/PAG- (comissões e títulos) não fazem parte do índice da busca: têm escopo por vendedor (D15).
 */
const NUMBER_PREFIX_KIND: Record<string, SearchKind> = { ct: "contrato", ven: "oportunidade", pr: "proposta", ch: "chamado" };

/** Tipo dono do número quando o termo é (ou começa como) um número de documento: "ct-2026", "ven-2026-0008"… */
export function numberKindOf(term: string): SearchKind | undefined {
  const m = term.match(/^([a-z]{2,3})-\d/);
  return m ? NUMBER_PREFIX_KIND[m[1]] : undefined;
}

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
  plans: SuccessPlan[];
  articles: KnowledgeArticle[];
  leads: Lead[];
  campaigns: Campaign[];
  users: User[];
  kpis: Kpi[];
  challenges: GamificationCampaign[];
  automations: AutomationRule[];
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
  const [clients, contacts, tasks, opportunities, proposals, contracts, projects, tickets, plans, articles, leads, campaigns, users, kpis, challenges, automations] = await Promise.all([
    recent<Client>(COLLECTIONS.clients),
    recent<Contact>(COLLECTIONS.contacts),
    recent<Task>(COLLECTIONS.tasks),
    recent<Opportunity>(COLLECTIONS.opportunities),
    recent<Proposal>(COLLECTIONS.proposals),
    recent<Contract>(COLLECTIONS.contracts),
    recent<ImplementationProject>(COLLECTIONS.implementationProjects),
    recent<SupportTicket>(COLLECTIONS.supportTickets),
    recent<SuccessPlan>(COLLECTIONS.successPlans),
    recent<KnowledgeArticle>(COLLECTIONS.knowledgeArticles, ["published", "==", true]),
    recent<Lead>(COLLECTIONS.leads),
    recent<Campaign>(COLLECTIONS.campaigns),
    recent<User>(COLLECTIONS.users, ["active", "==", true]),
    recent<Kpi>(COLLECTIONS.kpis, ["active", "==", true]),
    recent<GamificationCampaign>(COLLECTIONS.gamificationCampaigns),
    recent<AutomationRule>(COLLECTIONS.automationRules),
  ]);
  const data = { clients, contacts, tasks, opportunities, proposals, contracts, projects, tickets, plans, articles, leads, campaigns, users, kpis, challenges, automations };
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

/** Dono do registro para o escopo da tela de destino (e vínculo com cliente, para tarefas abertas pela ficha). */
interface ResultAccess {
  screen?: ScreenKey;
  owners?: readonly (string | undefined | null)[];
  departmentId?: string;
  /** Tarefa ligada a cliente visível também aparece (mesma regra do detalhe da tarefa). */
  viaClientId?: string;
  report?: ReportKey;
}

type Candidate = SearchResult & { createdAt: string; clientId?: string; access?: ResultAccess };

const clientOwnersOf = (c: Client | undefined) => (c ? [c.ownerSalesId, c.ownerCsId, c.ownerImplementationId] : []);

/** Filtra os candidatos pelo usuário: tela de destino (canSeeHref) + escopo do registro (memo por tela). */
async function visibleFor(user: CurrentUser, candidates: Candidate[], clientById: ReadonlyMap<string, Client>): Promise<Candidate[]> {
  const scopes = new Map<ScreenKey, Promise<DataScope>>();
  const scopeOf = (screen: ScreenKey) => {
    let p = scopes.get(screen);
    if (!p) {
      p = resolveDataScope(user, screen);
      scopes.set(screen, p);
    }
    return p;
  };
  const clientVisible = async (clientId: string) => can(user, "operacao.clientes.ver") && scopeAllows(await scopeOf("operacao.clientes"), clientOwnersOf(clientById.get(clientId)));
  const checks = await Promise.all(
    candidates.map(async (r) => {
      if (!canSeeHref(user, r.href)) return false;
      const a = r.access;
      if (a?.report && !canAccessReport(user, a.report)) return false;
      if (!a?.screen) return true;
      if (scopeAllows(await scopeOf(a.screen), a.owners ?? [], a.departmentId)) return true;
      return Boolean(a.viaClientId && (await clientVisible(a.viaClientId)));
    }),
  );
  return candidates.filter((_, i) => checks[i]);
}

/**
 * Busca global. Com `user`, os resultados são filtrados pelas telas e escopos dele (ver cabeçalho) e os valores de
 * contrato só aparecem com "Visualizar valores". Sem `user` (uso interno), `admin` libera as automações.
 */
export async function searchGlobalQuery(rawTerm: string, viewer: { user?: CurrentUser; admin?: boolean } = {}): Promise<SearchResponse> {
  const term = normalizeText(rawTerm);
  const termDigits = digitsOf(rawTerm);
  if (term.length < 2) return { term: rawTerm, total: 0, groups: [] };
  const data = await loadAll();

  const clientById = new Map(data.clients.map((c) => [c.id, c]));
  const results: Candidate[] = [];
  const add = (kind: SearchKind, doc: BaseEntity & { clientId?: string }, score: number, title: string, href: string, subtitle?: string, access?: ResultAccess) => {
    if (score > 0) results.push({ id: doc.id, kind, title, subtitle, href, score, createdAt: doc.createdAt, clientId: doc.clientId, access });
  };
  const user = viewer.user;
  const showValues = user ? can(user, "financeiro.valores.ver") : true;
  const showAutomations = user ? true : Boolean(viewer.admin);

  for (const c of data.clients) {
    const score = matchScore(term, termDigits, [c.tradeName, c.legalName, c.email, c.address?.city], [c.document, c.phone, c.whatsapp]);
    const parts = [CLIENT_STATUS_LABELS[c.status], c.address?.city, c.document ? formatDocument(c.document) : undefined].filter(Boolean);
    add("cliente", c, score, c.tradeName, `/clientes/${c.id}`, parts.join(" · "), { screen: "operacao.clientes", owners: clientOwnersOf(c) });
  }
  for (const c of data.contacts) {
    const score = matchScore(term, termDigits, [c.name, c.email], [c.phone, c.whatsapp]);
    add("contato", c, score, c.name, `/clientes/${c.clientId}`, c.role, { screen: "operacao.clientes", owners: clientOwnersOf(clientById.get(c.clientId)) });
  }
  for (const t of data.tasks) {
    const score = matchScore(term, termDigits, [t.title, t.clientName]);
    add("tarefa", t, score, t.title, `/tarefas?tarefa=${t.id}`, [TASK_STATUS_LABELS[t.status], t.clientName].filter(Boolean).join(" · "), { screen: "operacao.tarefas", owners: [t.assigneeId, t.creatorId], departmentId: t.departmentId, viaClientId: t.clientId });
  }
  for (const o of data.opportunities) {
    // saleNumber (VEN-AAAA-NNNN) da venda ganha também é pesquisável.
    const score = matchScore(term, termDigits, [o.title, o.saleNumber, clientById.get(o.clientId)?.tradeName], [o.saleNumber]);
    add("oportunidade", o, score, o.saleNumber ? `${o.title} · ${o.saleNumber}` : o.title, `/vendas/oportunidades?oportunidade=${o.id}`, [OPP_STAGE_LABELS[o.stage], o.monthlyTotal > 0 ? `${formatCurrency(o.monthlyTotal)}/mês` : undefined].filter(Boolean).join(" · "), { screen: "vendas.oportunidades", owners: [o.ownerId, o.originUserId] });
  }
  for (const p of data.proposals) {
    const score = matchScore(term, termDigits, [p.number, clientById.get(p.clientId)?.tradeName], [p.number]);
    add("proposta", p, score, `${p.number} v${p.version}`, `/vendas/propostas?proposta=${p.id}`, [PROPOSAL_STATUS_LABELS[p.status], p.monthlyTotal > 0 ? `${formatCurrency(p.monthlyTotal)}/mês` : undefined].filter(Boolean).join(" · "), { screen: "vendas.propostas", owners: [p.ownerId] });
  }
  for (const c of data.contracts) {
    const score = matchScore(term, termDigits, [c.number, clientById.get(c.clientId)?.tradeName], [c.number]);
    add("contrato", c, score, c.number, `/financeiro/contratos/${c.id}`, [CONTRACT_STATUS_LABELS[c.status], showValues && c.monthlyTotal > 0 ? `${formatCurrency(c.monthlyTotal)}/mês` : undefined].filter(Boolean).join(" · "), { screen: "financeiro.contratos", owners: [c.sellerId, c.ownerId] });
  }
  for (const p of data.projects) {
    const score = matchScore(term, termDigits, [p.name, clientById.get(p.clientId)?.tradeName]);
    add("implantacao", p, score, p.name, `/implantacao/${p.id}`, `${PROJECT_STATUS_LABELS[p.status]} · ${p.progress}%`, { screen: "implantacao.projetos", owners: [p.ownerId, ...(p.teamIds ?? [])] });
  }
  for (const t of data.tickets) {
    const score = matchScore(term, termDigits, [t.number, t.subject, clientById.get(t.clientId)?.tradeName], [t.number]);
    add("chamado", t, score, `${t.number} · ${t.subject}`, `/suporte/chamados/${t.id}`, TICKET_STATUS_LABELS[t.status], { screen: "suporte.chamados", owners: [t.assigneeId] });
  }
  for (const p of data.plans) {
    const score = matchScore(term, termDigits, [p.objective, clientById.get(p.clientId)?.tradeName]);
    add("plano", p, score, p.objective, `/cs/planos?plano=${p.id}`, `${p.status === "ativo" ? "Ativo" : p.status === "concluido" ? "Concluído" : "Cancelado"} · ${p.actions.filter((a) => a.done).length}/${p.actions.length} ações`, { screen: "cs.planos", owners: [p.ownerId, ...p.actions.map((a) => a.responsibleId)] });
  }
  for (const a of data.articles) {
    const score = matchScore(term, termDigits, [a.title, a.category, ...(a.tags ?? [])]);
    add("artigo", a, score, a.title, `/suporte/base-de-conhecimento/${a.id}`, [a.category, `${a.views} visualizações`].filter(Boolean).join(" · "));
  }
  for (const l of data.leads) {
    const score = matchScore(term, termDigits, [l.name, l.company, l.email, l.city], [l.phone]);
    add("lead", l, score, `${l.name}${l.company ? ` · ${l.company}` : ""}`, `/marketing/leads?lead=${l.id}`, [LEAD_STATUS_LABELS[l.status], l.city].filter(Boolean).join(" · "), { screen: "marketing.leads", owners: [l.ownerId] });
  }
  for (const c of data.campaigns) {
    const score = matchScore(term, termDigits, [c.name, c.channel]);
    add("campanha", c, score, c.name, `/marketing/campanhas?campanha=${c.id}`, [CAMPAIGN_STATUS_LABELS[c.status], c.channel].filter(Boolean).join(" · "), { screen: "marketing.campanhas", owners: [c.ownerId] });
  }
  for (const k of data.kpis) {
    const score = matchScore(term, termDigits, [k.name, k.key.replace(/_/g, " "), k.description]);
    add("indicador", k, score, k.name, `/gestao/indicadores/${k.key}`, k.department === "empresa" ? "Empresa" : DEPARTMENT_LABELS[k.department]);
  }
  for (const r of Object.values(REPORT_DEFINITIONS)) {
    const score = matchScore(term, termDigits, [r.title, `relatório ${r.title}`, r.description]);
    if (score > 0) results.push({ id: `relatorio_${r.key}`, kind: "relatorio", title: `Relatório: ${r.title}`, subtitle: r.description, href: `/gestao/relatorios?tipo=${r.key}`, score, createdAt: "", access: { report: r.key } });
  }
  for (const c of data.challenges) {
    const score = matchScore(term, termDigits, [c.name, c.description]);
    add("desafio", c, score, c.name, "/performance/campanhas", [c.status === "ativa" ? "Ativa" : c.status === "planejada" ? "Planejada" : "Encerrada", c.prize].filter(Boolean).join(" · "));
  }
  // Automações: tela só do administrador (com usuário, canSeeHref decide; sem usuário, a flag `admin`).
  if (showAutomations) {
    for (const a of data.automations) {
      const score = matchScore(term, termDigits, [a.name, a.description]);
      add("automacao", a, score, a.name, `/admin/automacoes/${a.id}`, a.active ? "Ativa" : "Inativa");
    }
  }
  for (const u of data.users) {
    const score = matchScore(term, termDigits, [u.name, u.email, u.jobTitle], [u.phone]);
    add("usuario", u, score, u.name, `/admin/usuarios?usuario=${u.id}`, `${u.jobTitle ?? ROLE_LABELS[u.role]} · ${DEPARTMENT_LABELS[u.departmentId]}`, { screen: "admin.usuarios", owners: [u.id, u.managerId], departmentId: u.departmentId });
  }

  // Depois do cache compartilhado: só o que o usuário pode abrir (tela + escopo do registro).
  const allowed = user ? await visibleFor(user, results, clientById) : results;
  results.splice(0, results.length, ...allowed);

  results.sort((a, b) => b.score - a.score || (a.createdAt < b.createdAt ? 1 : -1));

  // Grupos ordenados pela relevância: o tipo dono do número pesquisado primeiro (CT- → contrato, VEN- → venda,
  // PR- → proposta, CH- → chamado), depois pela melhor pontuação do grupo; empate na ordem fixa dos tipos.
  const preferredKind = numberKindOf(term);
  const groups: SearchGroup[] = [];
  for (const kind of SEARCH_KINDS) {
    const items = results.filter((r) => r.kind === kind).slice(0, PER_GROUP);
    if (items.length > 0) groups.push({ kind, label: SEARCH_KIND_LABELS[kind], items });
  }
  const rank = (g: SearchGroup) => (g.kind === preferredKind ? 1000 : 0) + Math.max(0, ...g.items.map((i) => i.score));
  groups.sort((a, b) => rank(b) - rank(a) || SEARCH_KINDS.indexOf(a.kind) - SEARCH_KINDS.indexOf(b.kind));
  // Nome do cliente nos subtítulos (contato, oportunidade, contrato, implantação, chamado).
  const needClient = groups.flatMap((g) => (g.kind === "contato" || g.kind === "oportunidade" || g.kind === "proposta" || g.kind === "contrato" || g.kind === "implantacao" || g.kind === "plano" || g.kind === "chamado" ? g.items : [])) as (SearchResult & { clientId?: string })[];
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
