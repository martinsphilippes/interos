/**
 * Administração › Empresas ERP: a situação de cada empresa vinculada ao ERP Intercert numa lista só, calculada com o
 * que o INTEROS já guarda — vínculo (com o último evento e o último aviso do ERP, gravados quando o evento chega),
 * licença registrada, alterações abertas ou não aplicadas e a última leitura do ERP. Nada é consultado no ERP empresa
 * por empresa, e nenhum evento é varrido (o estado ao vivo fica na aba Módulos ERP do cliente). Módulo puro.
 */
import type { ErpChangeRequest, ErpLicenseRecord, ErpLink } from "./types";
import { isOnState } from "./license";
import { normalizeSearch } from "./catalog";

/** Da mais urgente à normal (a primeira que se aplica vale para a etiqueta e o filtro). */
export const ERP_COMPANY_SITUATIONS = ["falha", "nao_aplicada", "aguardando_aprovacao", "enviando", "erro_leitura", "aviso_erp", "sem_licenca", "em_dia"] as const;
export type ErpCompanySituation = (typeof ERP_COMPANY_SITUATIONS)[number];

export const ERP_COMPANY_SITUATION_LABELS: Record<ErpCompanySituation, string> = {
  falha: "Alteração não sincronizada",
  nao_aplicada: "Alteração não aplicada",
  aguardando_aprovacao: "Aguardando aprovação",
  enviando: "Enviando ao ERP",
  erro_leitura: "Última leitura falhou",
  aviso_erp: "Aviso do ERP",
  sem_licenca: "Licença não registrada",
  em_dia: "Em dia",
};

/** Situações que pedem alguém olhar (indicador e filtro "Precisam de atenção"; aprovação pendente também conta). */
export const ERP_ATTENTION_SITUATIONS: ReadonlySet<ErpCompanySituation> = new Set<ErpCompanySituation>(["falha", "nao_aplicada", "aguardando_aprovacao", "erro_leitura", "aviso_erp"]);

/** Precisa de atenção: situação da lista acima ou alguma alteração esperando aprovação. */
export const needsAttention = (row: Pick<ErpCompanyRow, "situation" | "awaitingApproval">) => ERP_ATTENTION_SITUATIONS.has(row.situation) || row.awaitingApproval;

/** O que quer dizer cada situação (texto curto da lista). */
export const ERP_COMPANY_SITUATION_HINTS: Record<ErpCompanySituation, string> = {
  falha: "O ERP ainda não confirmou a última alteração. Veja o motivo na aba Módulos ERP: tentar de novo ou cancelar.",
  nao_aplicada: "O ERP recusou a última alteração, ou já tinha outra versão. Nada mudou na empresa: veja o motivo na aba Módulos ERP e peça de novo.",
  aguardando_aprovacao: "Um desligamento espera a aprovação de quem tem a permissão de aprovar.",
  enviando: "A alteração está sendo enviada ao ERP agora.",
  erro_leitura: "A última leitura do estado da empresa no ERP (ao abrir a aba do cliente) falhou. Abra a aba para ler de novo.",
  aviso_erp: "O ERP avisou nos últimos 7 dias: licença recusada ou limite do contrato atingido.",
  sem_licenca: "Vinculada, mas o INTEROS ainda não registrou a licença: a primeira alteração parte do que a empresa usa hoje no ERP.",
  em_dia: "Licença registrada e confirmada pelo ERP, sem pendência.",
};

/** Eventos do ERP que pedem atenção. Os outros só informam (o aviso diário "licença sem novidade" inclusive). */
export const ERP_WARNING_EVENTS: readonly string[] = ["license.rejected", "limit.reached"];
const WARNING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Abertas, da mais urgente à menos (com mais de uma, a mais urgente decide a situação). */
const OPEN_RANK: Partial<Record<ErpChangeRequest["status"], number>> = { falhou: 0, aguardando_aprovacao: 1, enviando: 2 };
const NOT_APPLIED = new Set<ErpChangeRequest["status"]>(["recusada", "conflito"]);

export interface ErpCompanyEvent {
  type: string;
  at: string;
}

export interface ErpCompanyRow {
  linkId: string;
  clientId: string;
  clientName: string;
  clientStatus: string | null;
  erpCompanyId: string;
  erpCompanyName: string | null;
  cnpj: string | null;
  erpKind: string | null;
  linkedAt: string;
  method: ErpLink["method"];
  /** Licença registrada pelo INTEROS (null = ainda não registrou). */
  license: {
    appliedVersion: number;
    issuedVersion: number;
    appliedAt: string | null;
    /** Unidades ligadas agora no contratado (ativas, em teste ou com desligamento agendado). */
    units: number;
    /** Módulos com pelo menos uma unidade ligada. */
    modules: number;
    display: string | null;
    unitDisplays: number;
  } | null;
  /** A alteração aberta mais urgente (criação da empresa ou licença). */
  open: { id: string; kind: ErpChangeRequest["kind"]; status: ErpChangeRequest["status"]; requestedAt: string; requestedBy: string; lastError: string | null; nextAttemptAt: string | null } | null;
  /** Alguma alteração aberta espera aprovação (conta no indicador e no filtro mesmo que outra seja mais urgente). */
  awaitingApproval: boolean;
  /** Última alteração que o ERP não aplicou (recusada ou conflito de versão), mais nova que a licença confirmada. */
  notApplied: { id: string; status: ErpChangeRequest["status"]; at: string; message: string | null } | null;
  lastSyncAt: string | null;
  lastSyncError: { message: string; at: string } | null;
  /** Último evento recebido do ERP (sem o aviso diário "licença sem novidade"). */
  lastEvent: ErpCompanyEvent | null;
  /** Último aviso do ERP nos últimos 7 dias (licença recusada ou limite atingido). */
  warning: ErpCompanyEvent | null;
  situation: ErpCompanySituation;
}

export interface ErpCompanyInputs {
  links: readonly ErpLink[];
  /** Licenças registradas, pelo id do vínculo. */
  licenses: ReadonlyMap<string, ErpLicenseRecord>;
  /** Alterações (de licença ou de criação da empresa) ainda abertas. */
  openChanges: readonly ErpChangeRequest[];
  /** Alterações que o ERP não aplicou (recusada ou conflito). */
  notAppliedChanges: readonly ErpChangeRequest[];
  clients: ReadonlyMap<string, { tradeName?: string; legalName?: string; status?: string }>;
  now: Date;
}

const later = (a: string | null | undefined, b: string | null | undefined) => (a ?? "") > (b ?? "");

/** Situação de uma empresa (a mais urgente que se aplica). */
export function situationOf(row: Pick<ErpCompanyRow, "open" | "notApplied" | "lastSyncAt" | "lastSyncError" | "warning" | "license">): ErpCompanySituation {
  if (row.open?.status === "falhou") return "falha";
  if (row.notApplied && !row.open) return "nao_aplicada";
  if (row.open?.status === "aguardando_aprovacao") return "aguardando_aprovacao";
  if (row.open?.status === "enviando") return "enviando";
  if (row.lastSyncError && later(row.lastSyncError.at, row.lastSyncAt)) return "erro_leitura";
  if (row.warning) return "aviso_erp";
  if (!row.license?.appliedVersion) return "sem_licenca";
  return "em_dia";
}

/** Linhas da lista: uma por vínculo ativo, com a situação calculada. Ordem: mais urgente primeiro, depois o nome. */
export function buildErpCompanyRows(input: ErpCompanyInputs): ErpCompanyRow[] {
  const openByClient = new Map<string, ErpChangeRequest[]>();
  for (const c of input.openChanges) {
    if (OPEN_RANK[c.status] === undefined) continue;
    openByClient.set(c.clientId, [...(openByClient.get(c.clientId) ?? []), c]);
  }
  const lastNotApplied = new Map<string, ErpChangeRequest>();
  for (const c of input.notAppliedChanges) {
    if (!NOT_APPLIED.has(c.status)) continue;
    const prev = lastNotApplied.get(c.clientId);
    if (!prev || c.updatedAt > prev.updatedAt) lastNotApplied.set(c.clientId, c);
  }
  const since = input.now.getTime() - WARNING_WINDOW_MS;
  const rows = input.links
    .filter((l) => l.status === "ativo")
    .map((link): ErpCompanyRow => {
      const client = input.clients.get(link.clientId);
      const record = input.licenses.get(link.id) ?? null;
      const current = record?.current ?? null;
      const on = (current?.items ?? []).filter((i) => isOnState(i.state));
      const opens = (openByClient.get(link.clientId) ?? []).sort((a, b) => (OPEN_RANK[a.status] ?? 9) - (OPEN_RANK[b.status] ?? 9) || (a.requestedAt < b.requestedAt ? -1 : 1));
      const open = opens[0] ?? null;
      const refused = lastNotApplied.get(link.clientId) ?? null;
      // só conta a que veio depois da licença confirmada (uma alteração aplicada depois resolve)
      const notApplied = refused && later(refused.updatedAt, record?.appliedAt) ? refused : null;
      const warning = link.lastWarning && Date.parse(link.lastWarning.at) >= since ? { type: link.lastWarning.type, at: link.lastWarning.at } : null;
      const row: Omit<ErpCompanyRow, "situation"> = {
        linkId: link.id,
        clientId: link.clientId,
        clientName: client?.tradeName || client?.legalName || link.erpCompanyName || link.clientId,
        clientStatus: client?.status ?? null,
        erpCompanyId: link.erpCompanyId,
        erpCompanyName: link.erpCompanyName,
        cnpj: link.cnpj,
        erpKind: link.erpKind,
        linkedAt: link.linkedAt,
        method: link.method,
        license: current
          ? {
              appliedVersion: record?.appliedVersion ?? 0,
              issuedVersion: record?.issuedVersion ?? 0,
              appliedAt: record?.appliedAt ?? null,
              units: on.length,
              modules: new Set(on.map((i) => i.code.slice(0, 2))).size,
              display: current.display ?? null,
              unitDisplays: (current.displays ?? []).length,
            }
          : null,
        open: open
          ? {
              id: open.id,
              kind: open.kind,
              status: open.status,
              requestedAt: open.requestedAt,
              requestedBy: open.requestedBy?.name ?? "—",
              lastError: open.lastError?.message ?? null,
              nextAttemptAt: open.nextAttemptAt ?? null,
            }
          : null,
        awaitingApproval: opens.some((c) => c.status === "aguardando_aprovacao"),
        notApplied: notApplied
          ? {
              id: notApplied.id,
              status: notApplied.status,
              at: notApplied.updatedAt,
              message: (notApplied.result?.rejectedItems ?? []).map((r) => r.message).join(" · ") || notApplied.lastError?.message || null,
            }
          : null,
        lastSyncAt: link.lastSyncAt ?? null,
        lastSyncError: link.lastSyncError ? { message: link.lastSyncError.message, at: link.lastSyncError.at } : null,
        lastEvent: link.lastEvent ? { type: link.lastEvent.type, at: link.lastEvent.receivedAt } : null,
        warning,
      };
      return { ...row, situation: situationOf(row) };
    });
  const rank = (s: ErpCompanySituation) => ERP_COMPANY_SITUATIONS.indexOf(s);
  return rows.sort((a, b) => rank(a.situation) - rank(b.situation) || a.clientName.localeCompare(b.clientName, "pt-BR"));
}

/** O termo parece um documento (só dígitos e pontuação de CNPJ/CPF, com pelo menos 4 dígitos). */
const looksLikeDocument = (term: string) => /^[\d.\-/\s]+$/.test(term) && term.replace(/\D/g, "").length >= 4;

/** Busca por nome, nome ou id da empresa no ERP e CNPJ (com ou sem pontuação), sem diferenciar acento. */
export function matchesErpCompany(row: { clientName: string; erpCompanyName?: string | null; erpCompanyId?: string | null; cnpj?: string | null }, term: string): boolean {
  const trimmed = term.trim();
  const q = normalizeSearch(trimmed);
  if (!q) return true;
  const text = normalizeSearch([row.clientName, row.erpCompanyName ?? "", row.erpCompanyId ?? ""].join(" "));
  if (text.includes(q)) return true;
  return looksLikeDocument(trimmed) && (row.cnpj ?? "").replace(/\D/g, "").includes(trimmed.replace(/\D/g, ""));
}

/** Contagem por situação (para os indicadores do topo e os filtros). */
export function countBySituation(rows: readonly Pick<ErpCompanyRow, "situation">[]): Record<ErpCompanySituation, number> {
  const out = Object.fromEntries(ERP_COMPANY_SITUATIONS.map((s) => [s, 0])) as Record<ErpCompanySituation, number>;
  for (const r of rows) out[r.situation] += 1;
  return out;
}
