/**
 * Compras no banco (npm run test:db): necessidade a partir da falta de um contrato, pedido em rascunho, envio com e
 * sem aprovação (acima do limite espera; devolvido volta a rascunho), recebimento parcial com série (entrada no
 * estoque, reserva do contrato preenchida, título em Contas a Pagar com o prazo), recebimento que não passa do pedido
 * e cancelamento.
 *
 * Isolamento: as configurações `compras` e `estoque` são guardadas e devolvidas; itens, pedidos, recebimentos,
 * movimentos, séries, reservas, títulos, eventos e notificações têm prefixo próprio e são apagados.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docdb } from "@/server/docdb";
import { create, getById, list } from "@/server/db";
import { COLLECTIONS, type Client, type Contract, type Payable, type Product, type PurchaseOrder, type StockItem, type StockReservation } from "@/domain/types";
import { PURCHASE_SETTING_KEY } from "@/domain/purchases";
import { STOCK_SETTING_KEY, reservationDocId } from "@/domain/stock";
import { reserveForContract, saveStockItem } from "@/server/stock/service";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseNeeds,
  receivePurchaseOrder,
  rejectPurchaseOrder,
  savePurchaseSettings,
  submitPurchaseOrder,
} from "@/server/purchases/service";

const RUN = `p${Date.now().toString(36)}`;
const ACTOR = { id: `${RUN}_adm`, name: "Compras Teste" };
const CLIENT_ID = `${RUN}_cli`;
const CONTRACT_ID = `${RUN}_ct`;
const PRODUCT_ID = `${RUN}_prod`;
const backups: Record<string, unknown> = {};
let itemId = "";
const orderIds: string[] = [];

async function order(id: string): Promise<PurchaseOrder> {
  const o = await getPurchaseOrder(id);
  if (!o) throw new Error("pedido sumiu");
  return o;
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL (veja scripts/db-local.sh)");
  const sql = docdb.sql();
  for (const key of [PURCHASE_SETTING_KEY, STOCK_SETTING_KEY]) {
    const [row] = (await sql`select data from interos.settings where data->>'key' = ${key}`) as unknown as { data: unknown }[];
    backups[key] = row ? row.data : null;
    await sql`delete from interos.settings where data->>'key' = ${key}`;
  }
  await create<Client>(COLLECTIONS.clients, { legalName: `Cliente ${RUN} LTDA`, tradeName: `Cliente ${RUN}`, document: "35176948000187", status: "ativo", mrr: 0, tags: [] } as never, CLIENT_ID);
  await create<Product>(COLLECTIONS.products, { name: `POS ${RUN}`, category: "hardware", setupPrice: 0, monthlyPrice: 0, hardwarePrice: 900, billingType: "unico", commission: { setupPct: 0, recurringPct: 0, hardwarePct: 0, recurringReleaseInstallment: 1 }, active: true, order: 99 } as never, PRODUCT_ID);
  await create<Contract>(
    COLLECTIONS.contracts,
    {
      clientId: CLIENT_ID,
      number: `CT-${RUN}`.toUpperCase(),
      version: 1,
      status: "assinado",
      items: [{ productId: PRODUCT_ID, productName: `POS ${RUN}`, quantity: 2, setupValue: 0, monthlyValue: 0, hardwareValue: 1800, discountPct: 0 }],
      setupTotal: 0,
      monthlyTotal: 0,
      hardwareTotal: 1800,
      billingDay: 10,
      recurrence: "unico",
      termMonths: 12,
      signers: [],
      financialStatus: "pendente",
      documentIds: [],
      createdBy: ACTOR.id,
    } as never,
    CONTRACT_ID,
  );
  itemId = (await saveStockItem({ name: `POS ${RUN}`, serialControlled: true, origin: "estoque_ou_compra", minQuantity: 1, products: [{ productId: PRODUCT_ID, units: 1 }], active: true }, ACTOR)).id;
  await reserveForContract(CONTRACT_ID, ACTOR);
});

afterAll(async () => {
  const sql = docdb.sql();
  if (orderIds.length) {
    await sql`delete from interos.payables where data->>'description' like ${`Compra %${RUN}%`} or data->>'notes' like ${"%pedido de compra%"} and data->>'createdBy' = ${ACTOR.id}`;
    await sql`delete from interos.purchase_receipts where data->>'orderId' = any(${orderIds})`;
    await sql`delete from interos.events where data->>'entityId' = any(${orderIds})`;
    await sql`delete from interos.notifications where data->>'entityId' = any(${orderIds})`;
    await sql`delete from interos.purchase_orders where id = any(${orderIds})`;
  }
  await sql`delete from interos.payables where data->>'createdBy' = ${ACTOR.id}`;
  await sql`delete from interos.events where data->>'actorId' = ${ACTOR.id}`;
  await sql`delete from interos.timeline_events where data->>'clientId' = ${CLIENT_ID}`;
  await sql`delete from interos.notifications where data->>'entityId' = ${CONTRACT_ID} or data->>'entityId' = ${itemId}`;
  await sql`delete from interos.stock_movements where data->>'itemId' = ${itemId}`;
  await sql`delete from interos.stock_serials where data->>'itemId' = ${itemId}`;
  await sql`delete from interos.stock_reservations where data->>'itemId' = ${itemId}`;
  await sql`delete from interos.stock_items where id = ${itemId}`;
  await sql`delete from interos.contracts where id = ${CONTRACT_ID}`;
  await sql`delete from interos.products where id = ${PRODUCT_ID}`;
  await sql`delete from interos.clients where id = ${CLIENT_ID}`;
  for (const key of [PURCHASE_SETTING_KEY, STOCK_SETTING_KEY]) {
    const b = backups[key];
    await sql`delete from interos.settings where data->>'key' = ${key}`;
    if (b) await sql`insert into interos.settings (id, data) values (${`set_${key}_restore_${RUN}`}, ${sql.json(b as never)})`;
  }
});

describe("compras", () => {
  it("necessidade: falta do contrato (2) + mínimo (1) = 3 a comprar; pedido em aberto desconta", async () => {
    const need = (await listPurchaseNeeds()).find((n) => n.itemId === itemId);
    expect(need).toMatchObject({ missing: 2, suggested: 3, reasons: ["contratos", "minimo"] });
    expect(need?.contracts[0]).toMatchObject({ contractId: CONTRACT_ID, missing: 2 });
  });

  it("sem aprovação configurada: enviar já aprova; pedido em aberto zera a necessidade", async () => {
    const o = await createPurchaseOrder({ supplierName: `Distribuidora ${RUN}`, lines: [{ itemId, quantity: 3, unitCost: 1000 }], paymentDays: 30, installments: 1 }, ACTOR);
    orderIds.push(o.id);
    expect(o).toMatchObject({ status: "rascunho", total: 3000 });
    expect(o.number).toMatch(/^PC-\d{4}-\d{4}$/);
    expect(await submitPurchaseOrder(o.id, ACTOR)).toBe("aprovado");
    expect((await listPurchaseNeeds()).find((n) => n.itemId === itemId)?.suggested).toBe(0);
    await expect(submitPurchaseOrder(o.id, ACTOR)).rejects.toThrow(/já foi enviado/);
  });

  it("recebimento parcial com série: entra no estoque, separa para o contrato e cria o título com o prazo", async () => {
    const id = orderIds[0];
    await expect(receivePurchaseOrder(id, { lines: [{ itemId, quantity: 2, serials: ["A1"] }] }, ACTOR)).rejects.toThrow(/exige número de série/);
    await expect(receivePurchaseOrder(id, { lines: [{ itemId, quantity: 4, serials: ["A1", "A2", "A3", "A4"] }] }, ACTOR)).rejects.toThrow(/só faltam 3/);
    const r = await receivePurchaseOrder(id, { receivedAt: "2026-10-20", document: "NF 777", lines: [{ itemId, quantity: 2, serials: ["a1", "a2"] }] }, ACTOR);
    expect(r).toMatchObject({ posted: 1, failed: [], status: "parcial" });
    expect(r.payableCode).toBeTruthy();
    expect((await order(id)).lines[0]).toMatchObject({ received: 2, quantity: 3 });
    const item = await getById<StockItem>(COLLECTIONS.stockItems, itemId);
    expect(item).toMatchObject({ onHand: 2, reserved: 2, avgCost: 1000 });
    expect(await getById<StockReservation>(COLLECTIONS.stockReservations, reservationDocId(CONTRACT_ID, itemId))).toMatchObject({ reserved: 2 });
    const payables = await list<Payable>(COLLECTIONS.payables, { where: [["createdBy", "==", ACTOR.id]] });
    expect(payables).toHaveLength(1);
    expect(payables[0]).toMatchObject({ amount: 2000, category: "fornecedor", creditorName: `Distribuidora ${RUN}`, status: "previsto" });
    expect(payables[0].dueDate.slice(0, 10)).toBe("2026-11-19");
    // Série repetida em outro recebimento é recusada antes de mexer em qualquer coisa.
    await expect(receivePurchaseOrder(id, { lines: [{ itemId, quantity: 1, serials: ["A1"] }] }, ACTOR)).rejects.toThrow(/já cadastrado/);
    expect((await order(id)).lines[0].received).toBe(2);
  });

  it("o resto chega: pedido recebido; não recebe mais", async () => {
    const id = orderIds[0];
    const r = await receivePurchaseOrder(id, { lines: [{ itemId, quantity: 1, serials: ["A3"], unitCost: 1300 }] }, ACTOR);
    expect(r.status).toBe("recebido");
    expect((await getById<StockItem>(COLLECTIONS.stockItems, itemId))?.avgCost).toBe(1100);
    await expect(receivePurchaseOrder(id, { lines: [{ itemId, quantity: 1, serials: ["A4"] }] }, ACTOR)).rejects.toThrow(/não está aguardando recebimento/);
    await expect(cancelPurchaseOrder(id, "Teste de cancelar", ACTOR)).rejects.toThrow(/já recebido/);
  });

  it("aprovação ligada: acima do limite espera; devolvido volta a rascunho; aprovado pode receber", async () => {
    await savePurchaseSettings({ approvalEnabled: true, approvalThreshold: 1500, payableCategory: "fornecedor", paymentDays: 15 }, ACTOR);
    const small = await createPurchaseOrder({ supplierName: `Distribuidora ${RUN}`, lines: [{ itemId, quantity: 1, unitCost: 1500 }] }, ACTOR);
    const big = await createPurchaseOrder({ supplierName: `Distribuidora ${RUN}`, lines: [{ itemId, quantity: 2, unitCost: 1500 }] }, ACTOR);
    orderIds.push(small.id, big.id);
    expect(small.paymentDays).toBe(15);
    expect(await submitPurchaseOrder(small.id, ACTOR)).toBe("aprovado");
    expect(await submitPurchaseOrder(big.id, ACTOR)).toBe("aguardando_aprovacao");
    await expect(receivePurchaseOrder(big.id, { lines: [{ itemId, quantity: 1, serials: ["B1"] }] }, ACTOR)).rejects.toThrow(/ainda não foi aprovado/);
    await rejectPurchaseOrder(big.id, "Negociar preço melhor", ACTOR);
    expect(await order(big.id)).toMatchObject({ status: "rascunho", rejectedReason: "Negociar preço melhor" });
    expect(await submitPurchaseOrder(big.id, ACTOR)).toBe("aguardando_aprovacao");
    await approvePurchaseOrder(big.id, { id: `${RUN}_dir`, name: "Diretoria" });
    expect(await order(big.id)).toMatchObject({ status: "aprovado", approvedByName: "Diretoria" });
    await cancelPurchaseOrder(small.id, "Comprado em outro pedido", ACTOR);
    expect((await order(small.id)).status).toBe("cancelado");
  });

  it("dois recebimentos ao mesmo tempo não passam do pedido", async () => {
    const id = orderIds[2];
    const results = await Promise.allSettled([
      receivePurchaseOrder(id, { lines: [{ itemId, quantity: 2, serials: ["C1", "C2"] }] }, ACTOR),
      receivePurchaseOrder(id, { lines: [{ itemId, quantity: 2, serials: ["D1", "D2"] }] }, ACTOR),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await order(id)).lines[0].received).toBe(2);
  });
});
