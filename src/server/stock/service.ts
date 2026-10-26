import "server-only";
/**
 * Estoque de equipamentos — serviço (regras puras em `src/domain/stock.ts`).
 *
 * Toda movimentação acontece numa TRANSAÇÃO que lê o item (e a reserva/os números de série envolvidos), aplica a regra
 * (`applyStockMove`: nada fica negativo, ninguém usa unidade reservada para outro contrato) e grava, juntos, o saldo
 * novo do item e o registro em `stock_movements` com o saldo depois dele. Duas pessoas movimentando o mesmo item ao
 * mesmo tempo: a segunda espera a primeira e enxerga o saldo já atualizado.
 *
 * - Entrada (com custo) recalcula o custo médio e, em seguida, separa as unidades para as reservas que estavam
 *   esperando (mais antigas primeiro) — inclusive as de itens "sob demanda" que aguardavam a compra.
 * - Reserva por contrato (`reserveForContract`, chamada quando o contrato é assinado): uma reserva por item e contrato
 *   (id determinístico: repetir não duplica), quantidade pela origem do item; a falta é apontada e avisada.
 * - Cancelamento do contrato (`releaseContractReservations`): o separado volta ao disponível; o que já saiu fica como
 *   "devolução pendente" até a devolução ser registrada.
 * - Saída e devolução por número de série quando o item exige série: cada série sabe com que cliente/contrato está.
 * - Aviso de mínimo: quando o disponível fica abaixo do mínimo, o responsável (departamento configurável, padrão
 *   Administrativo) recebe UM aviso; volta a avisar só depois que o disponível se recupera.
 * Quem chama confere permissão (actions).
 */
import { BusinessError } from "@/server/auth/error-classes";
import { docdb, FieldValue, type DocumentReference, type Transaction } from "@/server/docdb";
import { col, getById, getManyByIds, list, newId, nowIso, ORG_ID, txGetOwn } from "@/server/db";
import { emitEvent } from "@/server/events";
import { writeSetting } from "@/server/conversations/ops-settings";
import { cleanPatch } from "@/server/commissions/store";
import { notify } from "@/server/notifications";
import { DEPARTMENT_KEYS, type DepartmentKey } from "@/domain/constants";
import {
  STOCK_ORIGINS,
  STOCK_SETTING_KEY,
  StockRuleError,
  allocateReservation,
  applyStockMove,
  availableOf,
  contractStockDemand,
  fillPendingReservations,
  isBelowMinimum,
  isValidQuantity,
  normalizeStockSettings,
  parseSerials,
  reservationDocId,
  reservationMissing,
  serialDocId,
  type StockBalance,
  type StockMove,
  type StockOrigin,
  type StockProductLink,
  type StockSettings,
} from "@/domain/stock";
import {
  COLLECTIONS,
  type Client,
  type Contract,
  type ContractStatus,
  type Department,
  type Product,
  type Settings,
  type StockItem,
  type StockMovement,
  type StockReservation,
  type User,
  type UserRef,
} from "@/domain/types";
import { formatCurrency } from "@/lib/format";

/** Contrato nestes status já foi assinado e não foi cancelado: pode ter equipamento reservado. */
export const SIGNED_CONTRACT_STATUSES: readonly ContractStatus[] = ["assinado", "aguardando_pagamento", "pago", "pendencia", "liberado"];

const MAX_SERIALS = 500;

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

async function readStockSetting(): Promise<Settings | null> {
  return (await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", STOCK_SETTING_KEY]] }))[0] ?? null;
}

export async function getStockSettings(): Promise<StockSettings> {
  const doc = await readStockSetting();
  const s = normalizeStockSettings(doc?.value ?? null);
  return DEPARTMENT_KEYS.includes(s.responsibleDepartment) ? s : { ...s, responsibleDepartment: "administrativo" };
}

export async function saveStockSettings(input: Omit<StockSettings, "stored">, actor: UserRef): Promise<StockSettings> {
  if (!DEPARTMENT_KEYS.includes(input.responsibleDepartment)) throw new BusinessError("Departamento inválido");
  const before = await getStockSettings();
  const value = { responsibleDepartment: input.responsibleDepartment, reserveOnSign: input.reserveOnSign, notifyLowStock: input.notifyLowStock };
  await writeSetting(STOCK_SETTING_KEY, value, "Estoque: departamento responsável, reserva na assinatura do contrato e aviso de estoque mínimo");
  const changed = (Object.keys(value) as (keyof typeof value)[]).filter((k) => before[k] !== value[k]);
  if (changed.length > 0 || !before.stored) {
    await emitEvent({
      type: "stock.settings_updated",
      actor,
      entity: { type: "setting", id: STOCK_SETTING_KEY },
      title: "Configuração do estoque alterada",
      description: changed.length ? `Campos: ${changed.join(", ")}` : "Configuração salva pela primeira vez",
      department: value.responsibleDepartment,
      payload: { changes: Object.fromEntries(changed.map((k) => [k, { from: before[k], to: value[k] }])) },
      timeline: false,
    });
  }
  return { ...value, stored: true };
}

/** Quem recebe os avisos do estoque: gestor do departamento responsável; sem gestor, o departamento; sem ninguém, a diretoria/admin. */
export async function stockResponsibleUserIds(department: DepartmentKey): Promise<string[]> {
  const departments = await list<Department>(COLLECTIONS.departments, { where: [["key", "==", department]] });
  const managerId = departments[0]?.managerId;
  if (managerId) {
    const manager = await getById<User>(COLLECTIONS.users, managerId);
    if (manager && manager.active !== false) return [manager.id];
  }
  const users = await list<User>(COLLECTIONS.users, { where: [["departmentId", "==", department]] });
  const active = users.filter((u) => u.active !== false).map((u) => u.id);
  if (active.length) return active;
  const all = await list<User>(COLLECTIONS.users);
  return all.filter((u) => u.active !== false && (u.role === "admin" || u.role === "diretoria")).map((u) => u.id);
}

// ---------------------------------------------------------------------------
// Itens
// ---------------------------------------------------------------------------

export interface StockItemInput {
  id?: string;
  name: string;
  sku?: string;
  manufacturer?: string;
  model?: string;
  unit?: string;
  serialControlled: boolean;
  origin: StockOrigin;
  minQuantity: number;
  products: { productId: string; units: number }[];
  location?: string;
  notes?: string;
  active: boolean;
}

const trimOrUndef = (v: string | undefined, max: number) => v?.trim().slice(0, max) || undefined;

export async function saveStockItem(input: StockItemInput, actor: UserRef): Promise<StockItem> {
  const name = input.name.trim().slice(0, 120);
  if (name.length < 2) throw new BusinessError("Informe o nome do item");
  if (!STOCK_ORIGINS.includes(input.origin)) throw new BusinessError("Origem inválida");
  const minQuantity = Math.floor(Number(input.minQuantity) || 0);
  if (minQuantity < 0 || minQuantity > 1_000_000) throw new BusinessError("Estoque mínimo inválido");
  const sku = trimOrUndef(input.sku, 60)?.toUpperCase();

  // Produtos vinculados: existentes, sem repetir.
  const seen = new Set<string>();
  const wanted = input.products.filter((p) => p.productId && !seen.has(p.productId) && seen.add(p.productId));
  const productMap = await getManyByIds<Product>(
    COLLECTIONS.products,
    wanted.map((p) => p.productId),
  );
  const products: StockProductLink[] = wanted.map((p) => {
    const product = productMap.get(p.productId);
    if (!product) throw new BusinessError("Produto vinculado não encontrado");
    const units = Math.floor(Number(p.units) || 1);
    if (units < 1 || units > 1000) throw new BusinessError(`Unidades por ${product.name}: informe de 1 a 1000`);
    return { productId: product.id, productName: product.name, units };
  });

  const all = await list<StockItem>(COLLECTIONS.stockItems);
  if (sku && all.some((i) => i.id !== input.id && i.sku === sku)) throw new BusinessError(`O código ${sku} já é de outro item`);
  if (all.some((i) => i.id !== input.id && i.active && i.name.localeCompare(name, "pt-BR", { sensitivity: "base" }) === 0))
    throw new BusinessError(`Já existe um item ativo chamado "${name}"`);

  const now = nowIso();
  const fields = {
    name,
    sku,
    manufacturer: trimOrUndef(input.manufacturer, 80),
    model: trimOrUndef(input.model, 80),
    unit: trimOrUndef(input.unit, 10) ?? "un",
    serialControlled: Boolean(input.serialControlled),
    origin: input.origin,
    minQuantity,
    products,
    location: trimOrUndef(input.location, 80),
    notes: trimOrUndef(input.notes, 500),
    active: Boolean(input.active),
  };

  if (!input.id) {
    const id = newId(COLLECTIONS.stockItems);
    const doc: Omit<StockItem, "id"> = {
      ...fields,
      onHand: 0,
      reserved: 0,
      avgCost: 0,
      organizationId: ORG_ID,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.id,
    };
    await col(COLLECTIONS.stockItems).doc(id).create(cleanPatch(doc as unknown as Record<string, unknown>));
    await emitEvent({
      type: "stock.item_created",
      actor,
      entity: { type: "stock_item", id },
      title: `Item de estoque cadastrado: ${name}`,
      description: [fields.manufacturer, fields.model, fields.serialControlled ? "com número de série" : null, products.length ? `usado em ${products.map((p) => p.productName).join(", ")}` : null]
        .filter(Boolean)
        .join(" · "),
      payload: { itemId: id, ...fields },
      timeline: false,
    });
    return { ...doc, id } as StockItem;
  }

  const id = input.id;
  const before = await docdb.runTransaction(async (tx) => {
    const ref = col(COLLECTIONS.stockItems).doc(id);
    const snap = await txGetOwn(tx, ref);
    if (!snap) throw new BusinessError("Item não encontrado");
    const current = { ...(snap.data() as Omit<StockItem, "id">), id } as StockItem;
    if (current.serialControlled !== fields.serialControlled && (current.onHand > 0 || current.reserved > 0)) {
      throw new BusinessError("Só dá para mudar o controle por número de série com o item zerado (sem saldo nem reservas)");
    }
    if (!fields.active && current.reserved > 0) throw new BusinessError(`Há ${current.reserved} unidade(s) reservada(s): libere as reservas antes de desativar`);
    tx.update(
      ref,
      cleanPatch({
        ...fields,
        sku: fields.sku ?? FieldValue.delete(),
        manufacturer: fields.manufacturer ?? FieldValue.delete(),
        model: fields.model ?? FieldValue.delete(),
        location: fields.location ?? FieldValue.delete(),
        notes: fields.notes ?? FieldValue.delete(),
        updatedAt: now,
      }),
    );
    return current;
  });
  const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(fields[k] ?? null));
  if (changed.length) {
    await emitEvent({
      type: "stock.item_updated",
      actor,
      entity: { type: "stock_item", id },
      title: `Item de estoque alterado: ${name}`,
      description: `Campos: ${changed.join(", ")}`,
      payload: { itemId: id, changes: Object.fromEntries(changed.map((k) => [k, { from: before[k] ?? null, to: fields[k] ?? null }])) },
      timeline: false,
    });
  }
  return { ...before, ...fields, updatedAt: now };
}

// ---------------------------------------------------------------------------
// Núcleo das movimentações
// ---------------------------------------------------------------------------

const itemRef = (id: string) => col(COLLECTIONS.stockItems).doc(id);

function asItem(id: string, data: unknown): StockItem {
  return { ...(data as Omit<StockItem, "id">), id } as StockItem;
}

async function readItemTx(tx: Transaction, itemId: string): Promise<StockItem> {
  const snap = await txGetOwn(tx, itemRef(itemId));
  if (!snap) throw new BusinessError("Item de estoque não encontrado");
  return asItem(itemId, snap.data());
}

function applyOrBusiness(balance: StockBalance, move: StockMove): StockBalance {
  try {
    return applyStockMove(balance, move);
  } catch (error) {
    if (error instanceof StockRuleError) throw new BusinessError(error.message);
    throw error;
  }
}

const meta = (now: string) => ({ organizationId: ORG_ID, createdAt: now, updatedAt: now });

/** Grava o registro da movimentação (dentro da transação). */
function writeMovement(tx: Transaction, data: Omit<StockMovement, "id" | "organizationId" | "createdAt" | "updatedAt">, now: string): string {
  const id = newId(COLLECTIONS.stockMovements);
  tx.create(col(COLLECTIONS.stockMovements).doc(id), cleanPatch({ ...data, ...meta(now) }));
  return id;
}

/**
 * Patch do saldo do item + marca do aviso de mínimo. `alert` = o disponível acabou de ficar abaixo do mínimo e o aviso
 * ainda não tinha sido dado (quem chama avisa depois da transação).
 */
function balancePatch(item: StockItem, next: StockBalance, now: string, notifyLow: boolean): { patch: Record<string, unknown>; alert: boolean } {
  const below = isBelowMinimum(next, item.minQuantity);
  const alert = below && notifyLow && item.active && !item.lowStockAlertAt;
  const patch: Record<string, unknown> = { onHand: next.onHand, reserved: next.reserved, avgCost: next.avgCost, updatedAt: now };
  if (alert) patch.lowStockAlertAt = now;
  else if (!below && item.lowStockAlertAt) patch.lowStockAlertAt = FieldValue.delete();
  return { patch, alert };
}

async function sendLowStockAlert(item: StockItem, next: StockBalance, settings: StockSettings, actor: UserRef): Promise<void> {
  const available = availableOf(next);
  const event = await emitEvent({
    type: "stock.low",
    actor,
    entity: { type: "stock_item", id: item.id },
    title: `Estoque abaixo do mínimo: ${item.name}`,
    description: `Disponível ${available} · mínimo ${item.minQuantity} · em estoque ${next.onHand} · reservado ${next.reserved}`,
    department: settings.responsibleDepartment,
    payload: { itemId: item.id, available, minQuantity: item.minQuantity, onHand: next.onHand, reserved: next.reserved },
    timeline: false,
  });
  const userIds = await stockResponsibleUserIds(settings.responsibleDepartment);
  await notify({
    userIds,
    kind: "atencao",
    title: `Estoque abaixo do mínimo: ${item.name}`,
    body: `Disponível ${available} (mínimo ${item.minQuantity}). Providencie a reposição.`,
    href: `/estoque?item=${item.id}`,
    entity: { type: "stock_item", id: item.id },
    eventId: event.id,
  });
}

function checkSerialCount(item: StockItem, quantity: number, serials: string[], verb: string): void {
  if (!item.serialControlled) {
    if (serials.length) throw new BusinessError(`${item.name} não é controlado por número de série`);
    return;
  }
  if (serials.length !== quantity) throw new BusinessError(`${item.name} exige número de série: informe ${quantity} série(s) para ${verb} (recebi ${serials.length})`);
}

function cleanSerials(raw: string[] | undefined): string[] {
  const { serials, duplicates } = parseSerials(raw ?? []);
  if (duplicates.length) throw new BusinessError(`Número de série repetido: ${duplicates.slice(0, 5).join(", ")}`);
  if (serials.length > MAX_SERIALS) throw new BusinessError(`No máximo ${MAX_SERIALS} números de série por vez`);
  return serials;
}

function serialRefs(itemId: string, serials: string[]): DocumentReference[] {
  return serials.map((s) => col(COLLECTIONS.stockSerials).doc(serialDocId(itemId, s)));
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export interface EntryInput {
  itemId: string;
  quantity: number;
  unitCost: number;
  serials?: string[];
  document?: string;
  supplier?: string;
  notes?: string;
}

export interface EntryResult {
  movementId: string;
  balance: StockBalance;
  /** Reservas que receberam unidades desta entrada. */
  filled: { reservationId: string; contractNumber: string; clientName: string; add: number }[];
}

export async function registerEntry(input: EntryInput, actor: UserRef): Promise<EntryResult> {
  if (!isValidQuantity(input.quantity)) throw new BusinessError("Informe a quantidade (número inteiro maior que zero)");
  const unitCost = Math.round((Number(input.unitCost) || 0) * 100) / 100;
  if (!(unitCost >= 0) || unitCost > 10_000_000) throw new BusinessError("Custo unitário inválido");
  const serials = cleanSerials(input.serials);
  const settings = await getStockSettings();
  const now = nowIso();
  const result = await docdb.runTransaction(async (tx) => {
    const item = await readItemTx(tx, input.itemId);
    if (!item.active) throw new BusinessError("Item desativado: reative antes de dar entrada");
    checkSerialCount(item, input.quantity, serials, "a entrada");
    const serialSnaps = serials.length ? await tx.getAll(...serialRefs(item.id, serials)) : [];
    const taken = serialSnaps.filter((s) => s.exists && s.get("organizationId") === ORG_ID && s.get("status") !== "baixado").map((s) => String(s.get("serial")));
    if (taken.length) throw new BusinessError(`Número de série já cadastrado neste item: ${taken.slice(0, 5).join(", ")}`);
    const pendingSnap = await tx.get(col(COLLECTIONS.stockReservations).where("itemId", "==", item.id).where("status", "==", "ativa"));
    const pending = pendingSnap.docs
      .filter((d) => d.get("organizationId") === ORG_ID)
      .map((d) => ({ ...(d.data() as Omit<StockReservation, "id">), id: d.id }) as StockReservation);

    let balance = applyOrBusiness(item, { type: "entrada", quantity: input.quantity, unitCost });
    const movementId = writeMovement(
      tx,
      {
        itemId: item.id,
        itemName: item.name,
        type: "entrada",
        quantity: input.quantity,
        unitCost,
        onHandAfter: balance.onHand,
        reservedAfter: balance.reserved,
        avgCostAfter: balance.avgCost,
        serials: serials.length ? serials : undefined,
        document: trimOrUndef(input.document, 80),
        supplier: trimOrUndef(input.supplier, 120),
        reason: trimOrUndef(input.notes, 500),
        createdBy: actor.id,
        createdByName: actor.name,
      },
      now,
    );
    for (const s of serials) {
      tx.set(
        col(COLLECTIONS.stockSerials).doc(serialDocId(item.id, s)),
        cleanPatch({ itemId: item.id, itemName: item.name, serial: s, status: "em_estoque", unitCost, enteredAt: now, ...meta(now) }),
      );
    }
    // Reservas esperando: recebem o que chegou (mais antigas primeiro).
    const fills = fillPendingReservations(pending, Math.min(input.quantity, availableOf(balance)));
    const filled: EntryResult["filled"] = [];
    for (const f of fills) {
      const r = pending.find((x) => x.id === f.id)!;
      balance = applyOrBusiness(balance, { type: "reserva", quantity: f.add });
      tx.update(col(COLLECTIONS.stockReservations).doc(r.id), { reserved: (r.reserved || 0) + f.add, updatedAt: now });
      writeMovement(
        tx,
        {
          itemId: item.id,
          itemName: item.name,
          type: "reserva",
          quantity: f.add,
          onHandAfter: balance.onHand,
          reservedAfter: balance.reserved,
          avgCostAfter: balance.avgCost,
          reservationId: r.id,
          contractId: r.contractId,
          contractNumber: r.contractNumber,
          clientId: r.clientId,
          clientName: r.clientName,
          reason: "Separado da entrada para a reserva que aguardava estoque",
          automatic: true,
          createdBy: actor.id,
          createdByName: actor.name,
        },
        now,
      );
      filled.push({ reservationId: r.id, contractNumber: r.contractNumber, clientName: r.clientName, add: f.add });
    }
    const { patch, alert } = balancePatch(item, balance, now, settings.notifyLowStock);
    tx.update(itemRef(item.id), patch);
    return { item, balance, movementId, filled, alert };
  });

  await emitEvent({
    type: "stock.entry",
    actor,
    entity: { type: "stock_item", id: result.item.id },
    title: `Entrada de ${input.quantity} ${result.item.unit} · ${result.item.name}`,
    description: [
      `custo ${formatCurrency(unitCost)} cada`,
      `custo médio ${formatCurrency(result.balance.avgCost)}`,
      input.document ? `doc. ${input.document.trim()}` : null,
      input.supplier ? `fornecedor ${input.supplier.trim()}` : null,
      result.filled.length ? `separado para ${result.filled.map((f) => `${f.contractNumber} (${f.add})`).join(", ")}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    department: settings.responsibleDepartment,
    payload: { itemId: result.item.id, movementId: result.movementId, quantity: input.quantity, unitCost, serials, balance: result.balance, filled: result.filled },
    timeline: false,
  });
  for (const f of result.filled) {
    const r = await getById<StockReservation>(COLLECTIONS.stockReservations, f.reservationId);
    if (!r) continue;
    await emitEvent({
      type: "stock.reserved",
      actor,
      clientId: r.clientId,
      entity: { type: "contract", id: r.contractId },
      title: `${f.add} ${result.item.unit} de ${result.item.name} separado(s) para o contrato ${r.contractNumber}`,
      description: reservationMissing(r) > 0 ? `Ainda faltam ${reservationMissing(r)}` : "Reserva completa: pronto para a entrega",
      department: settings.responsibleDepartment,
      payload: { itemId: result.item.id, reservationId: r.id, contractId: r.contractId, quantity: f.add, automatic: true },
    });
  }
  if (result.alert) await sendLowStockAlert(result.item, result.balance, settings, actor);
  return { movementId: result.movementId, balance: result.balance, filled: result.filled };
}

// ---------------------------------------------------------------------------
// Reserva por contrato
// ---------------------------------------------------------------------------

export interface ContractReservationSummary {
  contractId: string;
  created: { itemId: string; itemName: string; quantity: number; reserved: number; missing: number; toPurchase: boolean }[];
  skipped: number;
}

/**
 * Reserva os equipamentos do contrato (itens de estoque vinculados aos produtos do contrato). Idempotente: item que já
 * tem reserva para o contrato não é tocado. Contrato não assinado ou cancelado não reserva.
 */
export async function reserveForContract(contractId: string, actor: UserRef, options: { source?: "contrato" | "manual" } = {}): Promise<ContractReservationSummary> {
  const contract = await getById<Contract>(COLLECTIONS.contracts, contractId);
  if (!contract) throw new BusinessError("Contrato não encontrado");
  if (!SIGNED_CONTRACT_STATUSES.includes(contract.status)) {
    throw new BusinessError(contract.status === "cancelado" ? "Contrato cancelado não reserva equipamento" : "O contrato ainda não foi assinado");
  }
  const [client, items, settings] = await Promise.all([getById<Client>(COLLECTIONS.clients, contract.clientId), list<StockItem>(COLLECTIONS.stockItems), getStockSettings()]);
  const demand = contractStockDemand(contract.items ?? [], items);
  const summary: ContractReservationSummary = { contractId, created: [], skipped: 0 };
  const clientName = client?.tradeName ?? client?.legalName ?? "Cliente";
  const now = nowIso();

  for (const [itemId, quantity] of demand) {
    const resId = reservationDocId(contract.id, itemId);
    const out = await docdb.runTransaction(async (tx) => {
      const resRef = col(COLLECTIONS.stockReservations).doc(resId);
      // Item primeiro (trava a linha): duas assinaturas simultâneas do mesmo contrato ficam em fila e a segunda já vê
      // a reserva criada pela primeira.
      const item = await readItemTx(tx, itemId);
      const existing = await tx.get(resRef);
      if (existing.exists) {
        // Reserva liberada antes (botão Liberar) e sem nada com o cliente: o contrato continua assinado, então reserva de
        // novo no mesmo documento. Com algo a devolver (ou ativa/atendida), não mexe.
        const prev = existing.data() as unknown as StockReservation;
        const outstanding = (prev.delivered || 0) - (prev.returned || 0);
        if (prev.status !== "cancelada" || outstanding > 0) return null;
      }
      const alloc = allocateReservation(item.origin, quantity, availableOf(item));
      const balance = alloc.reserve > 0 ? applyOrBusiness(item, { type: "reserva", quantity: alloc.reserve }) : { onHand: item.onHand, reserved: item.reserved, avgCost: item.avgCost };
      const reservation: Omit<StockReservation, "id"> = {
        itemId: item.id,
        itemName: item.name,
        contractId: contract.id,
        contractNumber: contract.number,
        clientId: contract.clientId,
        clientName,
        origin: item.origin,
        quantity,
        reserved: alloc.reserve,
        delivered: 0,
        status: "ativa",
        source: options.source ?? "contrato",
        createdBy: actor.id,
        createdByName: actor.name,
        ...meta(now),
      };
      tx.set(resRef, cleanPatch(reservation as unknown as Record<string, unknown>));
      if (alloc.reserve > 0) {
        writeMovement(
          tx,
          {
            itemId: item.id,
            itemName: item.name,
            type: "reserva",
            quantity: alloc.reserve,
            onHandAfter: balance.onHand,
            reservedAfter: balance.reserved,
            avgCostAfter: balance.avgCost,
            reservationId: resId,
            contractId: contract.id,
            contractNumber: contract.number,
            clientId: contract.clientId,
            clientName,
            reason: options.source === "manual" ? "Reserva pelo contrato (manual)" : "Contrato assinado",
            automatic: options.source !== "manual",
            createdBy: actor.id,
            createdByName: actor.name,
          },
          now,
        );
      }
      const { patch, alert } = balancePatch(item, balance, now, settings.notifyLowStock);
      if (alloc.reserve > 0 || patch.lowStockAlertAt !== undefined) tx.update(itemRef(item.id), patch);
      return { item, balance, alloc, alert };
    });
    if (!out) {
      summary.skipped += 1;
      continue;
    }
    summary.created.push({ itemId, itemName: out.item.name, quantity, reserved: out.alloc.reserve, missing: out.alloc.missing, toPurchase: out.alloc.toPurchase });
    if (out.alert) await sendLowStockAlert(out.item, out.balance, settings, actor);
  }

  if (summary.created.length) {
    const missing = summary.created.filter((c) => c.missing > 0);
    const event = await emitEvent({
      type: "stock.reserved",
      actor,
      clientId: contract.clientId,
      entity: { type: "contract", id: contract.id },
      title: `Equipamentos reservados para o contrato ${contract.number}`,
      description: summary.created
        .map((c) => `${c.itemName}: ${c.reserved}/${c.quantity}${c.missing ? ` (falta ${c.missing}${c.toPurchase ? ", comprar" : ""})` : ""}`)
        .join(" · "),
      department: settings.responsibleDepartment,
      payload: { contractId: contract.id, items: summary.created },
    });
    if (missing.length) {
      const userIds = await stockResponsibleUserIds(settings.responsibleDepartment);
      await notify({
        userIds,
        kind: "acao",
        title: `Falta equipamento para o contrato ${contract.number}`,
        body: `${clientName}: ${missing.map((m) => `${m.missing} × ${m.itemName}${m.toPurchase ? " (comprar)" : ""}`).join(", ")}.`,
        href: "/estoque?aba=reservas",
        entity: { type: "contract", id: contract.id },
        eventId: event.id,
        key: `stock_missing_${contract.id}`,
      });
    }
  }
  return summary;
}

/** Handler de contract.signed: reserva se a configuração mandar. Erros não derrubam a assinatura (o motor isola). */
export async function onContractSignedStock(contractId: string, actor: UserRef): Promise<void> {
  const settings = await getStockSettings();
  if (!settings.reserveOnSign) return;
  const contract = await getById<Contract>(COLLECTIONS.contracts, contractId);
  if (!contract || !SIGNED_CONTRACT_STATUSES.includes(contract.status)) return;
  await reserveForContract(contractId, actor, { source: "contrato" });
}

// ---------------------------------------------------------------------------
// Liberar / cancelar reservas
// ---------------------------------------------------------------------------

/**
 * Ordem das travas em toda transação do estoque: ITEM primeiro, depois reserva/séries — duas operações simultâneas
 * nunca se bloqueiam em ordem inversa. Quem só conhece a reserva lê o item dela antes (fora da transação) e confere.
 */
async function lockReservationTx(tx: Transaction, reservationId: string, itemId: string): Promise<{ item: StockItem; r: StockReservation }> {
  const item = await readItemTx(tx, itemId);
  const snap = await txGetOwn(tx, col(COLLECTIONS.stockReservations).doc(reservationId));
  if (!snap) throw new BusinessError("Reserva não encontrada");
  const r = { ...(snap.data() as Omit<StockReservation, "id">), id: reservationId } as StockReservation;
  if (r.itemId !== itemId) throw new BusinessError("A reserva é de outro item");
  return { item, r };
}

async function reservationItemId(reservationId: string): Promise<string> {
  const r = await getById<StockReservation>(COLLECTIONS.stockReservations, reservationId);
  if (!r) throw new BusinessError("Reserva não encontrada");
  return r.itemId;
}

/**
 * Libera uma reserva (trava item → reserva). Modo "manual" (botão Liberar, contrato valendo): o separado volta ao
 * disponível; se algo já foi entregue, o cliente fica com isso e a reserva fecha como atendida (sem devolução). Modo
 * "contrato" (contrato cancelado): ativa ou atendida vira cancelada e o que está com o cliente fica como devolução
 * pendente. Devolve null quando não há o que liberar.
 */
async function releaseReservationTx(reservationId: string, itemId: string, reason: string, actor: UserRef, settings: StockSettings, now: string, mode: "manual" | "contrato") {
  return docdb.runTransaction(async (tx) => {
    const ref = col(COLLECTIONS.stockReservations).doc(reservationId);
    const { item, r } = await lockReservationTx(tx, reservationId, itemId);
    const releasable = r.status === "ativa" || (mode === "contrato" && r.status === "atendida");
    if (!releasable) return null;
    const release = r.status === "ativa" ? Math.min(r.reserved || 0, item.reserved || 0) : 0;
    const balance = release > 0 ? applyOrBusiness(item, { type: "liberacao", quantity: release }) : { onHand: item.onHand, reserved: item.reserved, avgCost: item.avgCost };
    const keepDelivered = mode === "manual" && (r.delivered || 0) > 0;
    tx.update(
      ref,
      cleanPatch(
        keepDelivered
          ? { status: "atendida", reserved: 0, quantity: r.delivered, cancelReason: reason.slice(0, 500), updatedAt: now }
          : { status: "cancelada", reserved: 0, cancelledAt: now, cancelReason: reason.slice(0, 500), updatedAt: now },
      ),
    );
    let alert = false;
    if (release > 0) {
      writeMovement(
        tx,
        {
          itemId: item.id,
          itemName: item.name,
          type: "liberacao",
          quantity: release,
          onHandAfter: balance.onHand,
          reservedAfter: balance.reserved,
          avgCostAfter: balance.avgCost,
          reservationId: r.id,
          contractId: r.contractId,
          contractNumber: r.contractNumber,
          clientId: r.clientId,
          clientName: r.clientName,
          reason,
          createdBy: actor.id,
          createdByName: actor.name,
        },
        now,
      );
      const bp = balancePatch(item, balance, now, settings.notifyLowStock);
      alert = bp.alert;
      tx.update(itemRef(item.id), bp.patch);
    }
    const pendingReturn = keepDelivered ? 0 : Math.max(0, (r.delivered || 0) - (r.returned || 0));
    return { r, item, release, pendingReturn, keptDelivered: keepDelivered ? r.delivered : 0, balance, alert };
  });
}

/**
 * Libera uma reserva com o contrato valendo (cliente desistiu do item, troca de modelo, urgência de outro contrato): o
 * separado volta ao disponível; o que já foi entregue fica com o cliente. Dá para reservar de novo pelo contrato.
 */
export async function releaseReservation(reservationId: string, reason: string, actor: UserRef): Promise<void> {
  const text = reason.trim();
  if (text.length < 5) throw new BusinessError("Explique o motivo (mínimo 5 caracteres)");
  const settings = await getStockSettings();
  const out = await releaseReservationTx(reservationId, await reservationItemId(reservationId), text, actor, settings, nowIso(), "manual");
  if (!out) throw new BusinessError("Esta reserva não está ativa");
  await emitEvent({
    type: "stock.reservation_released",
    actor,
    clientId: out.r.clientId,
    entity: { type: "contract", id: out.r.contractId },
    title: `Reserva de ${out.item.name} liberada · contrato ${out.r.contractNumber}`,
    description: `${text}${out.release ? ` · ${out.release} volta(m) ao disponível` : ""}${out.keptDelivered ? ` · ${out.keptDelivered} já entregue(s) ficam com o cliente` : ""}`,
    department: settings.responsibleDepartment,
    payload: { reservationId, itemId: out.item.id, contractId: out.r.contractId, released: out.release, keptDelivered: out.keptDelivered, reason: text },
  });
  if (out.alert) await sendLowStockAlert(out.item, out.balance, settings, actor);
}

/**
 * Handler de contract.cancelled: cada reserva ativa ou atendida do contrato vira cancelada numa transação própria (a
 * situação é lida travada): o separado volta ao disponível e o que está com o cliente fica como devolução pendente.
 */
export async function releaseContractReservations(contractId: string, reason: string, actor: UserRef): Promise<{ released: number; pendingReturn: number }> {
  const reservations = await list<StockReservation>(COLLECTIONS.stockReservations, { where: [["contractId", "==", contractId]] });
  const open = reservations.filter((r) => r.status === "ativa" || r.status === "atendida");
  if (!open.length) return { released: 0, pendingReturn: 0 };
  const settings = await getStockSettings();
  const now = nowIso();
  let released = 0;
  let pendingReturn = 0;
  const lines: string[] = [];
  for (const r of open) {
    const out = await releaseReservationTx(r.id, r.itemId, reason, actor, settings, now, "contrato");
    if (!out) continue;
    released += out.release;
    pendingReturn += out.pendingReturn;
    if (out.release || out.pendingReturn) lines.push(`${out.item.name}: ${out.release ? `${out.release} liberada(s)` : ""}${out.release && out.pendingReturn ? ", " : ""}${out.pendingReturn ? `${out.pendingReturn} a devolver` : ""}`);
    if (out.alert) await sendLowStockAlert(out.item, out.balance, settings, actor);
  }
  if (!lines.length) return { released, pendingReturn };
  const first = reservations[0];
  const event = await emitEvent({
    type: "stock.reservation_released",
    actor,
    clientId: first.clientId,
    entity: { type: "contract", id: contractId },
    title: `Equipamentos do contrato ${first.contractNumber} liberados (contrato cancelado)`,
    description: lines.join(" · "),
    department: settings.responsibleDepartment,
    payload: { contractId, released, pendingReturn, reason },
  });
  if (pendingReturn > 0) {
    const userIds = await stockResponsibleUserIds(settings.responsibleDepartment);
    await notify({
      userIds,
      kind: "acao",
      title: `Recolher equipamento: contrato ${first.contractNumber} cancelado`,
      body: `${first.clientName}: ${pendingReturn} unidade(s) estão com o cliente. Registre a devolução quando voltarem.`,
      href: "/estoque?aba=reservas",
      entity: { type: "contract", id: contractId },
      eventId: event.id,
      key: `stock_return_${contractId}`,
    });
  }
  return { released, pendingReturn };
}

/** Separa do disponível o que falta numa reserva ativa (ex.: estoque que já existia num item sob demanda). */
export async function fillReservation(reservationId: string, actor: UserRef): Promise<number> {
  const settings = await getStockSettings();
  const now = nowIso();
  const itemId = await reservationItemId(reservationId);
  const out = await docdb.runTransaction(async (tx) => {
    const ref = col(COLLECTIONS.stockReservations).doc(reservationId);
    const { item, r } = await lockReservationTx(tx, reservationId, itemId);
    if (r.status !== "ativa") throw new BusinessError("Esta reserva não está ativa");
    const add = Math.min(reservationMissing(r), availableOf(item));
    if (add <= 0) throw new BusinessError(reservationMissing(r) <= 0 ? "Nada falta nesta reserva" : `Não há ${item.name} disponível`);
    const balance = applyOrBusiness(item, { type: "reserva", quantity: add });
    tx.update(ref, { reserved: (r.reserved || 0) + add, updatedAt: now });
    writeMovement(
      tx,
      {
        itemId: item.id,
        itemName: item.name,
        type: "reserva",
        quantity: add,
        onHandAfter: balance.onHand,
        reservedAfter: balance.reserved,
        avgCostAfter: balance.avgCost,
        reservationId: r.id,
        contractId: r.contractId,
        contractNumber: r.contractNumber,
        clientId: r.clientId,
        clientName: r.clientName,
        reason: "Separado do disponível",
        createdBy: actor.id,
        createdByName: actor.name,
      },
      now,
    );
    const { patch, alert } = balancePatch(item, balance, now, settings.notifyLowStock);
    tx.update(itemRef(item.id), patch);
    return { r, item, add, balance, alert };
  });
  await emitEvent({
    type: "stock.reserved",
    actor,
    clientId: out.r.clientId,
    entity: { type: "contract", id: out.r.contractId },
    title: `${out.add} ${out.item.unit} de ${out.item.name} separado(s) para o contrato ${out.r.contractNumber}`,
    description: reservationMissing({ ...out.r, reserved: out.r.reserved + out.add }) > 0 ? "Reserva ainda incompleta" : "Reserva completa: pronto para a entrega",
    department: settings.responsibleDepartment,
    payload: { itemId: out.item.id, reservationId, contractId: out.r.contractId, quantity: out.add },
  });
  if (out.alert) await sendLowStockAlert(out.item, out.balance, settings, actor);
  return out.add;
}

/** Reserva manual pelo número do contrato (contratos assinados antes do item existir, ou com a reserva automática desligada). */
export async function reserveByContractNumber(contractNumber: string, actor: UserRef): Promise<ContractReservationSummary> {
  const number = contractNumber.trim().toUpperCase();
  const found = (await list<Contract>(COLLECTIONS.contracts, { where: [["number", "==", number]] })).sort((a, b) => b.version - a.version);
  const contract = found.find((c) => c.status !== "cancelado") ?? found[0];
  if (!contract) throw new BusinessError(`Contrato ${number} não encontrado`);
  const summary = await reserveForContract(contract.id, actor, { source: "manual" });
  if (!summary.created.length) {
    throw new BusinessError(summary.skipped ? "Os equipamentos deste contrato já estão reservados" : "Nenhum produto deste contrato está vinculado a um item de estoque");
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Saída, devolução e ajuste
// ---------------------------------------------------------------------------

export interface ExitInput {
  itemId: string;
  quantity: number;
  /** Saída para a entrega de uma reserva (contrato). Sem reserva, o motivo é obrigatório. */
  reservationId?: string;
  serials?: string[];
  reason?: string;
  document?: string;
}

export async function registerExit(input: ExitInput, actor: UserRef): Promise<{ movementId: string; balance: StockBalance }> {
  if (!isValidQuantity(input.quantity)) throw new BusinessError("Informe a quantidade (número inteiro maior que zero)");
  const serials = cleanSerials(input.serials);
  const reason = input.reason?.trim() ?? "";
  if (!input.reservationId && reason.length < 5) throw new BusinessError("Saída sem contrato: explique o motivo (mínimo 5 caracteres)");
  const settings = await getStockSettings();
  const now = nowIso();
  const out = await docdb.runTransaction(async (tx) => {
    const item = await readItemTx(tx, input.itemId);
    checkSerialCount(item, input.quantity, serials, "a saída");
    const serialSnaps = serials.length ? await tx.getAll(...serialRefs(item.id, serials)) : [];
    let reservation: StockReservation | null = null;
    if (input.reservationId) {
      const snap = await txGetOwn(tx, col(COLLECTIONS.stockReservations).doc(input.reservationId));
      if (!snap) throw new BusinessError("Reserva não encontrada");
      reservation = { ...(snap.data() as Omit<StockReservation, "id">), id: input.reservationId } as StockReservation;
      if (reservation.itemId !== input.itemId) throw new BusinessError("A reserva é de outro item");
      if (reservation.status !== "ativa") throw new BusinessError("Esta reserva não está ativa");
    }
    const notHere = serials.filter((s, i) => !serialSnaps[i]?.exists || serialSnaps[i].get("organizationId") !== ORG_ID || serialSnaps[i].get("status") !== "em_estoque");
    if (notHere.length) throw new BusinessError(`Número de série que não está em estoque: ${notHere.slice(0, 5).join(", ")}`);

    let fromReserved = 0;
    if (reservation) {
      const pending = (reservation.quantity || 0) - (reservation.delivered || 0);
      if (input.quantity > pending) throw new BusinessError(`Este contrato só tem ${pending} unidade(s) a entregar`);
      fromReserved = Math.min(input.quantity, reservation.reserved || 0);
    }
    const balance = applyOrBusiness(item, { type: "saida", quantity: input.quantity, fromReserved });
    const movementId = writeMovement(
      tx,
      {
        itemId: item.id,
        itemName: item.name,
        type: "saida",
        quantity: input.quantity,
        unitCost: item.avgCost,
        onHandAfter: balance.onHand,
        reservedAfter: balance.reserved,
        avgCostAfter: balance.avgCost,
        serials: serials.length ? serials : undefined,
        reservationId: reservation?.id,
        contractId: reservation?.contractId,
        contractNumber: reservation?.contractNumber,
        clientId: reservation?.clientId,
        clientName: reservation?.clientName,
        document: trimOrUndef(input.document, 80),
        reason: reason || undefined,
        createdBy: actor.id,
        createdByName: actor.name,
      },
      now,
    );
    serialRefs(item.id, serials).forEach((ref) =>
      tx.update(
        ref,
        cleanPatch({
          status: "entregue",
          deliveredAt: now,
          contractId: reservation?.contractId ?? FieldValue.delete(),
          contractNumber: reservation?.contractNumber ?? FieldValue.delete(),
          clientId: reservation?.clientId ?? FieldValue.delete(),
          clientName: reservation?.clientName ?? FieldValue.delete(),
          reservationId: reservation?.id ?? FieldValue.delete(),
          updatedAt: now,
        }),
      ),
    );
    if (reservation) {
      const delivered = (reservation.delivered || 0) + input.quantity;
      tx.update(
        col(COLLECTIONS.stockReservations).doc(reservation.id),
        cleanPatch({ delivered, reserved: (reservation.reserved || 0) - fromReserved, status: delivered >= reservation.quantity ? "atendida" : "ativa", updatedAt: now }),
      );
    }
    const { patch, alert } = balancePatch(item, balance, now, settings.notifyLowStock);
    tx.update(itemRef(item.id), patch);
    return { item, balance, movementId, reservation, alert };
  });
  await emitEvent({
    type: "stock.exit",
    actor,
    clientId: out.reservation?.clientId,
    entity: out.reservation ? { type: "contract", id: out.reservation.contractId } : { type: "stock_item", id: out.item.id },
    title: `Saída de ${input.quantity} ${out.item.unit} · ${out.item.name}${out.reservation ? ` · contrato ${out.reservation.contractNumber}` : ""}`,
    description: [serials.length ? `séries ${serials.join(", ")}` : null, reason || null, `restam ${out.balance.onHand} em estoque`].filter(Boolean).join(" · "),
    department: settings.responsibleDepartment,
    payload: { itemId: out.item.id, movementId: out.movementId, quantity: input.quantity, serials, reservationId: out.reservation?.id ?? null, contractId: out.reservation?.contractId ?? null, reason: reason || null },
  });
  if (out.alert) await sendLowStockAlert(out.item, out.balance, settings, actor);
  return { movementId: out.movementId, balance: out.balance };
}

export interface ReturnInput {
  itemId: string;
  quantity: number;
  reservationId?: string;
  serials?: string[];
  reason: string;
}

/**
 * Devolução ao estoque (equipamento que voltou do cliente). Com reserva de contrato cancelado, abate a devolução
 * pendente; com reserva ativa (troca), a unidade volta e o contrato passa a precisar dela de novo.
 */
export async function registerReturn(input: ReturnInput, actor: UserRef): Promise<{ movementId: string; balance: StockBalance }> {
  if (!isValidQuantity(input.quantity)) throw new BusinessError("Informe a quantidade (número inteiro maior que zero)");
  const serials = cleanSerials(input.serials);
  const reason = input.reason.trim();
  if (reason.length < 5) throw new BusinessError("Explique a devolução (mínimo 5 caracteres)");
  const settings = await getStockSettings();
  const now = nowIso();
  const out = await docdb.runTransaction(async (tx) => {
    const item = await readItemTx(tx, input.itemId);
    checkSerialCount(item, input.quantity, serials, "a devolução");
    const serialSnaps = serials.length ? await tx.getAll(...serialRefs(item.id, serials)) : [];
    const notOut = serials.filter((s, i) => !serialSnaps[i]?.exists || serialSnaps[i].get("organizationId") !== ORG_ID || serialSnaps[i].get("status") !== "entregue");
    if (notOut.length) throw new BusinessError(`Número de série que não está com cliente: ${notOut.slice(0, 5).join(", ")}`);
    // Sem reserva informada, as séries dizem por qual contrato saíram (todas pelo mesmo).
    let reservationId = input.reservationId;
    if (!reservationId && serials.length) {
      const ids = new Set(serialSnaps.map((s) => (s.get("reservationId") as string | undefined) ?? ""));
      if (ids.size > 1) throw new BusinessError("Estas séries saíram por contratos diferentes: devolva cada contrato separadamente");
      reservationId = [...ids][0] || undefined;
    }
    let reservation: StockReservation | null = null;
    if (reservationId) {
      const snap = await txGetOwn(tx, col(COLLECTIONS.stockReservations).doc(reservationId));
      if (!snap) throw new BusinessError("Reserva não encontrada");
      reservation = { ...(snap.data() as Omit<StockReservation, "id">), id: reservationId } as StockReservation;
      if (reservation.itemId !== input.itemId) throw new BusinessError("A reserva é de outro item");
    }
    if (reservation) {
      const wrong = serials.filter((s, i) => serialSnaps[i].get("reservationId") !== reservation!.id);
      if (wrong.length) throw new BusinessError(`Número de série que não saiu por este contrato: ${wrong.slice(0, 5).join(", ")}`);
      const outstanding = (reservation.delivered || 0) - (reservation.returned || 0);
      if (input.quantity > outstanding) throw new BusinessError(`Só ${Math.max(0, outstanding)} unidade(s) deste contrato estão com o cliente`);
    }
    const balance = applyOrBusiness(item, { type: "devolucao", quantity: input.quantity });
    const movementId = writeMovement(
      tx,
      {
        itemId: item.id,
        itemName: item.name,
        type: "devolucao",
        quantity: input.quantity,
        unitCost: item.avgCost,
        onHandAfter: balance.onHand,
        reservedAfter: balance.reserved,
        avgCostAfter: balance.avgCost,
        serials: serials.length ? serials : undefined,
        reservationId: reservation?.id,
        contractId: reservation?.contractId,
        contractNumber: reservation?.contractNumber,
        clientId: reservation?.clientId,
        clientName: reservation?.clientName,
        reason,
        createdBy: actor.id,
        createdByName: actor.name,
      },
      now,
    );
    serialRefs(item.id, serials).forEach((ref) =>
      tx.update(
        ref,
        cleanPatch({
          status: "em_estoque",
          returnedAt: now,
          contractId: FieldValue.delete(),
          contractNumber: FieldValue.delete(),
          clientId: FieldValue.delete(),
          clientName: FieldValue.delete(),
          reservationId: FieldValue.delete(),
          updatedAt: now,
        }),
      ),
    );
    if (reservation) {
      if (reservation.status === "cancelada") {
        tx.update(col(COLLECTIONS.stockReservations).doc(reservation.id), { returned: (reservation.returned || 0) + input.quantity, updatedAt: now });
      } else {
        // Troca/defeito com o contrato valendo: a unidade volta e o contrato precisa dela de novo.
        tx.update(col(COLLECTIONS.stockReservations).doc(reservation.id), { delivered: (reservation.delivered || 0) - input.quantity, status: "ativa", updatedAt: now });
      }
    }
    const { patch, alert } = balancePatch(item, balance, now, settings.notifyLowStock);
    tx.update(itemRef(item.id), patch);
    return { item, balance, movementId, reservation, alert };
  });
  await emitEvent({
    type: "stock.returned",
    actor,
    clientId: out.reservation?.clientId,
    entity: out.reservation ? { type: "contract", id: out.reservation.contractId } : { type: "stock_item", id: out.item.id },
    title: `Devolução de ${input.quantity} ${out.item.unit} · ${out.item.name}${out.reservation ? ` · contrato ${out.reservation.contractNumber}` : ""}`,
    description: [serials.length ? `séries ${serials.join(", ")}` : null, reason].filter(Boolean).join(" · "),
    department: settings.responsibleDepartment,
    payload: { itemId: out.item.id, movementId: out.movementId, quantity: input.quantity, serials, reservationId: out.reservation?.id ?? null, reason },
  });
  if (out.alert) await sendLowStockAlert(out.item, out.balance, settings, actor);
  return { movementId: out.movementId, balance: out.balance };
}

export interface AdjustInput {
  itemId: string;
  /** + entrou (achado no inventário), − saiu (perda, avaria, baixa). */
  delta: number;
  reason: string;
  serials?: string[];
}

export async function adjustStock(input: AdjustInput, actor: UserRef): Promise<{ movementId: string; balance: StockBalance }> {
  const delta = Number(input.delta);
  if (!Number.isInteger(delta) || delta === 0) throw new BusinessError("Informe quantas unidades entram (+) ou saem (−)");
  const reason = input.reason.trim();
  if (reason.length < 5) throw new BusinessError("Explique o ajuste (mínimo 5 caracteres)");
  const serials = cleanSerials(input.serials);
  const settings = await getStockSettings();
  const now = nowIso();
  const out = await docdb.runTransaction(async (tx) => {
    const item = await readItemTx(tx, input.itemId);
    checkSerialCount(item, Math.abs(delta), serials, "o ajuste");
    const serialSnaps = serials.length ? await tx.getAll(...serialRefs(item.id, serials)) : [];
    if (delta > 0) {
      const taken = serials.filter((s, i) => serialSnaps[i]?.exists && serialSnaps[i].get("organizationId") === ORG_ID && serialSnaps[i].get("status") !== "baixado");
      if (taken.length) throw new BusinessError(`Número de série já cadastrado neste item: ${taken.slice(0, 5).join(", ")}`);
    } else {
      const notHere = serials.filter((s, i) => !serialSnaps[i]?.exists || serialSnaps[i].get("organizationId") !== ORG_ID || serialSnaps[i].get("status") !== "em_estoque");
      if (notHere.length) throw new BusinessError(`Número de série que não está em estoque: ${notHere.slice(0, 5).join(", ")}`);
    }
    const balance = applyOrBusiness(item, { type: "ajuste", delta });
    const movementId = writeMovement(
      tx,
      {
        itemId: item.id,
        itemName: item.name,
        type: "ajuste",
        quantity: Math.abs(delta),
        delta,
        unitCost: item.avgCost,
        onHandAfter: balance.onHand,
        reservedAfter: balance.reserved,
        avgCostAfter: balance.avgCost,
        serials: serials.length ? serials : undefined,
        reason,
        createdBy: actor.id,
        createdByName: actor.name,
      },
      now,
    );
    for (const s of serials) {
      const ref = col(COLLECTIONS.stockSerials).doc(serialDocId(item.id, s));
      if (delta > 0) {
        tx.set(ref, cleanPatch({ itemId: item.id, itemName: item.name, serial: s, status: "em_estoque", unitCost: item.avgCost, enteredAt: now, ...meta(now) }));
      } else {
        tx.update(ref, cleanPatch({ status: "baixado", writtenOffAt: now, writeOffReason: reason.slice(0, 300), updatedAt: now }));
      }
    }
    const { patch, alert } = balancePatch(item, balance, now, settings.notifyLowStock);
    tx.update(itemRef(item.id), patch);
    return { item, balance, movementId, alert };
  });
  await emitEvent({
    type: "stock.adjusted",
    actor,
    entity: { type: "stock_item", id: out.item.id },
    title: `Ajuste de ${delta > 0 ? "+" : ""}${delta} ${out.item.unit} · ${out.item.name}`,
    description: [reason, serials.length ? `séries ${serials.join(", ")}` : null, `agora ${out.balance.onHand} em estoque`].filter(Boolean).join(" · "),
    department: settings.responsibleDepartment,
    payload: { itemId: out.item.id, movementId: out.movementId, delta, serials, reason, changes: { onHand: { from: out.item.onHand, to: out.balance.onHand } } },
    timeline: false,
  });
  if (out.alert) await sendLowStockAlert(out.item, out.balance, settings, actor);
  return { movementId: out.movementId, balance: out.balance };
}

