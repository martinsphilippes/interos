/**
 * Compras (fase 3 do circuito hardware: faturamento → estoque → COMPRAS → entrega).
 *
 * Regras puras (sem banco), usadas pelo serviço (`src/server/purchases/*`), pela tela e pelos testes:
 * - necessidade de compra de cada item: cobrir a falta das reservas de contratos e repor o estoque mínimo, descontando
 *   o que já está pedido e ainda não chegou;
 * - aprovação: desligada por padrão; ligada, pedidos ACIMA do valor configurado esperam a diretoria ou o gestor do
 *   Administrativo; até o valor seguem direto;
 * - situação do pedido pelo recebido (parcial / recebido).
 */

export const PURCHASE_STATUSES = ["rascunho", "aguardando_aprovacao", "aprovado", "parcial", "recebido", "cancelado"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  rascunho: "Rascunho",
  aguardando_aprovacao: "Aguardando aprovação",
  aprovado: "Aprovado (a receber)",
  parcial: "Recebido em parte",
  recebido: "Recebido",
  cancelado: "Cancelado",
};

/** Pedido que ainda vai trazer mercadoria (conta como "já pedido" nas necessidades). */
export const OPEN_PURCHASE_STATUSES: readonly PurchaseStatus[] = ["rascunho", "aguardando_aprovacao", "aprovado", "parcial"];

export const PURCHASE_SETTING_KEY = "compras";

export interface PurchaseSettings {
  /** Exigir aprovação para pedidos acima de `approvalThreshold`. */
  approvalEnabled: boolean;
  /** Valor (R$) acima do qual o pedido espera aprovação. 0 = todo pedido. */
  approvalThreshold: number;
  /** Categoria do título em Contas a Pagar criado no recebimento. */
  payableCategory: string;
  /** Prazo padrão de pagamento (dias depois do recebimento). */
  paymentDays: number;
  stored: boolean;
}

export const DEFAULT_PURCHASE_SETTINGS: Omit<PurchaseSettings, "stored"> = {
  approvalEnabled: false,
  approvalThreshold: 5000,
  payableCategory: "fornecedor",
  paymentDays: 30,
};

export function normalizePurchaseSettings(raw: unknown): PurchaseSettings {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const num = (x: unknown, d: number, max: number) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= max ? x : d);
  return {
    approvalEnabled: typeof v?.approvalEnabled === "boolean" ? v.approvalEnabled : DEFAULT_PURCHASE_SETTINGS.approvalEnabled,
    approvalThreshold: Math.round(num(v?.approvalThreshold, DEFAULT_PURCHASE_SETTINGS.approvalThreshold, 100_000_000) * 100) / 100,
    payableCategory: typeof v?.payableCategory === "string" && v.payableCategory.trim() ? v.payableCategory.trim() : DEFAULT_PURCHASE_SETTINGS.payableCategory,
    paymentDays: Math.floor(num(v?.paymentDays, DEFAULT_PURCHASE_SETTINGS.paymentDays, 365)),
    stored: v !== null,
  };
}

/** O pedido precisa de aprovação? Só com a aprovação ligada e total ACIMA do valor (igual ao valor segue direto). */
export function needsApproval(settings: Pick<PurchaseSettings, "approvalEnabled" | "approvalThreshold">, total: number): boolean {
  return settings.approvalEnabled && total > settings.approvalThreshold;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PurchaseLine {
  itemId: string;
  itemName: string;
  quantity: number;
  unitCost: number;
  received: number;
}

export function orderTotal(lines: Pick<PurchaseLine, "quantity" | "unitCost">[]): number {
  return round2(lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0));
}

export function lineRemaining(l: Pick<PurchaseLine, "quantity" | "received">): number {
  return Math.max(0, (l.quantity || 0) - (l.received || 0));
}

/** Situação depois de um recebimento: tudo chegou → recebido; algo chegou → parcial; nada → aprovado. */
export function statusAfterReceipt(lines: Pick<PurchaseLine, "quantity" | "received">[]): PurchaseStatus {
  const total = lines.reduce((s, l) => s + (l.quantity || 0), 0);
  const got = lines.reduce((s, l) => s + Math.min(l.received || 0, l.quantity || 0), 0);
  if (total > 0 && got >= total) return "recebido";
  return got > 0 ? "parcial" : "aprovado";
}

/** Situação do item para calcular a necessidade. */
export interface NeedInput {
  itemId: string;
  name: string;
  active: boolean;
  onHand: number;
  reserved: number;
  minQuantity: number;
  /** Falta nas reservas ativas de contratos. */
  missing: number;
  /** Pedido e ainda não recebido (pedidos em aberto). */
  ordered: number;
}

export interface NeedRow extends NeedInput {
  available: number;
  /** Quanto comprar para cobrir a falta dos contratos e voltar ao mínimo. */
  suggested: number;
  reasons: ("contratos" | "minimo")[];
}

/**
 * Necessidade de compra: meta = falta das reservas + mínimo; tem = disponível + já pedido; sugerido = meta − tem.
 * Item desativado não entra.
 */
export function purchaseNeed(i: NeedInput): NeedRow {
  const available = Math.max(0, (i.onHand || 0) - (i.reserved || 0));
  const missing = Math.max(0, i.missing || 0);
  const min = Math.max(0, i.minQuantity || 0);
  const ordered = Math.max(0, i.ordered || 0);
  const suggested = i.active ? Math.max(0, missing + min - available - ordered) : 0;
  const reasons: NeedRow["reasons"] = [];
  if (suggested > 0 && missing > 0) reasons.push("contratos");
  if (suggested > 0 && min > 0 && available + ordered - missing < min) reasons.push("minimo");
  return { ...i, missing, ordered, available, suggested, reasons };
}

/** Vencimento do título: data do recebimento + prazo (AAAA-MM-DD). */
export function payableDueDate(receivedAt: string, days: number): string {
  const d = new Date(`${receivedAt.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.floor(days)));
  return d.toISOString().slice(0, 10);
}
