import "server-only";
/**
 * Compras — serviço (regras puras em `src/domain/purchases.ts`).
 *
 * - Necessidades (`listPurchaseNeeds`): por item de estoque, a falta das reservas de contratos + o mínimo, menos o
 *   disponível e o que já está pedido. Vira pedido com um clique (`createPurchaseOrder`).
 * - Pedido: rascunho → enviar (`submitPurchaseOrder`): sem aprovação configurada, ou valor até o limite, já fica
 *   aprovado; acima do limite espera a diretoria ou o gestor do Administrativo (`approve`/`reject`; devolvido volta a
 *   rascunho com o motivo).
 * - Recebimento (`receivePurchaseOrder`): reserva as quantidades no pedido numa transação (dois recebimentos ao mesmo
 *   tempo não passam do pedido), dá entrada no estoque linha a linha (custo médio, séries e reservas que esperavam) e
 *   cria o título em Contas a Pagar (fornecedor, categoria e prazo da configuração). Linha que falha volta para "a
 *   receber"; falha no título fica registrada no recebimento para refazer.
 * Quem chama confere permissão (actions).
 */
import { BusinessError } from "@/server/auth/error-classes";
import { docdb } from "@/server/docdb";
import { col, getById, getManyByIds, list, newId, nextNumber, nowIso, ORG_ID, txGetOwn } from "@/server/db";
import { emitEvent } from "@/server/events";
import { writeSetting } from "@/server/conversations/ops-settings";
import { cleanPatch } from "@/server/commissions/store";
import { notify } from "@/server/notifications";
import { getDepartmentManager } from "@/server/workflow/service";
import { createManualPayable, getPayablesSettings } from "@/server/commissions/payables";
import { registerEntry } from "@/server/stock/service";
import {
  OPEN_PURCHASE_STATUSES,
  PURCHASE_SETTING_KEY,
  lineRemaining,
  needsApproval,
  normalizePurchaseSettings,
  orderTotal,
  payableDueDate,
  purchaseNeed,
  statusAfterReceipt,
  type NeedRow,
  type PurchaseLine,
  type PurchaseSettings,
  type PurchaseStatus,
} from "@/domain/purchases";
import { parseSerials, reservationMissing, serialDocId } from "@/domain/stock";
import {
  COLLECTIONS,
  type PurchaseHistoryEntry,
  type PurchaseOrder,
  type PurchaseReceipt,
  type PurchaseReceiptLine,
  type Settings,
  type StockItem,
  type StockReservation,
  type StockSerial,
  type Supplier,
  type User,
  type UserRef,
} from "@/domain/types";
import { dateKey, formatCurrency } from "@/lib/format";

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export async function getPurchaseSettings(): Promise<PurchaseSettings> {
  const doc = (await list<Settings>(COLLECTIONS.settings, { where: [["key", "==", PURCHASE_SETTING_KEY]] }))[0];
  return normalizePurchaseSettings(doc?.value ?? null);
}

export async function savePurchaseSettings(input: Omit<PurchaseSettings, "stored">, actor: UserRef): Promise<PurchaseSettings> {
  const payables = await getPayablesSettings();
  if (!payables.categorias.includes(input.payableCategory)) throw new BusinessError(`Categoria "${input.payableCategory}" não está em Configurações › Contas a pagar`);
  const before = await getPurchaseSettings();
  const next = normalizePurchaseSettings({ ...input });
  const { stored: _s, ...value } = next;
  void _s;
  await writeSetting(PURCHASE_SETTING_KEY, value, "Compras: aprovação acima de um valor, categoria e prazo do título a pagar gerado no recebimento");
  const changed = (Object.keys(value) as (keyof typeof value)[]).filter((k) => before[k] !== value[k]);
  if (changed.length > 0 || !before.stored) {
    await emitEvent({
      type: "purchase.settings_updated",
      actor,
      entity: { type: "setting", id: PURCHASE_SETTING_KEY },
      title: "Configuração de compras alterada",
      description: changed.length ? `Campos: ${changed.join(", ")}` : "Configuração salva pela primeira vez",
      department: "administrativo",
      payload: { changes: Object.fromEntries(changed.map((k) => [k, { from: before[k], to: value[k] }])) },
      timeline: false,
    });
  }
  return { ...value, stored: true };
}

// ---------------------------------------------------------------------------
// Necessidades
// ---------------------------------------------------------------------------

export interface PurchaseNeedRow extends NeedRow {
  unit: string;
  avgCost: number;
  /** Contratos com falta deste item. */
  contracts: { contractId: string; contractNumber: string; clientName: string; missing: number }[];
}

export async function listPurchaseNeeds(): Promise<PurchaseNeedRow[]> {
  const [items, reservations, orders] = await Promise.all([
    list<StockItem>(COLLECTIONS.stockItems),
    list<StockReservation>(COLLECTIONS.stockReservations, { where: [["status", "==", "ativa"]] }),
    list<PurchaseOrder>(COLLECTIONS.purchaseOrders, { where: [["status", "in", [...OPEN_PURCHASE_STATUSES]]] }),
  ]);
  const ordered = new Map<string, number>();
  for (const o of orders) for (const l of o.lines) ordered.set(l.itemId, (ordered.get(l.itemId) ?? 0) + lineRemaining(l));
  const byItem = new Map<string, PurchaseNeedRow["contracts"]>();
  for (const r of reservations) {
    const m = reservationMissing(r);
    if (m <= 0) continue;
    const arr = byItem.get(r.itemId) ?? [];
    arr.push({ contractId: r.contractId, contractNumber: r.contractNumber, clientName: r.clientName, missing: m });
    byItem.set(r.itemId, arr);
  }
  return items
    .filter((i) => i.active !== false)
    .map((i) => {
      const contracts = byItem.get(i.id) ?? [];
      return {
        ...purchaseNeed({
          itemId: i.id,
          name: i.name,
          active: i.active !== false,
          onHand: i.onHand || 0,
          reserved: i.reserved || 0,
          minQuantity: i.minQuantity || 0,
          missing: contracts.reduce((s, c) => s + c.missing, 0),
          ordered: ordered.get(i.id) ?? 0,
        }),
        unit: i.unit || "un",
        avgCost: i.avgCost || 0,
        contracts,
      };
    })
    .sort((a, b) => b.suggested - a.suggested || a.name.localeCompare(b.name, "pt-BR"));
}

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------

export interface PurchaseOrderInput {
  supplierId?: string;
  supplierName?: string;
  lines: { itemId: string; quantity: number; unitCost: number }[];
  expectedAt?: string;
  paymentDays?: number;
  installments?: number;
  notes?: string;
}

const historyOf = (actor: UserRef, action: string, extra: Partial<PurchaseHistoryEntry> = {}, at = nowIso()): PurchaseHistoryEntry =>
  cleanPatch({ at, by: actor.id, byName: actor.name, action, ...extra }) as unknown as PurchaseHistoryEntry;

async function normalizeOrderInput(input: PurchaseOrderInput, settings: PurchaseSettings, keepReceived?: Map<string, number>) {
  let supplierId: string | undefined;
  let supplierName = input.supplierName?.trim().slice(0, 120) ?? "";
  if (input.supplierId) {
    const supplier = await getById<Supplier>(COLLECTIONS.suppliers, input.supplierId);
    if (!supplier) throw new BusinessError("Fornecedor não encontrado");
    if (supplier.active === false) throw new BusinessError(`O fornecedor ${supplier.name} está inativo`);
    supplierId = supplier.id;
    supplierName = supplier.name;
  }
  if (supplierName.length < 2) throw new BusinessError("Escolha o fornecedor");
  if (!input.lines.length) throw new BusinessError("Inclua ao menos um item");
  const seen = new Set<string>();
  for (const l of input.lines) {
    if (seen.has(l.itemId)) throw new BusinessError("O mesmo item aparece duas vezes no pedido: junte as quantidades");
    seen.add(l.itemId);
  }
  const items = await getManyByIds<StockItem>(
    COLLECTIONS.stockItems,
    input.lines.map((l) => l.itemId),
  );
  const lines: PurchaseLine[] = input.lines.map((l) => {
    const item = items.get(l.itemId);
    if (!item) throw new BusinessError("Item de estoque não encontrado");
    if (item.active === false) throw new BusinessError(`${item.name} está desativado no estoque`);
    const quantity = Math.floor(Number(l.quantity) || 0);
    if (quantity < 1 || quantity > 1_000_000) throw new BusinessError(`Quantidade inválida em ${item.name}`);
    const unitCost = Math.round((Number(l.unitCost) || 0) * 100) / 100;
    if (!(unitCost >= 0) || unitCost > 10_000_000) throw new BusinessError(`Custo inválido em ${item.name}`);
    return { itemId: item.id, itemName: item.name, quantity, unitCost, received: keepReceived?.get(item.id) ?? 0 };
  });
  const paymentDays = Math.floor(Number(input.paymentDays ?? settings.paymentDays));
  if (!(paymentDays >= 0 && paymentDays <= 365)) throw new BusinessError("Prazo de pagamento: de 0 a 365 dias");
  const installments = Math.floor(Number(input.installments ?? 1));
  if (!(installments >= 1 && installments <= 24)) throw new BusinessError("Parcelas: de 1 a 24");
  const expectedAt = input.expectedAt && /^\d{4}-\d{2}-\d{2}$/.test(input.expectedAt) ? input.expectedAt : undefined;
  return { supplierId, supplierName, lines, total: orderTotal(lines), paymentDays, installments, expectedAt, notes: input.notes?.trim().slice(0, 1000) || undefined };
}

export async function createPurchaseOrder(input: PurchaseOrderInput, actor: UserRef): Promise<PurchaseOrder> {
  const settings = await getPurchaseSettings();
  const data = await normalizeOrderInput(input, settings);
  const now = nowIso();
  const number = await nextNumber("PC", { pad: 4, initFrom: { collection: COLLECTIONS.purchaseOrders } });
  const id = newId(COLLECTIONS.purchaseOrders);
  const order: Omit<PurchaseOrder, "id"> = {
    ...data,
    number,
    status: "rascunho",
    history: [historyOf(actor, "Pedido criado", { to: "rascunho" }, now)],
    createdBy: actor.id,
    createdByName: actor.name,
    organizationId: ORG_ID,
    createdAt: now,
    updatedAt: now,
  };
  await col(COLLECTIONS.purchaseOrders).doc(id).create(cleanPatch(order as unknown as Record<string, unknown>));
  await emitEvent({
    type: "purchase.order_created",
    actor,
    entity: { type: "purchase_order", id },
    title: `Pedido de compra ${number} criado`,
    description: `${data.supplierName} · ${data.lines.map((l) => `${l.quantity} × ${l.itemName}`).join(", ")} · ${formatCurrency(data.total)}`,
    department: "administrativo",
    payload: { orderId: id, number, supplierId: data.supplierId ?? null, total: data.total, lines: data.lines },
    timeline: false,
  });
  return { ...order, id };
}

/** Lê o pedido travado na transação. */
async function lockOrder(tx: Parameters<Parameters<typeof docdb.runTransaction>[0]>[0], id: string): Promise<PurchaseOrder> {
  const snap = await txGetOwn(tx, col(COLLECTIONS.purchaseOrders).doc(id));
  if (!snap) throw new BusinessError("Pedido não encontrado");
  return { ...(snap.data() as Omit<PurchaseOrder, "id">), id } as PurchaseOrder;
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrder | null> {
  return getById<PurchaseOrder>(COLLECTIONS.purchaseOrders, id);
}

/** Editar só no rascunho (inclui o devolvido pela aprovação). */
export async function updatePurchaseOrder(id: string, input: PurchaseOrderInput, actor: UserRef): Promise<PurchaseOrder> {
  const settings = await getPurchaseSettings();
  const data = await normalizeOrderInput(input, settings);
  const now = nowIso();
  const before = await docdb.runTransaction(async (tx) => {
    const order = await lockOrder(tx, id);
    if (order.status !== "rascunho") throw new BusinessError("Só dá para editar o pedido em rascunho");
    tx.update(col(COLLECTIONS.purchaseOrders).doc(id), cleanPatch({ ...data, history: [...order.history, historyOf(actor, "Pedido alterado", {}, now)], updatedAt: now }));
    return order;
  });
  await emitEvent({
    type: "purchase.order_updated",
    actor,
    entity: { type: "purchase_order", id },
    title: `Pedido de compra ${before.number} alterado`,
    description: `${data.supplierName} · ${formatCurrency(before.total)} → ${formatCurrency(data.total)}`,
    department: "administrativo",
    payload: { orderId: id, changes: { total: { from: before.total, to: data.total }, supplierName: { from: before.supplierName, to: data.supplierName } } },
    timeline: false,
  });
  return { ...before, ...data, updatedAt: now };
}

/** Quem aprova compras: diretoria/admin e o gestor do Administrativo. */
async function approverIds(): Promise<string[]> {
  const users = await list<User>(COLLECTIONS.users);
  const ids = users.filter((u) => u.active !== false && (u.role === "admin" || u.role === "diretoria")).map((u) => u.id);
  const manager = await getDepartmentManager("administrativo");
  if (manager) ids.push(manager.id);
  return Array.from(new Set(ids));
}

/** Enviar o rascunho: com aprovação exigida (valor acima do limite) espera; senão já fica aprovado. */
export async function submitPurchaseOrder(id: string, actor: UserRef): Promise<PurchaseStatus> {
  const settings = await getPurchaseSettings();
  const now = nowIso();
  const out = await docdb.runTransaction(async (tx) => {
    const order = await lockOrder(tx, id);
    if (order.status !== "rascunho") throw new BusinessError("Este pedido já foi enviado");
    const required = needsApproval(settings, order.total);
    const to: PurchaseStatus = required ? "aguardando_aprovacao" : "aprovado";
    tx.update(
      col(COLLECTIONS.purchaseOrders).doc(id),
      cleanPatch({
        status: to,
        approvalRequired: required,
        ...(required ? {} : { approvedBy: actor.id, approvedByName: actor.name, approvedAt: now }),
        history: [
          ...order.history,
          historyOf(actor, required ? `Enviado para aprovação (acima de ${formatCurrency(settings.approvalThreshold)})` : settings.approvalEnabled ? `Aprovado direto (até ${formatCurrency(settings.approvalThreshold)})` : "Aprovado (aprovação desligada)", { from: "rascunho", to }, now),
        ],
        updatedAt: now,
      }),
    );
    return { order, to, required };
  });
  const event = await emitEvent({
    type: out.required ? "purchase.order_submitted" : "purchase.order_approved",
    actor,
    entity: { type: "purchase_order", id },
    title: out.required ? `Pedido ${out.order.number} aguarda aprovação` : `Pedido ${out.order.number} aprovado`,
    description: `${out.order.supplierName} · ${formatCurrency(out.order.total)}${out.required ? "" : " · aprovação automática"}`,
    department: "administrativo",
    payload: { orderId: id, total: out.order.total, automatic: !out.required, changes: { status: { from: "rascunho", to: out.to } } },
    timeline: false,
  });
  if (out.required) {
    await notify({
      userIds: (await approverIds()).filter((u) => u !== actor.id),
      kind: "acao",
      title: `Aprovar compra ${out.order.number}: ${formatCurrency(out.order.total)}`,
      body: `${out.order.supplierName} · ${out.order.lines.map((l) => `${l.quantity} × ${l.itemName}`).join(", ")}. Pedido por ${actor.name}.`,
      href: `/compras?aba=pedidos&pedido=${id}`,
      entity: { type: "purchase_order", id },
      eventId: event.id,
      key: `purchase_approval_${id}_${out.order.history.length}`,
    });
  }
  return out.to;
}

export async function approvePurchaseOrder(id: string, actor: UserRef): Promise<void> {
  const now = nowIso();
  const order = await docdb.runTransaction(async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.status !== "aguardando_aprovacao") throw new BusinessError("Este pedido não está aguardando aprovação");
    tx.update(
      col(COLLECTIONS.purchaseOrders).doc(id),
      cleanPatch({ status: "aprovado", approvedBy: actor.id, approvedByName: actor.name, approvedAt: now, history: [...o.history, historyOf(actor, "Aprovado", { from: o.status, to: "aprovado" }, now)], updatedAt: now }),
    );
    return o;
  });
  const event = await emitEvent({
    type: "purchase.order_approved",
    actor,
    entity: { type: "purchase_order", id },
    title: `Pedido ${order.number} aprovado por ${actor.name}`,
    description: `${order.supplierName} · ${formatCurrency(order.total)}`,
    department: "administrativo",
    payload: { orderId: id, total: order.total, changes: { status: { from: "aguardando_aprovacao", to: "aprovado" } } },
    timeline: false,
  });
  await notify({
    userIds: [order.createdBy].filter((u) => u !== actor.id),
    kind: "informativa",
    title: `Compra ${order.number} aprovada`,
    body: `${actor.name} aprovou ${formatCurrency(order.total)} com ${order.supplierName}. Pode fazer o pedido ao fornecedor.`,
    href: `/compras?aba=pedidos&pedido=${id}`,
    entity: { type: "purchase_order", id },
    eventId: event.id,
  });
}

/** Devolver: volta a rascunho com o motivo (quem pediu ajusta e envia de novo). */
export async function rejectPurchaseOrder(id: string, reason: string, actor: UserRef): Promise<void> {
  const text = reason.trim();
  if (text.length < 5) throw new BusinessError("Explique o motivo (mínimo 5 caracteres)");
  const now = nowIso();
  const order = await docdb.runTransaction(async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.status !== "aguardando_aprovacao") throw new BusinessError("Este pedido não está aguardando aprovação");
    tx.update(
      col(COLLECTIONS.purchaseOrders).doc(id),
      cleanPatch({ status: "rascunho", rejectedReason: text.slice(0, 500), history: [...o.history, historyOf(actor, "Devolvido sem aprovação", { from: o.status, to: "rascunho", reason: text }, now)], updatedAt: now }),
    );
    return o;
  });
  const event = await emitEvent({
    type: "purchase.order_rejected",
    actor,
    entity: { type: "purchase_order", id },
    title: `Pedido ${order.number} devolvido`,
    description: text,
    department: "administrativo",
    payload: { orderId: id, reason: text, changes: { status: { from: "aguardando_aprovacao", to: "rascunho" } } },
    timeline: false,
  });
  await notify({
    userIds: [order.createdBy].filter((u) => u !== actor.id),
    kind: "atencao",
    title: `Compra ${order.number} devolvida`,
    body: `${actor.name}: ${text}`,
    href: `/compras?aba=pedidos&pedido=${id}`,
    entity: { type: "purchase_order", id },
    eventId: event.id,
  });
}

/** Cancelar (com motivo): o que já chegou fica; o restante deixa de ser esperado. */
export async function cancelPurchaseOrder(id: string, reason: string, actor: UserRef): Promise<void> {
  const text = reason.trim();
  if (text.length < 5) throw new BusinessError("Explique o motivo (mínimo 5 caracteres)");
  const now = nowIso();
  const order = await docdb.runTransaction(async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.status === "recebido" || o.status === "cancelado") throw new BusinessError(o.status === "recebido" ? "Pedido já recebido" : "Pedido já cancelado");
    tx.update(
      col(COLLECTIONS.purchaseOrders).doc(id),
      cleanPatch({ status: "cancelado", cancelledAt: now, cancelReason: text.slice(0, 500), history: [...o.history, historyOf(actor, "Cancelado", { from: o.status, to: "cancelado", reason: text }, now)], updatedAt: now }),
    );
    return o;
  });
  await emitEvent({
    type: "purchase.order_cancelled",
    actor,
    entity: { type: "purchase_order", id },
    title: `Pedido ${order.number} cancelado`,
    description: text,
    department: "administrativo",
    payload: { orderId: id, reason: text, changes: { status: { from: order.status, to: "cancelado" } } },
    timeline: false,
  });
}

// ---------------------------------------------------------------------------
// Recebimento
// ---------------------------------------------------------------------------

export interface ReceiveInput {
  receivedAt?: string;
  document?: string;
  lines: { itemId: string; quantity: number; unitCost?: number; serials?: string[] }[];
}

export interface ReceiveResult {
  receiptId: string;
  posted: number;
  failed: { itemName: string; error: string }[];
  payableCode?: string;
  payableError?: string;
  status: PurchaseStatus;
}

export async function receivePurchaseOrder(id: string, input: ReceiveInput, actor: UserRef): Promise<ReceiveResult> {
  const lines = input.lines.filter((l) => (Number(l.quantity) || 0) > 0);
  if (!lines.length) throw new BusinessError("Informe a quantidade recebida de ao menos um item");
  const receivedAt = input.receivedAt && /^\d{4}-\d{2}-\d{2}$/.test(input.receivedAt) ? input.receivedAt : dateKey(new Date());
  if (receivedAt > dateKey(new Date())) throw new BusinessError("A data de recebimento não pode ser futura");
  const document = input.document?.trim().slice(0, 80) || undefined;
  const settings = await getPurchaseSettings();
  const current = await getPurchaseOrder(id);
  if (!current) throw new BusinessError("Pedido não encontrado");
  if (current.status !== "aprovado" && current.status !== "parcial") {
    throw new BusinessError(current.status === "aguardando_aprovacao" || current.status === "rascunho" ? "O pedido ainda não foi aprovado" : "Este pedido não está aguardando recebimento");
  }

  // Pré-validação (antes de mexer em qualquer coisa): quantidades, séries obrigatórias e séries já cadastradas.
  const items = await getManyByIds<StockItem>(
    COLLECTIONS.stockItems,
    lines.map((l) => l.itemId),
  );
  const prepared: PurchaseReceiptLine[] = [];
  for (const l of lines) {
    const line = current.lines.find((x) => x.itemId === l.itemId);
    const item = items.get(l.itemId);
    if (!line || !item) throw new BusinessError("Item fora deste pedido");
    const quantity = Math.floor(Number(l.quantity));
    if (quantity > lineRemaining(line)) throw new BusinessError(`${line.itemName}: só faltam ${lineRemaining(line)} para receber`);
    const { serials, duplicates } = parseSerials(l.serials ?? []);
    if (duplicates.length) throw new BusinessError(`Número de série repetido: ${duplicates.slice(0, 5).join(", ")}`);
    if (item.serialControlled && serials.length !== quantity) throw new BusinessError(`${item.name} exige número de série: informe ${quantity} série(s)`);
    if (!item.serialControlled && serials.length) throw new BusinessError(`${item.name} não é controlado por número de série`);
    const unitCost = l.unitCost === undefined ? line.unitCost : Math.round(Number(l.unitCost) * 100) / 100;
    if (!(unitCost >= 0)) throw new BusinessError(`Custo inválido em ${line.itemName}`);
    prepared.push({ itemId: line.itemId, itemName: line.itemName, quantity, unitCost, serials: serials.length ? serials : undefined });
  }
  const serialIds = prepared.flatMap((p) => (p.serials ?? []).map((s) => serialDocId(p.itemId, s)));
  if (serialIds.length) {
    const existing = await getManyByIds<StockSerial>(COLLECTIONS.stockSerials, serialIds);
    const taken = [...existing.values()].filter((s) => s.status !== "baixado").map((s) => s.serial);
    if (taken.length) throw new BusinessError(`Número de série já cadastrado: ${taken.slice(0, 5).join(", ")}`);
  }

  // 1) Reserva as quantidades no pedido (transação): dois recebimentos simultâneos não passam do pedido.
  const now = nowIso();
  const receiptId = newId(COLLECTIONS.purchaseReceipts);
  const order = await docdb.runTransaction(async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.status !== "aprovado" && o.status !== "parcial") throw new BusinessError(o.status === "aguardando_aprovacao" || o.status === "rascunho" ? "O pedido ainda não foi aprovado" : "Este pedido não está aguardando recebimento");
    const next = o.lines.map((l) => ({ ...l }));
    for (const p of prepared) {
      const l = next.find((x) => x.itemId === p.itemId)!;
      if (p.quantity > lineRemaining(l)) throw new BusinessError(`${l.itemName}: só faltam ${lineRemaining(l)} para receber (outro recebimento acabou de entrar)`);
      l.received = (l.received || 0) + p.quantity;
    }
    const to = statusAfterReceipt(next);
    tx.update(col(COLLECTIONS.purchaseOrders).doc(id), cleanPatch({ lines: next, status: to, history: [...o.history, historyOf(actor, `Recebimento${document ? ` (NF ${document})` : ""}`, { from: o.status, to }, now)], updatedAt: now }));
    const receipt: Omit<PurchaseReceipt, "id"> = {
      orderId: id,
      orderNumber: o.number,
      supplierName: o.supplierName,
      receivedAt,
      document,
      lines: prepared,
      amount: orderTotal(prepared),
      status: "processando",
      createdBy: actor.id,
      createdByName: actor.name,
      ...{ organizationId: ORG_ID, createdAt: now, updatedAt: now },
    };
    tx.create(col(COLLECTIONS.purchaseReceipts).doc(receiptId), cleanPatch(receipt as unknown as Record<string, unknown>));
    return o;
  });

  // 2) Entrada no estoque, linha a linha (custo médio, séries, reservas que esperavam).
  const failed: ReceiveResult["failed"] = [];
  for (const p of prepared) {
    try {
      const r = await registerEntry(
        { itemId: p.itemId, quantity: p.quantity, unitCost: p.unitCost, serials: p.serials, document, supplier: order.supplierName, notes: `Compra ${order.number}`, purchaseOrderId: id, purchaseOrderNumber: order.number },
        actor,
      );
      p.movementId = r.movementId;
    } catch (error) {
      p.error = error instanceof Error ? error.message : "Falha na entrada";
      failed.push({ itemName: p.itemName, error: p.error });
    }
  }
  // Linha que falhou volta para "a receber".
  let status = statusAfterReceipt(order.lines);
  if (failed.length) {
    status = await docdb.runTransaction(async (tx) => {
      const o = await lockOrder(tx, id);
      const next = o.lines.map((l) => {
        const bad = prepared.find((p) => p.itemId === l.itemId && p.error);
        return bad ? { ...l, received: Math.max(0, (l.received || 0) - bad.quantity) } : l;
      });
      const to = o.status === "cancelado" ? o.status : statusAfterReceipt(next);
      tx.update(col(COLLECTIONS.purchaseOrders).doc(id), cleanPatch({ lines: next, status: to, updatedAt: nowIso() }));
      return to;
    });
  } else {
    status = (await getPurchaseOrder(id))?.status ?? status;
  }

  // 3) Título em Contas a Pagar pelo que entrou.
  const posted = prepared.filter((p) => p.movementId);
  const amount = orderTotal(posted);
  let payableId: string | undefined;
  let payableCode: string | undefined;
  let payableError: string | undefined;
  if (amount > 0) {
    try {
      const payable = await createManualPayable(
        {
          creditorType: "fornecedor",
          supplierId: order.supplierId,
          creditorName: order.supplierId ? undefined : order.supplierName,
          category: settings.payableCategory,
          description: `Compra ${order.number}${document ? ` · NF ${document}` : ""} · ${posted.map((p) => `${p.quantity} × ${p.itemName}`).join(", ")}`.slice(0, 300),
          amount,
          competence: receivedAt.slice(0, 7),
          dueDate: payableDueDate(receivedAt, order.paymentDays),
          installments: order.installments,
          notes: `Gerado pelo recebimento do pedido de compra ${order.number}.`,
        },
        actor,
      );
      payableId = payable.id;
      payableCode = payable.code;
    } catch (error) {
      payableError = error instanceof Error ? error.message : "Falha ao criar o título";
    }
  }
  await col(COLLECTIONS.purchaseReceipts)
    .doc(receiptId)
    .update(cleanPatch({ lines: prepared, amount, status: failed.length || payableError ? "com_erro" : "concluido", payableId, payableCode, payableError, updatedAt: nowIso() }));

  const event = await emitEvent({
    type: "purchase.received",
    actor,
    entity: { type: "purchase_order", id },
    title: `Compra ${order.number} recebida${failed.length ? " em parte" : ""}`,
    description: [
      posted.map((p) => `${p.quantity} × ${p.itemName}`).join(", ") || "nada entrou",
      document ? `NF ${document}` : null,
      amount > 0 ? `${formatCurrency(amount)}${payableCode ? ` · título ${payableCode}` : ""}` : null,
      failed.length ? `falhou: ${failed.map((f) => `${f.itemName} (${f.error})`).join("; ")}` : null,
      payableError ? `título não criado: ${payableError}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    department: "administrativo",
    payload: { orderId: id, receiptId, amount, payableId: payableId ?? null, failed, changes: { status: { from: order.status, to: status } } },
    timeline: false,
  });
  if (payableCode) {
    const fin = await getDepartmentManager("financeiro");
    if (fin) {
      await notify({
        userIds: [fin.id],
        kind: "informativa",
        title: `Título ${payableCode} criado pela compra ${order.number}`,
        body: `${order.supplierName} · ${formatCurrency(amount)}${order.installments > 1 ? ` em ${order.installments} parcelas` : ""} · vence ${payableDueDate(receivedAt, order.paymentDays).split("-").reverse().join("/")}.`,
        href: "/financeiro/contas-a-pagar",
        entity: { type: "purchase_order", id },
        eventId: event.id,
      });
    }
  }
  return { receiptId, posted: posted.length, failed, payableCode, payableError, status };
}

// ---------------------------------------------------------------------------
// Leituras da tela
// ---------------------------------------------------------------------------

export async function listPurchaseOrders(): Promise<PurchaseOrder[]> {
  const orders = await list<PurchaseOrder>(COLLECTIONS.purchaseOrders);
  const rank: Record<PurchaseStatus, number> = { aguardando_aprovacao: 0, rascunho: 1, aprovado: 2, parcial: 3, recebido: 4, cancelado: 5 };
  return orders.sort((a, b) => rank[a.status] - rank[b.status] || b.createdAt.localeCompare(a.createdAt));
}

export async function listPurchaseReceipts(orderId?: string): Promise<PurchaseReceipt[]> {
  const rows = await list<PurchaseReceipt>(COLLECTIONS.purchaseReceipts, orderId ? { where: [["orderId", "==", orderId]] } : {});
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Itens ativos para montar um pedido à mão (nome, unidade, série, custo médio). */
export async function listPurchasableItems(): Promise<{ id: string; name: string; unit: string; serialControlled: boolean; avgCost: number }[]> {
  const items = await list<StockItem>(COLLECTIONS.stockItems);
  return items
    .filter((i) => i.active !== false)
    .map((i) => ({ id: i.id, name: i.name, unit: i.unit || "un", serialControlled: Boolean(i.serialControlled), avgCost: i.avgCost || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
