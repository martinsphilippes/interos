/**
 * Estoque no banco (npm run test:db): cadastro do item, entrada com custo médio e séries, reserva na assinatura do
 * contrato pela origem do item (com falta avisada), entrada que preenche reserva pendente, saída por série para o
 * contrato, cancelamento (separado volta, entregue vira devolução pendente), devolução, ajuste, aviso de mínimo e
 * concorrência (duas saídas ao mesmo tempo não deixam o estoque negativo).
 *
 * Isolamento: a configuração `estoque` é guardada e devolvida no fim; cliente, contrato, produtos, itens, movimentos,
 * séries, reservas, eventos e notificações têm prefixo próprio e são apagados.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docdb } from "@/server/docdb";
import { create, getById, list } from "@/server/db";
import { COLLECTIONS, type Client, type Contract, type Product, type StockItem, type StockMovement, type StockReservation, type StockSerial } from "@/domain/types";
import { STOCK_SETTING_KEY, reservationDocId, serialDocId } from "@/domain/stock";
import {
  adjustStock,
  fillReservation,
  getStockSettings,
  registerEntry,
  registerExit,
  registerReturn,
  releaseContractReservations,
  releaseReservation,
  reserveByContractNumber,
  reserveForContract,
  saveStockItem,
  saveStockSettings,
} from "@/server/stock/service";

const RUN = `s${Date.now().toString(36)}`;
const ACTOR = { id: `${RUN}_adm`, name: "Administrativo Teste" };
const CLIENT_ID = `${RUN}_cli`;
const CONTRACT_ID = `${RUN}_ct`;
const KIT = `${RUN}_kit`;
const ROUTER = `${RUN}_rot`;
let settingsBackup: unknown = undefined;
const itemIds: string[] = [];

async function item(id: string): Promise<StockItem> {
  const i = await getById<StockItem>(COLLECTIONS.stockItems, id);
  if (!i) throw new Error("item sumiu");
  return i;
}

async function reservation(itemId: string): Promise<StockReservation> {
  const r = await getById<StockReservation>(COLLECTIONS.stockReservations, reservationDocId(CONTRACT_ID, itemId));
  if (!r) throw new Error("reserva sumiu");
  return r;
}

const product = (id: string, name: string, hardwarePrice: number) =>
  create<Product>(
    COLLECTIONS.products,
    { name, category: "hardware", setupPrice: 0, monthlyPrice: 0, hardwarePrice, billingType: "unico", commission: { setupPct: 0, recurringPct: 0, hardwarePct: 0, recurringReleaseInstallment: 1 }, active: true, order: 99 } as never,
    id,
  );

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL (veja scripts/db-local.sh)");
  const [row] = (await docdb.sql()`select data from interos.settings where data->>'key' = ${STOCK_SETTING_KEY}`) as unknown as { data: unknown }[];
  settingsBackup = row ? row.data : null;
  await docdb.sql()`delete from interos.settings where data->>'key' = ${STOCK_SETTING_KEY}`;
  await create<Client>(COLLECTIONS.clients, { legalName: `Cliente ${RUN} LTDA`, tradeName: `Cliente ${RUN}`, document: "35176948000187", status: "ativo", mrr: 0, tags: [] } as never, CLIENT_ID);
  await product(KIT, `Kit CFTV ${RUN}`, 3000);
  await product(ROUTER, `Roteador ${RUN}`, 400);
  await create<Contract>(
    COLLECTIONS.contracts,
    {
      clientId: CLIENT_ID,
      number: `CT-${RUN}`.toUpperCase(),
      version: 1,
      status: "assinado",
      items: [
        { productId: KIT, productName: `Kit CFTV ${RUN}`, quantity: 1, setupValue: 0, monthlyValue: 0, hardwareValue: 3000, discountPct: 0 },
        { productId: ROUTER, productName: `Roteador ${RUN}`, quantity: 2, setupValue: 0, monthlyValue: 0, hardwareValue: 800, discountPct: 0 },
      ],
      setupTotal: 0,
      monthlyTotal: 0,
      hardwareTotal: 3800,
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
});

afterAll(async () => {
  const sql = docdb.sql();
  if (itemIds.length) {
    await sql`delete from interos.stock_movements where data->>'itemId' = any(${itemIds})`;
    await sql`delete from interos.stock_serials where data->>'itemId' = any(${itemIds})`;
    await sql`delete from interos.stock_reservations where data->>'itemId' = any(${itemIds})`;
    await sql`delete from interos.events where data->>'entityId' = any(${itemIds})`;
    await sql`delete from interos.notifications where data->>'entityId' = any(${itemIds})`;
    await sql`delete from interos.stock_items where id = any(${itemIds})`;
  }
  await sql`delete from interos.notifications where data->>'entityId' = ${CONTRACT_ID}`;
  await sql`delete from interos.events where data->>'clientId' = ${CLIENT_ID} or data->>'entityId' = ${STOCK_SETTING_KEY}`;
  await sql`delete from interos.timeline_events where data->>'clientId' = ${CLIENT_ID}`;
  await sql`delete from interos.contracts where id = ${CONTRACT_ID}`;
  await sql`delete from interos.products where id = any(${[KIT, ROUTER]})`;
  await sql`delete from interos.clients where id = ${CLIENT_ID}`;
  if (settingsBackup === null) await sql`delete from interos.settings where data->>'key' = ${STOCK_SETTING_KEY}`;
  else if (settingsBackup) await sql`update interos.settings set data = ${sql.json(settingsBackup as never)} where data->>'key' = ${STOCK_SETTING_KEY}`;
});

let camera = "";
let dvr = "";
let router = "";

describe("estoque", () => {
  it("configuração: padrão Administrativo; salvar grava", async () => {
    expect(await getStockSettings()).toMatchObject({ responsibleDepartment: "administrativo", reserveOnSign: true, stored: false });
    await saveStockSettings({ responsibleDepartment: "administrativo", reserveOnSign: true, notifyLowStock: true }, ACTOR);
    expect((await getStockSettings()).stored).toBe(true);
  });

  it("cadastro: itens vinculados aos produtos; nome e SKU sem repetir", async () => {
    camera = (await saveStockItem({ name: `Câmera ${RUN}`, sku: `cam-${RUN}`, manufacturer: "Intelbras", model: "VHD 1220", serialControlled: true, origin: "estoque", minQuantity: 2, products: [{ productId: KIT, units: 4 }], active: true }, ACTOR)).id;
    dvr = (await saveStockItem({ name: `DVR ${RUN}`, serialControlled: false, origin: "estoque_ou_compra", minQuantity: 0, products: [{ productId: KIT, units: 1 }], active: true }, ACTOR)).id;
    router = (await saveStockItem({ name: `Roteador ${RUN}`, serialControlled: false, origin: "sob_demanda", minQuantity: 0, products: [{ productId: ROUTER, units: 1 }], active: true }, ACTOR)).id;
    itemIds.push(camera, dvr, router);
    expect((await item(camera)).sku).toBe(`CAM-${RUN}`.toUpperCase());
    await expect(saveStockItem({ name: `Outra ${RUN}`, sku: `CAM-${RUN}`, serialControlled: false, origin: "estoque", minQuantity: 0, products: [], active: true }, ACTOR)).rejects.toThrow(/já é de outro item/);
    await expect(saveStockItem({ name: `câmera ${RUN}`, serialControlled: false, origin: "estoque", minQuantity: 0, products: [], active: true }, ACTOR)).rejects.toThrow(/Já existe/);
  });

  it("entrada: custo médio ponderado; série obrigatória, única e normalizada", async () => {
    await expect(registerEntry({ itemId: camera, quantity: 2, unitCost: 100, serials: ["A1"] }, ACTOR)).rejects.toThrow(/exige número de série/);
    await registerEntry({ itemId: camera, quantity: 3, unitCost: 100, serials: ["a1", "A2", "a3"], document: "NF 123", supplier: "Distribuidora" }, ACTOR);
    await registerEntry({ itemId: camera, quantity: 1, unitCost: 300, serials: ["A4"] }, ACTOR);
    expect(await item(camera)).toMatchObject({ onHand: 4, reserved: 0, avgCost: 150 });
    await expect(registerEntry({ itemId: camera, quantity: 1, unitCost: 1, serials: ["A1"] }, ACTOR)).rejects.toThrow(/já cadastrado/);
    expect((await getById<StockSerial>(COLLECTIONS.stockSerials, serialDocId(camera, "A1")))?.status).toBe("em_estoque");
    await registerEntry({ itemId: dvr, quantity: 1, unitCost: 500 }, ACTOR);
  });

  it("assinatura reserva pela origem: estoque reserva o que há e aponta a falta; sob demanda vai inteiro para compra; repetir não duplica", async () => {
    const summary = await reserveForContract(CONTRACT_ID, ACTOR);
    const byItem = Object.fromEntries(summary.created.map((c) => [c.itemId, c]));
    expect(byItem[camera]).toMatchObject({ quantity: 4, reserved: 4, missing: 0 });
    expect(byItem[dvr]).toMatchObject({ quantity: 1, reserved: 1, missing: 0 });
    expect(byItem[router]).toMatchObject({ quantity: 2, reserved: 0, missing: 2, toPurchase: true });
    expect(await item(camera)).toMatchObject({ onHand: 4, reserved: 4 });
    // Disponível 0 < mínimo 2: aviso dado uma vez (marca no item).
    expect((await item(camera)).lowStockAlertAt).toBeTruthy();
    const again = await reserveForContract(CONTRACT_ID, ACTOR);
    expect(again).toMatchObject({ created: [], skipped: 3 });
    await expect(reserveByContractNumber(`CT-${RUN}`, ACTOR)).rejects.toThrow(/já estão reservados/);
    const notes = await list(COLLECTIONS.notifications, { where: [["entityId", "==", CONTRACT_ID]] });
    expect(notes.length).toBeGreaterThan(0);
  });

  it("entrada preenche a reserva que aguardava compra (sob demanda)", async () => {
    const res = await registerEntry({ itemId: router, quantity: 3, unitCost: 200 }, ACTOR);
    expect(res.filled).toEqual([expect.objectContaining({ add: 2 })]);
    expect(await item(router)).toMatchObject({ onHand: 3, reserved: 2 });
    expect(await reservation(router)).toMatchObject({ reserved: 2, delivered: 0 });
    await expect(fillReservation(reservationDocId(CONTRACT_ID, router), ACTOR)).rejects.toThrow(/Nada falta/);
  });

  it("saída: sem reserva só do disponível; com reserva, por série, e a série fica com o cliente", async () => {
    // A câmera está toda reservada para o contrato: saída avulsa recusada.
    await expect(registerExit({ itemId: camera, quantity: 1, serials: ["A1"], reason: "Demonstração na feira" }, ACTOR)).rejects.toThrow(/disponível/);
    await expect(registerExit({ itemId: camera, quantity: 1, serials: ["A1"] }, ACTOR)).rejects.toThrow(/motivo/);
    const rid = reservationDocId(CONTRACT_ID, camera);
    await expect(registerExit({ itemId: camera, quantity: 1, reservationId: rid, serials: ["ZZ9"] }, ACTOR)).rejects.toThrow(/não está em estoque/);
    await registerExit({ itemId: camera, quantity: 2, reservationId: rid, serials: ["A1", "A2"] }, ACTOR);
    expect(await item(camera)).toMatchObject({ onHand: 2, reserved: 2 });
    expect(await reservation(camera)).toMatchObject({ reserved: 2, delivered: 2, status: "ativa" });
    expect(await getById<StockSerial>(COLLECTIONS.stockSerials, serialDocId(camera, "A1"))).toMatchObject({ status: "entregue", clientId: CLIENT_ID, contractId: CONTRACT_ID });
    await expect(registerExit({ itemId: router, quantity: 3, reservationId: reservationDocId(CONTRACT_ID, router) }, ACTOR)).rejects.toThrow(/só tem 2 unidade/);
    // DVR inteiro entregue: reserva atendida.
    await registerExit({ itemId: dvr, quantity: 1, reservationId: reservationDocId(CONTRACT_ID, dvr) }, ACTOR);
    expect(await reservation(dvr)).toMatchObject({ status: "atendida", delivered: 1, reserved: 0 });
  });

  it("liberar com o contrato valendo: o separado volta, o entregue fica com o cliente; dá para reservar de novo", async () => {
    // Roteador: 2 separadas, nada entregue → liberar e reservar de novo pelo contrato.
    await releaseReservation(reservationDocId(CONTRACT_ID, router), "Urgência de outro contrato", ACTOR);
    expect(await reservation(router)).toMatchObject({ status: "cancelada", reserved: 0 });
    expect((await item(router)).reserved).toBe(0);
    const again = await reserveByContractNumber(`CT-${RUN}`, ACTOR);
    // Sob demanda não reserva sozinho (vai para compra); havendo estoque, "Separar" pega do disponível.
    expect(again.created).toEqual([expect.objectContaining({ itemId: router, reserved: 0, missing: 2 })]);
    expect(await fillReservation(reservationDocId(CONTRACT_ID, router), ACTOR)).toBe(2);
    expect(await reservation(router)).toMatchObject({ status: "ativa", reserved: 2 });
    expect((await item(router)).reserved).toBe(2);
  });

  it("cancelamento do contrato: o separado volta ao disponível; o entregue vira devolução pendente", async () => {
    const out = await releaseContractReservations(CONTRACT_ID, "Contrato cancelado: teste", ACTOR);
    expect(out).toEqual({ released: 4, pendingReturn: 3 });
    expect(await item(camera)).toMatchObject({ onHand: 2, reserved: 0 });
    expect(await item(router)).toMatchObject({ onHand: 3, reserved: 0 });
    expect(await reservation(camera)).toMatchObject({ status: "cancelada", reserved: 0, delivered: 2 });
    expect(await reservation(dvr)).toMatchObject({ status: "cancelada", delivered: 1 });
    // Repetir não muda nada.
    expect(await releaseContractReservations(CONTRACT_ID, "de novo", ACTOR)).toEqual({ released: 0, pendingReturn: 0 });
  });

  it("devolução: pela série acha o contrato; abate a devolução pendente", async () => {
    await expect(registerReturn({ itemId: camera, quantity: 1, serials: ["A3"], reason: "Voltou do cliente" }, ACTOR)).rejects.toThrow(/não está com cliente/);
    await registerReturn({ itemId: camera, quantity: 1, serials: ["A1"], reason: "Recolhido pelo técnico" }, ACTOR);
    expect(await reservation(camera)).toMatchObject({ returned: 1, delivered: 2 });
    expect(await item(camera)).toMatchObject({ onHand: 3, reserved: 0 });
    expect(await getById<StockSerial>(COLLECTIONS.stockSerials, serialDocId(camera, "A1"))).toMatchObject({ status: "em_estoque" });
    await registerReturn({ itemId: dvr, quantity: 1, reservationId: reservationDocId(CONTRACT_ID, dvr), reason: "Recolhido pelo técnico" }, ACTOR);
    await expect(registerReturn({ itemId: dvr, quantity: 1, reservationId: reservationDocId(CONTRACT_ID, dvr), reason: "De novo por engano" }, ACTOR)).rejects.toThrow(/Só 0/);
  });

  it("ajuste: baixa por série com motivo; nunca negativo", async () => {
    await expect(adjustStock({ itemId: router, delta: -4, reason: "Inventário" }, ACTOR)).rejects.toThrow(/negativo/);
    await adjustStock({ itemId: camera, delta: -1, serials: ["A4"], reason: "Queimou no teste de bancada" }, ACTOR);
    expect(await getById<StockSerial>(COLLECTIONS.stockSerials, serialDocId(camera, "A4"))).toMatchObject({ status: "baixado" });
    expect((await item(camera)).onHand).toBe(2);
    // Série baixada pode voltar numa entrada nova (ex.: consertada).
    await registerEntry({ itemId: camera, quantity: 1, unitCost: 50, serials: ["A4"] }, ACTOR);
    expect((await item(camera)).onHand).toBe(3);
    const moves = await list<StockMovement>(COLLECTIONS.stockMovements, { where: [["itemId", "==", camera]] });
    expect(moves.map((m) => m.type).sort()).toEqual(["ajuste", "devolucao", "entrada", "entrada", "entrada", "liberacao", "reserva", "saida"].sort());
    // Cada movimento guarda o saldo depois dele.
    expect(moves.every((m) => m.onHandAfter >= 0 && m.reservedAfter >= 0)).toBe(true);
  });

  it("concorrência: duas saídas simultâneas do último disponível — só uma passa e o estoque não fica negativo", async () => {
    const solo = (await saveStockItem({ name: `Fonte ${RUN}`, serialControlled: false, origin: "estoque", minQuantity: 0, products: [], active: true }, ACTOR)).id;
    itemIds.push(solo);
    await registerEntry({ itemId: solo, quantity: 1, unitCost: 10 }, ACTOR);
    const results = await Promise.allSettled([
      registerExit({ itemId: solo, quantity: 1, reason: "Uso interno A" }, ACTOR),
      registerExit({ itemId: solo, quantity: 1, reason: "Uso interno B" }, ACTOR),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await item(solo)).toMatchObject({ onHand: 0, reserved: 0 });
  });

  it("item com saldo não muda o controle por série nem desativa com reserva", async () => {
    const current = await item(camera);
    await expect(
      saveStockItem({ id: camera, name: current.name, serialControlled: false, origin: current.origin, minQuantity: current.minQuantity, products: current.products, active: true }, ACTOR),
    ).rejects.toThrow(/número de série/);
  });

  it("contrato não assinado não reserva", async () => {
    await docdb.sql()`update interos.contracts set data = jsonb_set(data, '{status}', '"cancelado"') where id = ${CONTRACT_ID}`;
    await expect(reserveForContract(CONTRACT_ID, ACTOR)).rejects.toThrow(/cancelado/);
  });
});
