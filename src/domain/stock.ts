/**
 * Estoque de equipamentos (fase 2 do circuito hardware: faturamento → ESTOQUE → compras → entrega).
 *
 * Regras puras (sem banco), usadas pelo serviço (`src/server/stock/*`), pela tela e pelos testes:
 * - saldo: `onHand` (em mãos) − `reserved` (separado para contratos) = disponível; nenhum dos três fica negativo;
 * - custo médio ponderado recalculado a cada entrada com custo (devolução e ajuste não mexem no custo médio);
 * - reserva por origem do item: "estoque" reserva o que há e aponta a falta; "estoque_ou_compra" reserva o que há e
 *   o resto vai para compra; "sob_demanda" não reserva: tudo vai para compra (a fase 3, Compras, consome a falta);
 * - números de série: normalizados (maiúsculas, sem espaços nas pontas), únicos no lote.
 */
import type { DepartmentKey } from "./constants";

export const STOCK_ORIGINS = ["estoque", "estoque_ou_compra", "sob_demanda"] as const;
export type StockOrigin = (typeof STOCK_ORIGINS)[number];

export const STOCK_ORIGIN_LABELS: Record<StockOrigin, string> = {
  estoque: "Estoque próprio",
  estoque_ou_compra: "Estoque e, se faltar, compra",
  sob_demanda: "Sob demanda (compra para cada venda)",
};

export const STOCK_ORIGIN_HINTS: Record<StockOrigin, string> = {
  estoque: "Reserva do estoque na assinatura; o que faltar fica apontado como falta.",
  estoque_ou_compra: "Reserva do estoque na assinatura; o que faltar vai para compra.",
  sob_demanda: "Não reserva estoque: a venda inteira vai para compra.",
};

export const STOCK_MOVEMENT_TYPES = ["entrada", "reserva", "liberacao", "saida", "devolucao", "ajuste"] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  entrada: "Entrada",
  reserva: "Reserva",
  liberacao: "Reserva liberada",
  saida: "Saída",
  devolucao: "Devolução",
  ajuste: "Ajuste",
};

export const STOCK_SERIAL_STATUSES = ["em_estoque", "entregue", "baixado"] as const;
export type StockSerialStatus = (typeof STOCK_SERIAL_STATUSES)[number];

export const STOCK_SERIAL_STATUS_LABELS: Record<StockSerialStatus, string> = {
  em_estoque: "Em estoque",
  entregue: "Com o cliente",
  baixado: "Baixado",
};

export const STOCK_SETTING_KEY = "estoque";

/** Configuração do estoque (setting `estoque`). */
export interface StockSettings {
  /** Departamento que responde pelo estoque e recebe os alertas (mínimo e falta). Padrão: Administrativo. */
  responsibleDepartment: DepartmentKey;
  /** Reserva automática quando o contrato é assinado por todos. */
  reserveOnSign: boolean;
  /** Avisa o responsável quando o disponível fica abaixo do mínimo. */
  notifyLowStock: boolean;
  stored: boolean;
}

export const DEFAULT_STOCK_SETTINGS: Omit<StockSettings, "stored"> = {
  responsibleDepartment: "administrativo",
  reserveOnSign: true,
  notifyLowStock: true,
};

export function normalizeStockSettings(raw: unknown): StockSettings {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const dep = typeof v?.responsibleDepartment === "string" ? (v.responsibleDepartment as DepartmentKey) : DEFAULT_STOCK_SETTINGS.responsibleDepartment;
  return {
    responsibleDepartment: dep,
    reserveOnSign: typeof v?.reserveOnSign === "boolean" ? v.reserveOnSign : DEFAULT_STOCK_SETTINGS.reserveOnSign,
    notifyLowStock: typeof v?.notifyLowStock === "boolean" ? v.notifyLowStock : DEFAULT_STOCK_SETTINGS.notifyLowStock,
    stored: v !== null,
  };
}

/** Saldo de um item. */
export interface StockBalance {
  onHand: number;
  reserved: number;
  avgCost: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function availableOf(b: Pick<StockBalance, "onHand" | "reserved">): number {
  return Math.max(0, (Number(b.onHand) || 0) - (Number(b.reserved) || 0));
}

/** Abaixo do mínimo: só quando há mínimo configurado (> 0) e o disponível ficou menor que ele. */
export function isBelowMinimum(b: Pick<StockBalance, "onHand" | "reserved">, minQuantity: number | undefined): boolean {
  const min = Number(minQuantity) || 0;
  return min > 0 && availableOf(b) < min;
}

/** Quantidade inteira positiva (estoque conta unidades inteiras). */
export function isValidQuantity(q: unknown): q is number {
  return typeof q === "number" && Number.isInteger(q) && q > 0 && q <= 1_000_000;
}

/** Custo médio ponderado depois de uma entrada de `quantity` unidades a `unitCost`. */
export function averageCostAfterEntry(balance: Pick<StockBalance, "onHand" | "avgCost">, quantity: number, unitCost: number): number {
  const onHand = Math.max(0, Number(balance.onHand) || 0);
  const avg = Math.max(0, Number(balance.avgCost) || 0);
  if (onHand + quantity <= 0) return round4(unitCost);
  if (onHand === 0) return round4(unitCost);
  return round4((onHand * avg + quantity * unitCost) / (onHand + quantity));
}

export function stockValue(b: Pick<StockBalance, "onHand" | "avgCost">): number {
  return round2(Math.max(0, Number(b.onHand) || 0) * Math.max(0, Number(b.avgCost) || 0));
}

/** Movimento aplicado ao saldo (o que o serviço grava). */
export type StockMove =
  | { type: "entrada"; quantity: number; unitCost: number }
  | { type: "reserva"; quantity: number }
  | { type: "liberacao"; quantity: number }
  /** fromReserved: quantas unidades saem de reservas (o resto sai do disponível). */
  | { type: "saida"; quantity: number; fromReserved: number }
  | { type: "devolucao"; quantity: number }
  /** delta com sinal: + achou unidades, − perda/avaria/baixa. */
  | { type: "ajuste"; delta: number };

export class StockRuleError extends Error {}

/**
 * Aplica um movimento ao saldo e devolve o saldo novo; lança StockRuleError quando o movimento deixaria algo negativo
 * ou usaria unidades reservadas para outro contrato.
 */
export function applyStockMove(balance: StockBalance, move: StockMove): StockBalance {
  const onHand = Number(balance.onHand) || 0;
  const reserved = Number(balance.reserved) || 0;
  const avgCost = Number(balance.avgCost) || 0;
  const available = onHand - reserved;
  switch (move.type) {
    case "entrada": {
      if (!isValidQuantity(move.quantity)) throw new StockRuleError("Quantidade inválida");
      if (!(move.unitCost >= 0)) throw new StockRuleError("Custo unitário inválido");
      return { onHand: onHand + move.quantity, reserved, avgCost: averageCostAfterEntry({ onHand, avgCost }, move.quantity, move.unitCost) };
    }
    case "reserva": {
      if (!isValidQuantity(move.quantity)) throw new StockRuleError("Quantidade inválida");
      if (move.quantity > available) throw new StockRuleError(`Só há ${Math.max(0, available)} disponível(is) para reservar`);
      return { onHand, reserved: reserved + move.quantity, avgCost };
    }
    case "liberacao": {
      if (!isValidQuantity(move.quantity)) throw new StockRuleError("Quantidade inválida");
      if (move.quantity > reserved) throw new StockRuleError(`Só há ${reserved} reservada(s)`);
      return { onHand, reserved: reserved - move.quantity, avgCost };
    }
    case "saida": {
      if (!isValidQuantity(move.quantity)) throw new StockRuleError("Quantidade inválida");
      const fromReserved = Math.max(0, Math.min(move.fromReserved, move.quantity));
      if (fromReserved > reserved) throw new StockRuleError(`Só há ${reserved} reservada(s)`);
      const free = move.quantity - fromReserved;
      if (free > available) throw new StockRuleError(`Só há ${Math.max(0, available)} disponível(is): o restante está reservado para outros contratos`);
      if (move.quantity > onHand) throw new StockRuleError(`Só há ${onHand} em estoque`);
      return { onHand: onHand - move.quantity, reserved: reserved - fromReserved, avgCost };
    }
    case "devolucao": {
      if (!isValidQuantity(move.quantity)) throw new StockRuleError("Quantidade inválida");
      return { onHand: onHand + move.quantity, reserved, avgCost };
    }
    case "ajuste": {
      if (!Number.isInteger(move.delta) || move.delta === 0 || Math.abs(move.delta) > 1_000_000) throw new StockRuleError("Informe quantas unidades entram (+) ou saem (−)");
      const next = onHand + move.delta;
      if (next < 0) throw new StockRuleError(`O estoque não pode ficar negativo (há ${onHand})`);
      if (next < reserved) throw new StockRuleError(`Há ${reserved} reservada(s) para contratos: libere reservas antes de baixar abaixo disso`);
      return { onHand: next, reserved, avgCost };
    }
  }
}

/**
 * Quanto reservar de um pedido de `requested` unidades, pela origem do item: o que vai para o contrato agora
 * (`reserve`) e o que falta (`missing`, comprar ou repor). `toPurchase` diz se a falta vira compra (fase 3).
 */
export function allocateReservation(origin: StockOrigin, requested: number, available: number): { reserve: number; missing: number; toPurchase: boolean } {
  const want = Math.max(0, Math.floor(requested));
  if (origin === "sob_demanda") return { reserve: 0, missing: want, toPurchase: want > 0 };
  const reserve = Math.min(want, Math.max(0, Math.floor(available)));
  const missing = want - reserve;
  return { reserve, missing, toPurchase: origin === "estoque_ou_compra" && missing > 0 };
}

/** Vínculo de um item de estoque com um produto vendido: `units` unidades do item por unidade do produto. */
export interface StockProductLink {
  productId: string;
  productName?: string;
  units: number;
}

/** Item de contrato (só o que importa para a reserva). */
export interface ContractLineForStock {
  productId: string;
  productName?: string;
  quantity: number;
}

export interface StockItemForDemand {
  id: string;
  name: string;
  active: boolean;
  products?: StockProductLink[];
}

/**
 * Quantas unidades de cada item de estoque o contrato pede: para cada linha do contrato, os itens ativos vinculados
 * ao produto × quantidade da linha (mínimo 1) × unidades por produto. Itens repetidos somam.
 */
export function contractStockDemand(lines: ContractLineForStock[], items: StockItemForDemand[]): Map<string, number> {
  const demand = new Map<string, number>();
  for (const line of lines) {
    if (!line.productId) continue;
    const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));
    for (const item of items) {
      if (!item.active) continue;
      for (const link of item.products ?? []) {
        if (link.productId !== line.productId) continue;
        const units = Math.max(1, Math.floor(Number(link.units) || 1));
        demand.set(item.id, (demand.get(item.id) ?? 0) + qty * units);
      }
    }
  }
  return demand;
}

/** Número de série normalizado (maiúsculas, sem espaços nas pontas, espaços internos únicos). */
export function normalizeSerial(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * Lê números de série digitados (um por linha, ou separados por vírgula/ponto e vírgula), normalizados. Devolve os
 * repetidos para a tela avisar.
 */
export function parseSerials(raw: string | string[]): { serials: string[]; duplicates: string[] } {
  const parts = (Array.isArray(raw) ? raw : raw.split(/[\n,;]+/)).map(normalizeSerial).filter(Boolean);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const s of parts) {
    if (seen.has(s)) duplicates.add(s);
    seen.add(s);
  }
  return { serials: Array.from(seen), duplicates: Array.from(duplicates) };
}

/** Id do documento de um número de série: único por item. */
export function serialDocId(itemId: string, serial: string): string {
  const key = normalizeSerial(serial)
    .replace(/[^A-Z0-9_-]/g, "_")
    .slice(0, 120);
  return `${itemId}__${key}`;
}

/** Id determinístico da reserva de um item para um contrato (a mesma assinatura repetida não duplica). */
export function reservationDocId(contractId: string, itemId: string): string {
  return `rsv_${contractId}_${itemId}`;
}

/** Situação de uma reserva para a tela. */
export type ReservationState = "aguardando" | "parcial" | "separada" | "atendida" | "cancelada" | "devolucao_pendente";

export interface ReservationCounts {
  quantity: number;
  reserved: number;
  delivered: number;
  returned?: number;
  status: "ativa" | "atendida" | "cancelada";
}

/** Falta = pedida − separada − entregue (nunca negativa). */
export function reservationMissing(r: Pick<ReservationCounts, "quantity" | "reserved" | "delivered">): number {
  return Math.max(0, (r.quantity || 0) - (r.reserved || 0) - (r.delivered || 0));
}

/** Entregues que ainda precisam voltar (contrato cancelado depois da saída). */
export function reservationPendingReturn(r: Pick<ReservationCounts, "delivered" | "returned" | "status">): number {
  if (r.status !== "cancelada") return 0;
  return Math.max(0, (r.delivered || 0) - (r.returned || 0));
}

export function reservationState(r: ReservationCounts): ReservationState {
  if (r.status === "cancelada") return reservationPendingReturn(r) > 0 ? "devolucao_pendente" : "cancelada";
  if (r.status === "atendida") return "atendida";
  const missing = reservationMissing(r);
  if (missing === 0) return "separada";
  return r.reserved > 0 || r.delivered > 0 ? "parcial" : "aguardando";
}

export const RESERVATION_STATE_LABELS: Record<ReservationState, string> = {
  aguardando: "Aguardando estoque",
  parcial: "Parcialmente separada",
  separada: "Separada",
  atendida: "Entregue",
  cancelada: "Cancelada",
  devolucao_pendente: "Devolução pendente",
};

/**
 * Distribui `quantity` unidades que acabaram de entrar entre as reservas com falta, das mais antigas para as mais
 * novas. Devolve quanto cada reserva recebe (só as que recebem algo).
 */
export function fillPendingReservations<T extends { id: string; createdAt: string } & Pick<ReservationCounts, "quantity" | "reserved" | "delivered">>(
  reservations: T[],
  quantity: number,
): { id: string; add: number }[] {
  let left = Math.max(0, Math.floor(quantity));
  const out: { id: string; add: number }[] = [];
  for (const r of [...reservations].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    if (left <= 0) break;
    const missing = reservationMissing(r);
    if (missing <= 0) continue;
    const add = Math.min(missing, left);
    out.push({ id: r.id, add });
    left -= add;
  }
  return out;
}
