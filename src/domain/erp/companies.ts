/**
 * Administração › Empresas ERP: a situação de cada empresa vinculada ao ERP Intercert numa lista só, calculada com o
 * que o INTEROS já guarda — vínculo, licença registrada, alteração em andamento, última leitura do ERP e últimos avisos
 * recebidos dele. A lista abre rápido mesmo com milhares de empresas: nada é consultado no ERP empresa por empresa
 * (o estado ao vivo fica na aba Módulos ERP do cliente). Módulo puro.
 */
import type { ErpChangeRequest, ErpLicenseRecord, ErpLink } from "./types";
import { isOnState } from "./license";
import { normalizeSearch } from "./catalog";

/** Da mais urgente à normal (a primeira que se aplica vale para a etiqueta e o filtro). */
export const ERP_COMPANY_SITUATIONS = ["falha", "aguardando_aprovacao", "enviando", "erro_leitura", "aviso_erp", "sem_licenca", "em_dia"] as const;
export type ErpCompanySituation = (typeof ERP_COMPANY_SITUATIONS)[number];

export const ERP_COMPANY_SITUATION_LABELS: Record<ErpCompanySituation, string> = {
  falha: "Alteração não sincronizada",
  aguardando_aprovacao: "Aguardando aprovação",
  enviando: "Enviando ao ERP",
  erro_leitura: "ERP não respondeu",
  aviso_erp: "Aviso do ERP",
  sem_licenca: "Licença não registrada",
  em_dia: "Em dia",
};

/** O que fazer em cada situação (texto curto da lista). */
export const ERP_COMPANY_SITUATION_HINTS: Record<ErpCompanySituation, string> = {
  falha: "O ERP ainda não confirmou a última alteração: a sincronização tenta de novo sozinha; veja o motivo na aba Módulos ERP.",
  aguardando_aprovacao: "Um desligamento espera a aprovação de quem tem a permissão de aprovar.",
  enviando: "A alteração está sendo enviada ao ERP agora.",
  erro_leitura: "A última leitura do estado da empresa no ERP falhou.",
  aviso_erp: "O ERP avisou nos últimos 7 dias: licença recusada ou limite do contrato atingido.",
  sem_licenca: "Vinculada, mas o INTEROS ainda não registrou a licença: a primeira alteração parte do que a empresa usa hoje no ERP.",
  em_dia: "Licença registrada e confirmada pelo ERP, sem pendência.",
};

/** Eventos do ERP que pedem atenção. Os outros só informam (o aviso diário "licença sem novidade" inclusive). */
export const ERP_WARNING_EVENTS: readonly string[] = ["license.rejected", "limit.reached"];
const WARNING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const OPEN = new Set<ErpChangeRequest["status"]>(["aguardando_aprovacao", "enviando", "falhou"]);

export interface ErpCompanyEvent {
  type: string;
  receivedAt: string;
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
  open: { id: string; kind: ErpChangeRequest["kind"]; status: ErpChangeRequest["status"]; requestedAt: string; requestedBy: string; lastError: string | null } | null;
  lastSyncAt: string | null;
  lastSyncError: { message: string; at: string } | null;
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
  clients: ReadonlyMap<string, { tradeName?: string; legalName?: string; status?: string }>;
  /** Eventos recebidos do ERP, de qualquer empresa do ambiente (os mais recentes primeiro ou não: a função ordena). */
  events: readonly (ErpCompanyEvent & { erpCompanyId: string })[];
  now: Date;
}

const later = (a: string | null | undefined, b: string | null | undefined) => (a ?? "") > (b ?? "");

/** Situação de uma empresa (a mais urgente que se aplica). */
export function situationOf(row: Pick<ErpCompanyRow, "open" | "lastSyncAt" | "lastSyncError" | "warning" | "license">): ErpCompanySituation {
  if (row.open?.status === "falhou") return "falha";
  if (row.open?.status === "aguardando_aprovacao") return "aguardando_aprovacao";
  if (row.open?.status === "enviando") return "enviando";
  if (row.lastSyncError && later(row.lastSyncError.at, row.lastSyncAt)) return "erro_leitura";
  if (row.warning) return "aviso_erp";
  if (!row.license?.appliedVersion) return "sem_licenca";
  return "em_dia";
}

/** Linhas da lista: uma por vínculo ativo, com a situação calculada. Ordem: mais urgente primeiro, depois o nome. */
export function buildErpCompanyRows(input: ErpCompanyInputs): ErpCompanyRow[] {
  const openByClient = new Map<string, ErpChangeRequest>();
  for (const c of [...input.openChanges].filter((c) => OPEN.has(c.status)).sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : 1))) {
    // uma alteração aberta por empresa; se houver mais (criação + licença), vale a mais antiga (a que trava a próxima)
    if (!openByClient.has(c.clientId)) openByClient.set(c.clientId, c);
  }
  const lastEvent = new Map<string, ErpCompanyEvent>();
  const lastWarning = new Map<string, ErpCompanyEvent>();
  const since = input.now.getTime() - WARNING_WINDOW_MS;
  for (const e of input.events) {
    const prev = lastEvent.get(e.erpCompanyId);
    if (!prev || e.receivedAt > prev.receivedAt) lastEvent.set(e.erpCompanyId, { type: e.type, receivedAt: e.receivedAt });
    if (ERP_WARNING_EVENTS.includes(e.type) && Date.parse(e.receivedAt) >= since) {
      const w = lastWarning.get(e.erpCompanyId);
      if (!w || e.receivedAt > w.receivedAt) lastWarning.set(e.erpCompanyId, { type: e.type, receivedAt: e.receivedAt });
    }
  }
  const rows = input.links
    .filter((l) => l.status === "ativo")
    .map((link): ErpCompanyRow => {
      const client = input.clients.get(link.clientId);
      const record = input.licenses.get(link.id) ?? null;
      const current = record?.current ?? null;
      const on = (current?.items ?? []).filter((i) => isOnState(i.state));
      const open = openByClient.get(link.clientId) ?? null;
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
          ? { id: open.id, kind: open.kind, status: open.status, requestedAt: open.requestedAt, requestedBy: open.requestedBy?.name ?? "—", lastError: open.lastError?.message ?? null }
          : null,
        lastSyncAt: link.lastSyncAt ?? null,
        lastSyncError: link.lastSyncError ? { message: link.lastSyncError.message, at: link.lastSyncError.at } : null,
        lastEvent: lastEvent.get(link.erpCompanyId) ?? null,
        warning: lastWarning.get(link.erpCompanyId) ?? null,
      };
      return { ...row, situation: situationOf(row) };
    });
  const rank = (s: ErpCompanySituation) => ERP_COMPANY_SITUATIONS.indexOf(s);
  return rows.sort((a, b) => rank(a.situation) - rank(b.situation) || a.clientName.localeCompare(b.clientName, "pt-BR"));
}

/** Busca por nome do cliente, nome ou id da empresa no ERP e CNPJ (com ou sem pontuação), sem diferenciar acento. */
export function matchesErpCompany(row: Pick<ErpCompanyRow, "clientName" | "erpCompanyName" | "erpCompanyId" | "cnpj">, term: string): boolean {
  const q = normalizeSearch(term.trim());
  if (!q) return true;
  const digits = term.replace(/\D/g, "");
  const text = normalizeSearch([row.clientName, row.erpCompanyName ?? "", row.erpCompanyId].join(" "));
  return text.includes(q) || (digits.length >= 4 && (row.cnpj ?? "").includes(digits));
}

/** Contagem por situação (para os indicadores do topo e os filtros). */
export function countBySituation(rows: readonly Pick<ErpCompanyRow, "situation">[]): Record<ErpCompanySituation, number> {
  const out = Object.fromEntries(ERP_COMPANY_SITUATIONS.map((s) => [s, 0])) as Record<ErpCompanySituation, number>;
  for (const r of rows) out[r.situation] += 1;
  return out;
}
