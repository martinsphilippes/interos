/**
 * Eventos ERP → INTEROS (webhook `POST /api/webhooks/erp`, contrato v2 §eventos de saída). Módulo puro: leitura e
 * validação do envelope, rótulos e textos para o histórico do cliente e para a administração.
 *
 * Envelope (ordem exata das chaves no ERP): `{ type, companyId, at, data, eventId }`, com `eventId =
 * "<type>:<companyId>:<at>"` estável entre as novas tentativas do ERP (a mesma entrega pode chegar mais de uma vez).
 * A assinatura `X-ERP-Signature: t=<unix>,v1=<hex>` (HMAC-SHA256 de `${t}.${corpo bruto}`) é conferida antes daqui.
 */

/** Endereço do webhook no INTEROS (o ERP o recebe em INTEROS_EVENTS_URL). */
export const ERP_EVENTS_WEBHOOK_PATH = "/api/webhooks/erp";

export const ERP_EVENT_TYPES = ["license.applied", "license.rejected", "license.transition", "upsell.requested", "limit.reached", "sync.stale"] as const;
export type ErpEventType = (typeof ERP_EVENT_TYPES)[number];

export const ERP_EVENT_LABELS: Record<ErpEventType, string> = {
  "license.applied": "Licença aplicada",
  "license.rejected": "Licença recusada",
  "license.transition": "Mudança automática de módulos",
  "upsell.requested": "Pedido de módulo no ERP",
  "limit.reached": "Limite do contrato atingido",
  "sync.stale": "ERP sem licença nova há dias",
};

export const ERP_LIMIT_LABELS: Record<string, string> = {
  users: "usuários",
  devices: "dispositivos (terminais)",
  branches: "filiais",
  fiscalDocumentsPerMonth: "documentos fiscais no mês",
};

/** Situação do registro de um evento recebido. */
export type ErpInboundStatus = "processando" | "processado" | "ignorado" | "falhou";

export const ERP_INBOUND_STATUS_LABELS: Record<ErpInboundStatus, string> = {
  processando: "Processando",
  processado: "Processado",
  ignorado: "Ignorado",
  falhou: "Falhou",
};

export interface ErpInboundEvent {
  /** Tipo informado pelo ERP (pode ser um tipo novo que o INTEROS ainda não trata). */
  type: string;
  known: boolean;
  erpCompanyId: string;
  /** Instante do evento no ERP (ISO). */
  at: string;
  eventId: string;
  data: Record<string, unknown>;
}

const ERP_ID = /^[A-Za-z0-9_-]{1,64}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Valida o envelope. Tipo desconhecido é aceito (registrado e ignorado) para não fazer o ERP repetir à toa. */
export function parseErpEvent(raw: unknown): { ok: true; event: ErpInboundEvent } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: "Corpo do evento não é um objeto." };
  const { type, companyId, at, eventId, data } = raw;
  if (typeof type !== "string" || !/^[a-z][a-z0-9_.-]{1,60}$/.test(type)) return { ok: false, error: "Tipo do evento inválido." };
  if (typeof companyId !== "string" || !ERP_ID.test(companyId)) return { ok: false, error: "Empresa do evento inválida." };
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return { ok: false, error: "Data do evento inválida." };
  if (typeof eventId !== "string" || eventId.length < 8 || eventId.length > 200) return { ok: false, error: "Identificador do evento inválido." };
  if (data !== undefined && data !== null && !isRecord(data)) return { ok: false, error: "Dados do evento inválidos." };
  return { ok: true, event: { type, known: (ERP_EVENT_TYPES as readonly string[]).includes(type), erpCompanyId: companyId, at, eventId, data: isRecord(data) ? data : {} } };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Versão da licença citada pelo evento (aplicada/recusada/transição). */
export function eventLicenseVersion(event: Pick<ErpInboundEvent, "data">): number | null {
  const v = num(event.data.licenseVersion);
  return v !== null && Number.isInteger(v) && v > 0 ? v : null;
}

/** Itens recusados (código e mensagem do ERP). */
export function rejectedItemsOf(event: Pick<ErpInboundEvent, "data">): { code: string; message: string }[] {
  const items = Array.isArray(event.data.rejectedItems) ? event.data.rejectedItems : [];
  return items.filter(isRecord).map((i) => ({ code: text(i.code) ?? "?", message: text(i.message) ?? text(i.reason) ?? "recusado" }));
}

/** Pedido de módulo feito por alguém da empresa no ERP ("Solicitar contratação"). */
export function moduleRequestOf(event: Pick<ErpInboundEvent, "data">): { requestId: string | null; code: string | null; module: string | null; name: string | null } {
  return { requestId: text(event.data.requestId), code: text(event.data.code), module: text(event.data.module), name: text(event.data.name) };
}

/** Limite atingido: tipo, uso e limite (e o mês, para documentos fiscais). */
export function limitOf(event: Pick<ErpInboundEvent, "data">): { kind: string; label: string; used: number | null; limit: number | null; month: string | null; blocking: boolean } {
  const kind = text(event.data.kind) ?? "desconhecido";
  return { kind, label: ERP_LIMIT_LABELS[kind] ?? kind, used: num(event.data.used), limit: num(event.data.limit), month: text(event.data.month), blocking: event.data.blocking !== false && kind !== "fiscalDocumentsPerMonth" };
}

/** Ação do ERP → [antes, depois]: o ERP só manda a mudança quando o estado do módulo de fato vira. */
const TRANSITION_ACTIONS: Record<string, [string, string]> = { enable: ["desligado", "ligado"], disable: ["ligado", "desligado"] };

/**
 * Mudanças de uma transição automática (fim de teste, ativação ou suspensão agendada, fim de vigência). O ERP manda as
 * mudanças do próprio runtime (`{ module, action: "enable" | "disable" }`, chave interna do módulo no ERP); aceita
 * também `{ code, from, to }` se o formato evoluir.
 */
export function transitionChangesOf(event: Pick<ErpInboundEvent, "data">): { code: string; from: string | null; to: string | null }[] {
  const changes = Array.isArray(event.data.changes) ? event.data.changes : [];
  return changes.filter(isRecord).map((c) => {
    const action = text(c.action);
    const known = action ? TRANSITION_ACTIONS[action] : undefined;
    return { code: text(c.code) ?? text(c.unit) ?? text(c.module) ?? "?", from: text(c.from) ?? known?.[0] ?? null, to: text(c.to) ?? known?.[1] ?? action };
  });
}

/** Mudanças no formato "de → para" do histórico do cliente (`payload.changes`), como nas alterações feitas pelo INTEROS. */
export function transitionChangeMap(changes: { code: string; from: string | null; to: string | null }[]): Record<string, { from: string; to: string }> {
  return Object.fromEntries(changes.map((c) => [c.code, { from: c.from ?? "—", to: c.to ?? "—" }]));
}

/** Mês de referência (AAAA-MM) de um instante, para não repetir a mesma tarefa de limite no mês. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}
