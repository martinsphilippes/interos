import "server-only";
/**
 * Estoque — leituras da tela /estoque (a página confere a tela e as seções; custo só para quem vê custos).
 */
import { list, type WhereClause } from "@/server/db";
import {
  availableOf,
  isBelowMinimum,
  reservationMissing,
  reservationPendingReturn,
  reservationState,
  stockValue,
  type ReservationState,
  type StockMovementType,
  type StockOrigin,
  type StockProductLink,
  type StockSerialStatus,
} from "@/domain/stock";
import { COLLECTIONS, type Product, type StockItem, type StockMovement, type StockReservation, type StockSerial } from "@/domain/types";

export interface StockItemRow {
  id: string;
  name: string;
  sku?: string;
  manufacturer?: string;
  model?: string;
  unit: string;
  serialControlled: boolean;
  origin: StockOrigin;
  minQuantity: number;
  products: StockProductLink[];
  location?: string;
  notes?: string;
  active: boolean;
  onHand: number;
  reserved: number;
  available: number;
  /** Falta nas reservas ativas (comprar ou repor). */
  missing: number;
  belowMinimum: boolean;
  /** null quando quem vê não pode ver custos. */
  avgCost: number | null;
  value: number | null;
}

export interface StockOverview {
  items: StockItemRow[];
  totals: {
    activeItems: number;
    units: number;
    reserved: number;
    value: number | null;
    belowMinimum: number;
    missing: number;
    waitingReservations: number;
    pendingReturns: number;
  };
}

export async function getStockOverview(options: { showCost: boolean }): Promise<StockOverview> {
  const [items, reservations] = await Promise.all([list<StockItem>(COLLECTIONS.stockItems), list<StockReservation>(COLLECTIONS.stockReservations)]);
  const missingByItem = new Map<string, number>();
  let waiting = 0;
  let pendingReturns = 0;
  for (const r of reservations) {
    if (r.status === "ativa") {
      const m = reservationMissing(r);
      if (m > 0) {
        waiting += 1;
        missingByItem.set(r.itemId, (missingByItem.get(r.itemId) ?? 0) + m);
      }
    }
    if (reservationPendingReturn(r) > 0) pendingReturns += 1;
  }
  const rows: StockItemRow[] = items
    .map((i) => ({
      id: i.id,
      name: i.name,
      sku: i.sku,
      manufacturer: i.manufacturer,
      model: i.model,
      unit: i.unit || "un",
      serialControlled: Boolean(i.serialControlled),
      origin: i.origin,
      minQuantity: i.minQuantity || 0,
      products: i.products ?? [],
      location: i.location,
      notes: i.notes,
      active: i.active !== false,
      onHand: i.onHand || 0,
      reserved: i.reserved || 0,
      available: availableOf(i),
      missing: missingByItem.get(i.id) ?? 0,
      belowMinimum: i.active !== false && isBelowMinimum(i, i.minQuantity),
      avgCost: options.showCost ? i.avgCost || 0 : null,
      value: options.showCost ? stockValue(i) : null,
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || Number(b.belowMinimum) - Number(a.belowMinimum) || a.name.localeCompare(b.name, "pt-BR"));
  const active = rows.filter((r) => r.active);
  return {
    items: rows,
    totals: {
      activeItems: active.length,
      units: active.reduce((s, r) => s + r.onHand, 0),
      reserved: active.reduce((s, r) => s + r.reserved, 0),
      value: options.showCost ? Math.round(rows.reduce((s, r) => s + (r.value ?? 0), 0) * 100) / 100 : null,
      belowMinimum: active.filter((r) => r.belowMinimum).length,
      missing: rows.reduce((s, r) => s + r.missing, 0),
      waitingReservations: waiting,
      pendingReturns,
    },
  };
}

export interface StockMovementRow {
  id: string;
  createdAt: string;
  itemId: string;
  itemName: string;
  type: StockMovementType;
  quantity: number;
  delta?: number;
  unitCost: number | null;
  onHandAfter: number;
  reservedAfter: number;
  serials?: string[];
  contractId?: string;
  contractNumber?: string;
  clientId?: string;
  clientName?: string;
  document?: string;
  supplier?: string;
  reason?: string;
  automatic?: boolean;
  createdByName?: string;
}

export const MOVEMENTS_LIMIT = 300;

export async function listStockMovements(options: { itemId?: string; type?: StockMovementType; showCost: boolean }): Promise<StockMovementRow[]> {
  const where: WhereClause[] = [];
  if (options.itemId) where.push(["itemId", "==", options.itemId]);
  if (options.type) where.push(["type", "==", options.type]);
  const rows = await list<StockMovement>(COLLECTIONS.stockMovements, { where, orderBy: ["createdAt", "desc"], limit: MOVEMENTS_LIMIT });
  return rows.map((m) => ({
    id: m.id,
    createdAt: m.createdAt,
    itemId: m.itemId,
    itemName: m.itemName,
    type: m.type,
    quantity: m.quantity,
    delta: m.delta,
    unitCost: options.showCost ? (m.unitCost ?? null) : null,
    onHandAfter: m.onHandAfter,
    reservedAfter: m.reservedAfter,
    serials: m.serials,
    contractId: m.contractId,
    contractNumber: m.contractNumber,
    clientId: m.clientId,
    clientName: m.clientName,
    document: m.document,
    supplier: m.supplier,
    reason: m.reason,
    automatic: m.automatic,
    createdByName: m.createdByName,
  }));
}

export interface StockReservationRow {
  id: string;
  createdAt: string;
  itemId: string;
  itemName: string;
  serialControlled: boolean;
  unit: string;
  contractId: string;
  contractNumber: string;
  clientId: string;
  clientName: string;
  origin: StockOrigin;
  quantity: number;
  reserved: number;
  delivered: number;
  returned: number;
  missing: number;
  pendingReturn: number;
  state: ReservationState;
  source: "contrato" | "manual";
  cancelReason?: string;
  /** Saldo do item agora (para o botão "Separar" e o diálogo de saída). */
  itemAvailable: number;
  itemOnHand: number;
  itemReserved: number;
}

export async function listStockReservations(filter: { contractId?: string } = {}): Promise<StockReservationRow[]> {
  const reservations = await list<StockReservation>(COLLECTIONS.stockReservations, filter.contractId ? { where: [["contractId", "==", filter.contractId]] } : {});
  if (!reservations.length) return [];
  const items = await list<StockItem>(COLLECTIONS.stockItems);
  const byId = new Map(items.map((i) => [i.id, i]));
  const rank: Record<ReservationState, number> = { devolucao_pendente: 0, aguardando: 1, parcial: 2, separada: 3, atendida: 4, cancelada: 5 };
  return reservations
    .map((r) => {
      const item = byId.get(r.itemId);
      return {
        id: r.id,
        createdAt: r.createdAt,
        itemId: r.itemId,
        itemName: item?.name ?? r.itemName,
        serialControlled: Boolean(item?.serialControlled),
        unit: item?.unit || "un",
        contractId: r.contractId,
        contractNumber: r.contractNumber,
        clientId: r.clientId,
        clientName: r.clientName,
        origin: r.origin,
        quantity: r.quantity,
        reserved: r.reserved || 0,
        delivered: r.delivered || 0,
        returned: r.returned || 0,
        missing: r.status === "ativa" ? reservationMissing(r) : 0,
        pendingReturn: reservationPendingReturn(r),
        state: reservationState(r),
        source: r.source,
        cancelReason: r.cancelReason,
        itemAvailable: item ? availableOf(item) : 0,
        itemOnHand: item?.onHand ?? 0,
        itemReserved: item?.reserved ?? 0,
      };
    })
    .sort((a, b) => rank[a.state] - rank[b.state] || a.createdAt.localeCompare(b.createdAt));
}

export interface StockSerialRow {
  id: string;
  itemId: string;
  itemName: string;
  serial: string;
  status: StockSerialStatus;
  contractId?: string;
  contractNumber?: string;
  clientId?: string;
  clientName?: string;
  enteredAt: string;
  deliveredAt?: string;
  writeOffReason?: string;
}

export async function listStockSerials(options: { itemId?: string; status?: StockSerialStatus; q?: string }): Promise<StockSerialRow[]> {
  const where: WhereClause[] = [];
  if (options.itemId) where.push(["itemId", "==", options.itemId]);
  if (options.status) where.push(["status", "==", options.status]);
  const q = options.q?.trim().toUpperCase();
  const rows = await list<StockSerial>(COLLECTIONS.stockSerials, { where });
  return rows
    .filter((s) => !q || s.serial.includes(q) || (s.clientName ?? "").toUpperCase().includes(q) || (s.contractNumber ?? "").toUpperCase().includes(q))
    .map((s) => ({
      id: s.id,
      itemId: s.itemId,
      itemName: s.itemName,
      serial: s.serial,
      status: s.status,
      contractId: s.contractId,
      contractNumber: s.contractNumber,
      clientId: s.clientId,
      clientName: s.clientName,
      enteredAt: s.enteredAt,
      deliveredAt: s.deliveredAt,
      writeOffReason: s.writeOffReason,
    }))
    .sort((a, b) => a.itemName.localeCompare(b.itemName, "pt-BR") || a.serial.localeCompare(b.serial));
}

/** Séries de um item numa situação (para escolher na saída/devolução/ajuste). */
export async function listItemSerials(itemId: string, status: StockSerialStatus, reservationId?: string): Promise<string[]> {
  const rows = await list<StockSerial>(COLLECTIONS.stockSerials, { where: [["itemId", "==", itemId], ["status", "==", status]] });
  return rows
    .filter((s) => !reservationId || s.reservationId === reservationId)
    .map((s) => s.serial)
    .sort();
}

export interface LinkableProduct {
  id: string;
  name: string;
  active: boolean;
  hasHardware: boolean;
}

export async function listLinkableProducts(): Promise<LinkableProduct[]> {
  const products = await list<Product>(COLLECTIONS.products);
  return products
    .map((p) => ({ id: p.id, name: p.name, active: p.active, hasHardware: (p.hardwarePrice || 0) > 0 }))
    .sort((a, b) => Number(b.active) - Number(a.active) || Number(b.hasHardware) - Number(a.hasHardware) || a.name.localeCompare(b.name, "pt-BR"));
}

/** Reservas de um contrato (cartão no contrato). */
export async function listContractReservations(contractId: string): Promise<StockReservationRow[]> {
  return listStockReservations({ contractId });
}
