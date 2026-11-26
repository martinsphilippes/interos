/**
 * Regras de comissão v3 no banco (npm run test:db): regra combinada (vendedor + produto + plano + mensalidades 3ª e 6ª +
 * teto da base) salva pelo serviço, motor real (reconcileCommissions), não retroatividade (nova versão não muda a venda
 * anterior; venda nova usa a versão nova), reaplicação autorizada (só o que ainda não foi adquirido muda), histórico de
 * versões e estorno no cancelamento do contrato (conforme a versão em que a comissão nasceu).
 *
 * Isolamento: vendedor, cliente, produto, plano, contratos, cobranças, regra, versões, comissões e títulos têm prefixo
 * próprio e são apagados; a regra é "por vendedor" (não alcança contratos de outros testes).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docdb } from "@/server/docdb";
import { create, list, update } from "@/server/db";
import { COLLECTIONS, type Billing, type Client, type CommercialPlan, type Commission, type CommissionRuleVersion, type Contract, type Product, type User } from "@/domain/types";
import { reconcileCommissions } from "@/server/commissions/engine";
import { ruleInputSchema } from "@/server/commissions/schemas";
import { reverseCommissionsOnContractCancel, saveCommissionRule } from "@/server/commissions/service";

const RUN = `cv${Date.now().toString(36)}`;
const ACTOR = { id: `${RUN}_adm`, name: "Comissões Teste" };
const SELLER = `${RUN}_seller`;
const CLIENT = `${RUN}_cli`;
const PRODUCT = `${RUN}_prod`;
const PLAN = `${RUN}_star`;
const OLD = `${RUN}_ct_old`;
const NEW = `${RUN}_ct_new`;
const REV = `${RUN}_ct_rev`;
let ruleId = "";
let otherRuleId = "";
/** Regras ativas que já estavam no banco (ex.: seed): desativadas durante o teste e reativadas no fim. */
let pausedRules: string[] = [];

const iso = (d: string) => `${d}T12:00:00.000Z`;

async function contract(id: string, createdAt?: string): Promise<void> {
  await create<Contract>(
    COLLECTIONS.contracts,
    {
      clientId: CLIENT,
      number: `CT-${id}`.toUpperCase(),
      version: 1,
      status: "liberado",
      items: [{ productId: PRODUCT, productName: `ERP ${RUN}`, quantity: 1, setupValue: 0, monthlyValue: 400, hardwareValue: 0, discountPct: 0, planId: PLAN, planName: "Star" }],
      setupTotal: 0,
      monthlyTotal: 400,
      hardwareTotal: 0,
      billingDay: 10,
      firstDueDate: iso("2026-02-10"),
      recurrence: "mensal",
      termMonths: 12,
      startDate: iso("2026-01-20"),
      signedAt: iso("2026-01-20"),
      releasedAt: iso("2026-01-20"),
      signers: [],
      financialStatus: "aprovado",
      documentIds: [],
      sellerId: SELLER,
      ...(createdAt ? { createdAt, updatedAt: createdAt } : {}),
    } as never,
    id,
  );
  // 1ª a 3ª mensalidades pagas; a 6ª ainda não existe (prevista).
  for (const n of [1, 2, 3]) {
    const due = iso(`2026-0${n + 1}-10`);
    await create<Billing>(COLLECTIONS.billing, { clientId: CLIENT, contractId: id, type: "mensalidade", competence: due.slice(0, 7), installment: n, amount: 400, dueDate: due, status: "paga", paidAt: due, paidAmount: 400 } as never, `${id}_m${n}`);
  }
}

const commissionsOf = (contractId: string) => list<Commission>(COLLECTIONS.commissions, { where: [["contractId", "==", contractId]] });
const slot = (list_: Commission[], s: string) => list_.filter((c) => c.slot === s && c.status !== "cancelada");

function input(over: Record<string, unknown>) {
  return ruleInputSchema.parse({
    name: `Star 3ª e 6ª ${RUN}`,
    code: `COM-${RUN}`,
    scope: "vendedor",
    userId: SELLER,
    revenueType: "recorrencia",
    productId: PRODUCT,
    planId: PLAN,
    mode: "percentual",
    value: 25,
    trigger: "pagamento",
    baseSource: "contratado",
    minTenureDays: 0,
    recurringCompetences: null,
    releaseInstallment: 3,
    installments: [3, 6],
    baseCap: 100,
    overridesDefault: true,
    active: true,
    ...over,
  });
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL (veja scripts/db-local.sh)");
  const sql = docdb.sql();
  pausedRules = ((await sql`select id from interos.commission_rules where (data->>'active')::boolean`) as unknown as { id: string }[]).map((r) => r.id);
  if (pausedRules.length) await sql`update interos.commission_rules set data = jsonb_set(data, '{active}', 'false') where id = any(${pausedRules})`;
  await create<User>(COLLECTIONS.users, { name: `Vendedor ${RUN}`, email: `${RUN}@teste.local`, role: "vendas", departmentId: "vendas", active: true } as never, SELLER);
  await create<Client>(COLLECTIONS.clients, { legalName: `Cliente ${RUN} LTDA`, tradeName: `Cliente ${RUN}`, document: "35176948000187", status: "ativo", mrr: 0, tags: [] } as never, CLIENT);
  await create<Product>(COLLECTIONS.products, { name: `ERP ${RUN}`, category: "erp", setupPrice: 0, monthlyPrice: 400, hardwarePrice: 0, billingType: "recorrente", commission: { setupPct: 0, recurringPct: 0, hardwarePct: 0, recurringReleaseInstallment: 3 }, active: true, order: 99 } as never, PRODUCT);
  await create<CommercialPlan>(COLLECTIONS.commercialPlans, { code: `STAR${RUN}`.toUpperCase(), name: "Star", productId: PRODUCT, active: true, order: 1 } as never, PLAN);
  // Venda antiga (antes da regra existir).
  await contract(OLD, iso("2026-01-15"));
});

afterAll(async () => {
  const sql = docdb.sql();
  const contracts = [OLD, NEW, REV];
  await sql`delete from interos.payables where data->'sourceIds'->>'contractId' = any(${contracts}) or data->>'creditorId' = ${SELLER}`;
  await sql`delete from interos.commissions where data->>'contractId' = any(${contracts})`;
  await sql`delete from interos.billing where data->>'contractId' = any(${contracts})`;
  await sql`delete from interos.contracts where id = any(${contracts})`;
  const created = [ruleId, otherRuleId].filter(Boolean);
  if (created.length) {
    await sql`delete from interos.commission_rule_versions where data->>'ruleId' = any(${created})`;
    await sql`delete from interos.commission_rules where id = any(${created})`;
  }
  if (pausedRules.length) await sql`update interos.commission_rules set data = jsonb_set(data, '{active}', 'true') where id = any(${pausedRules})`;
  await sql`delete from interos.commercial_plans where id = ${PLAN}`;
  await sql`delete from interos.products where id = ${PRODUCT}`;
  await sql`delete from interos.clients where id = ${CLIENT}`;
  await sql`delete from interos.users where id = ${SELLER}`;
});

describe("regras v3 + motor no banco", () => {
  it("regra criada depois da venda só alcança a venda com reaplicação autorizada; calcula com teto da base e mensalidades exatas", async () => {
    const { rule } = await saveCommissionRule(input({}), ACTOR, { applyToPending: false });
    ruleId = rule.id;
    await reconcileCommissions({ contractIds: [OLD], actor: ACTOR, emit: false });
    expect((await commissionsOf(OLD)).filter((c) => c.ruleId === ruleId)).toHaveLength(0);

    await saveCommissionRule(input({ id: ruleId, reason: "alcançar a venda de janeiro" }), ACTOR, { applyToPending: true });
    await reconcileCommissions({ contractIds: [OLD], actor: ACTOR, emit: false });
    const list_ = await commissionsOf(OLD);
    const m3 = slot(list_, "m3")[0];
    const m6 = slot(list_, "m6")[0];
    expect(slot(list_, "m1")).toHaveLength(0);
    expect(slot(list_, "m2")).toHaveLength(0);
    expect(m3.amount).toBe(25);
    expect(m3.baseAmount).toBe(100);
    expect(["liberada", "titulo_gerado"]).toContain(m3.status);
    expect(m3.planId).toBe(PLAN);
    expect(m3.ruleSnapshot?.version).toBe(2);
    expect(m6.status).toBe("prevista");
    expect(m6.amount).toBe(25);
  });

  it("nova versão (sem reaplicar) não muda a venda anterior; venda nova usa a versão nova", async () => {
    await saveCommissionRule(input({ id: ruleId, value: 50, reason: "novo percentual a partir de hoje" }), ACTOR);
    await reconcileCommissions({ contractIds: [OLD], actor: ACTOR, emit: false });
    const old = await commissionsOf(OLD);
    expect(slot(old, "m3")[0].amount).toBe(25);
    expect(slot(old, "m6")[0].amount).toBe(25);
    expect(slot(old, "m6")[0].ruleSnapshot?.version).toBe(2);

    await contract(NEW);
    await reconcileCommissions({ contractIds: [NEW], actor: ACTOR, emit: false });
    const fresh = await commissionsOf(NEW);
    expect(slot(fresh, "m3")[0].amount).toBe(50);
    expect(slot(fresh, "m3")[0].ruleSnapshot?.version).toBe(3);
  });

  it("reaplicação autorizada muda só o que não foi adquirido", async () => {
    await saveCommissionRule(input({ id: ruleId, value: 40, reverseOnCancel: true, reason: "acordo comercial retroativo" }), ACTOR, { applyToPending: true });
    await reconcileCommissions({ contractIds: [OLD], actor: ACTOR, emit: false });
    const old = await commissionsOf(OLD);
    expect(slot(old, "m3")[0].amount).toBe(25);
    expect(slot(old, "m6")[0].amount).toBe(40);
    expect(slot(old, "m6")[0].ruleSnapshot?.version).toBe(4);
    const versions = (await list<CommissionRuleVersion>(COLLECTIONS.commissionRuleVersions, { where: [["ruleId", "==", ruleId]] })).sort((a, b) => a.version - b.version);
    expect(versions.map((v) => [v.version, v.retroactive])).toEqual([
      [1, false],
      [2, true],
      [3, false],
      [4, true],
    ]);
    expect(versions[2].summary).toContain("Valor");
    expect(versions[3].reason).toBe("acordo comercial retroativo");
  });

  it("regra exclusiva nova não duplica a comissão já adquirida da mesma parcela", async () => {
    const { rule } = await saveCommissionRule(input({ name: `Prioritária ${RUN}`, code: `COM-${RUN}-P`, priority: 1, value: 10, installments: [3, 6], baseCap: null }), ACTOR, { applyToPending: true });
    otherRuleId = rule.id;
    const r = await reconcileCommissions({ contractIds: [NEW], actor: ACTOR, emit: false });
    const list_ = await commissionsOf(NEW);
    const earnedM3 = slot(list_, "m3").filter((c) => ["liberada", "titulo_gerado", "paga"].includes(c.status));
    expect(earnedM3).toHaveLength(1);
    expect(earnedM3[0].ruleId).toBe(ruleId);
    expect(r.skippedDuplicate).toBeGreaterThanOrEqual(1);
    // A 6ª (pendente) passa para a regra prioritária: 10% de 400.
    const m6 = slot(list_, "m6");
    expect(m6).toHaveLength(1);
    expect(m6[0].ruleId).toBe(otherRuleId);
    expect(m6[0].amount).toBe(40);
    // Desliga a prioritária para não interferir no próximo caso (reaplicado: só pendentes mudam).
    await saveCommissionRule(input({ id: otherRuleId, name: `Prioritária ${RUN}`, code: `COM-${RUN}-P`, priority: 1, value: 10, installments: [3, 6], baseCap: null, active: false }), ACTOR, { applyToPending: true });
  });

  it("cancelamento: pendente é cancelada; adquirida só é estornada se a versão em que nasceu mandava estornar", async () => {
    // Venda feita já sob a versão 4 (com "estornar no cancelamento").
    await contract(REV);
    await reconcileCommissions({ contractIds: [REV], actor: ACTOR, emit: false });
    expect(slot(await commissionsOf(REV), "m3")[0].ruleSnapshot?.reverseOnCancel).toBe(true);
    const now = new Date().toISOString();
    for (const id of [OLD, REV]) {
      await update<Contract>(COLLECTIONS.contracts, id, { status: "cancelado", cancelledAt: now, cancelReason: "teste" });
      await reconcileCommissions({ contractIds: [id], actor: ACTOR, emit: false });
    }
    // Venda antiga: a 3ª mensalidade nasceu na versão 2 (sem estorno) e fica como está; a 6ª (pendente) é cancelada.
    expect(await reverseCommissionsOnContractCancel(OLD, "teste", ACTOR)).toHaveLength(0);
    const old = await commissionsOf(OLD);
    expect(old.find((c) => c.slot === "m6")?.status).toBe("cancelada");
    expect(["liberada", "titulo_gerado"]).toContain(old.find((c) => c.slot === "m3")?.status);
    // Venda nova: estornada; rodar de novo não estorna duas vezes.
    expect(await reverseCommissionsOnContractCancel(REV, "teste", ACTOR)).toHaveLength(1);
    expect((await commissionsOf(REV)).find((c) => c.slot === "m3")?.status).toBe("estornada");
    expect(await reverseCommissionsOnContractCancel(REV, "teste", ACTOR)).toHaveLength(0);
  });
});
