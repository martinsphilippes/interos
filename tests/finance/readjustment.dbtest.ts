/**
 * Reajuste anual no banco (npm run test:db): varredura `reajustes_contratos` aplicando o acumulado do índice por aditivo
 * "reajuste" (registro da data-base, mensalidade, evento), idempotência, renovação automática que cai na data-base
 * levando o reajuste junto, índice negativo «mantido», atraso além da folga (tarefa ao Financeiro, sem aplicar),
 * aplicar com percentual informado, dispensar, e o cadastro de índices (lançamento manual, valor oficial vence,
 * desativar em uso).
 *
 * Datas relativas a hoje (o teste roda em qualquer dia). Isolamento: cliente, contratos e índices com prefixo próprio,
 * apagados no fim.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docdb } from "@/server/docdb";
import { create, getById, list } from "@/server/db";
import { dateKey } from "@/lib/format";
import { addCompetence, addMonthsClamped } from "@/domain/readjustment";
import { COLLECTIONS, type Client, type Contract, type ContractAmendment, type DomainEvent, type ReadjustmentIndex, type Task } from "@/domain/types";
import { applyReadjustmentNow, getContractReadjustmentView, runContractReadjustments, skipReadjustment } from "@/server/finance/readjustments";
import { autoRenewContracts } from "@/server/finance/renewals";
import { applyAmendment, createAmendment } from "@/server/finance/amendments";
import { redactContract } from "@/server/finance/redact";
import { setReadjustmentIndexArchived, setReadjustmentIndexValue } from "@/server/finance-registry/indices";

const RUN = `t${Date.now().toString(36)}`;
const ACTOR = { id: `${RUN}_fin`, name: "Financeiro Teste" };
const CLIENT_ID = `${RUN}_cli`;
const IDX = `${RUN}-idx`;
const IDX_NEG = `${RUN}-neg`;
const IDX_OLD = `${RUN}-old`;
const contractIds: string[] = [];

const NOW = new Date();
const TODAY = dateKey(NOW);
const MONTH = TODAY.slice(0, 7);
const daysFrom = (key: string, days: number) => new Date(Date.parse(`${key}T12:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
const iso = (key: string) => `${key}T12:00:00.000Z`;

/** 14 meses de 0,4% até o mês passado: acumulado de 12 meses = 1,004^12 − 1. */
const STEADY = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [addCompetence(MONTH, -1 - i), { pct: 0.4, source: "manual" as const, at: iso(TODAY) }]));
const STEADY_ACC = Math.round(((1.004 ** 12 - 1) * 100 + Number.EPSILON) * 100) / 100;
const NEGATIVE = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [addCompetence(MONTH, -1 - i), { pct: -0.2, source: "manual" as const, at: iso(TODAY) }]));

async function contract(id: string, fields: Partial<Contract>): Promise<Contract> {
  const full = `${RUN}_${id}`;
  contractIds.push(full);
  await create<Contract>(
    COLLECTIONS.contracts,
    {
      clientId: CLIENT_ID,
      number: `CT-${RUN}-${id}`,
      version: 1,
      status: "liberado",
      items: [{ productId: `${RUN}_p1`, productName: "Sistema", quantity: 1, setupValue: 0, monthlyValue: 1000, hardwareValue: 0, discountPct: 0 }],
      setupTotal: 0,
      monthlyTotal: 1000,
      hardwareTotal: 0,
      billingDay: 10,
      recurrence: "mensal",
      termMonths: 24,
      signers: [],
      financialStatus: "aprovado",
      documentIds: [],
      ...fields,
    } as Omit<Contract, "id" | "organizationId" | "createdAt" | "updatedAt">,
    full,
  );
  return (await getById<Contract>(COLLECTIONS.contracts, full))!;
}

const amendmentsOf = (contractId: string) => list<ContractAmendment>(COLLECTIONS.contractAmendments, { where: [["contractId", "==", contractId]] });

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL (veja scripts/db-local.sh)");
  await create<Client>(COLLECTIONS.clients, { legalName: `ACME ${RUN} LTDA`, tradeName: `ACME ${RUN}`, document: "12345678000190", status: "ativo", email: `${RUN}@acme-teste.com.br`, mrr: 1000, tags: [] } as never, CLIENT_ID);
  const base = { negativePolicy: "manter" as const, archived: false, createdBy: ACTOR.id };
  await create<ReadjustmentIndex>(COLLECTIONS.readjustmentIndices, { ...base, name: `Índice ${RUN}`, source: { kind: "manual" }, values: STEADY } as never, IDX);
  await create<ReadjustmentIndex>(COLLECTIONS.readjustmentIndices, { ...base, name: `Negativo ${RUN}`, source: { kind: "manual" }, values: NEGATIVE } as never, IDX_NEG);
  await create<ReadjustmentIndex>(COLLECTIONS.readjustmentIndices, { ...base, name: `Antigo ${RUN}`, source: { kind: "bcb_sgs", seriesCode: 999999 }, values: { [addCompetence(MONTH, -9)]: { pct: 0.3, source: "bcb_sgs", at: iso(TODAY) } } } as never, IDX_OLD);
});

afterAll(async () => {
  const sql = docdb.sql();
  if (contractIds.length) {
    await sql`delete from interos.contract_amendments where data->>'contractId' = any(${contractIds})`;
    await sql`delete from interos.billing where data->>'contractId' = any(${contractIds})`;
    await sql`delete from interos.contracts where id = any(${contractIds})`;
  }
  await sql`delete from interos.client_products where data->>'clientId' = ${CLIENT_ID}`;
  await sql`delete from interos.tasks where data->>'clientId' = ${CLIENT_ID}`;
  await sql`delete from interos.events where data->>'clientId' = ${CLIENT_ID}`;
  await sql`delete from interos.timeline_events where data->>'clientId' = ${CLIENT_ID}`;
  await sql`delete from interos.notifications where data->>'entityId' = any(${contractIds})`;
  await sql`delete from interos.events where data->'payload'->>'indexId' = any(${[IDX, IDX_NEG, IDX_OLD]})`;
  await sql`delete from interos.readjustment_indices where id = any(${[IDX, IDX_NEG, IDX_OLD]})`;
  await sql`delete from interos.clients where id = ${CLIENT_ID}`;
});

describe("reajuste anual na data-base", () => {
  it("aplica o acumulado do índice por aditivo «reajuste» na data-base que chegou e não repete", async () => {
    const anniversary = daysFrom(TODAY, -5);
    const c = await contract("a", { startDate: iso(addMonthsClamped(anniversary, -12)), endDate: iso(addMonthsClamped(anniversary, 12)), readjustment: { type: "indice", index: IDX } });
    const first = await runContractReadjustments(NOW);
    expect(first.appliedContractIds).toContain(c.id);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.monthlyTotal).toBe(Math.round(1000 * (1 + STEADY_ACC / 100) * 100) / 100);
    expect(after.items[0].monthlyValue).toBe(after.monthlyTotal);
    expect(after.version).toBe(2);
    expect(after.readjustmentLog).toHaveLength(1);
    expect(after.readjustmentLog![0]).toMatchObject({ anniversary, outcome: "aplicado", percent: STEADY_ACC, indexId: IDX, from: addCompetence(anniversary.slice(0, 7), -12), to: addCompetence(anniversary.slice(0, 7), -1), monthlyBefore: 1000, monthlyAfter: after.monthlyTotal });
    const [a] = await amendmentsOf(c.id);
    expect(a).toMatchObject({ kind: "reajuste", status: "aplicado", requiresSignature: false, effectiveFrom: anniversary, source: "reajuste_automatico" });
    expect(a.readjust).toMatchObject({ anniversary, percent: STEADY_ACC });
    const events = await list<DomainEvent>(COLLECTIONS.events, { where: [["type", "==", "contract.readjusted"]] });
    expect(events.some((e) => e.payload?.contractId === c.id && e.payload?.anniversary === anniversary)).toBe(true);

    const second = await runContractReadjustments(NOW);
    expect(second.appliedContractIds).not.toContain(c.id);
    expect(await amendmentsOf(c.id)).toHaveLength(1);
    // A mesma data-base não entra por outro caminho.
    await expect(createAmendment({ contractId: c.id, effectiveFrom: anniversary, reason: "Reajuste repetido", requiresSignature: false }, ACTOR, { readjust: { ...a.readjust! } })).rejects.toThrow(/já foi decidido/);
  });

  it("renovação automática que cai na data-base leva o reajuste junto; a varredura não reajusta de novo", async () => {
    const end = daysFrom(TODAY, 20);
    const c = await contract("b", { termMonths: 12, startDate: iso(addMonthsClamped(end, -12)), endDate: iso(end), autoRenew: true, noticeDays: 30, readjustment: { type: "percentual", percent: 5 } });
    const renewed = await autoRenewContracts(NOW);
    expect(renewed.renewedContractIds).toContain(c.id);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.monthlyTotal).toBe(1050);
    expect(after.readjustmentLog).toMatchObject([{ anniversary: end, outcome: "aplicado", percent: 5 }]);
    const [a] = await amendmentsOf(c.id);
    expect(a.kind).toBe("renovacao");
    expect(a.readjust?.anniversary).toBe(end);
    const run = await runContractReadjustments(NOW);
    expect(run.appliedContractIds).not.toContain(c.id);
    expect((await getById<Contract>(COLLECTIONS.contracts, c.id))!.monthlyTotal).toBe(1050);
  });

  it("acumulado negativo com «manter o valor»: registra «mantido» sem aditivo", async () => {
    const anniversary = daysFrom(TODAY, -2);
    const c = await contract("c", { startDate: iso(addMonthsClamped(anniversary, -12)), endDate: iso(addMonthsClamped(anniversary, 12)), readjustment: { type: "indice", index: IDX_NEG } });
    const run = await runContractReadjustments(NOW);
    expect(run.held).toBeGreaterThanOrEqual(1);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.monthlyTotal).toBe(1000);
    expect(after.readjustmentLog).toMatchObject([{ anniversary, outcome: "mantido", percent: 0 }]);
    expect(after.readjustmentLog![0].rawPercent).toBeLessThan(0);
    expect(await amendmentsOf(c.id)).toHaveLength(0);
  });

  it("data-base passou da folga (45 dias): não aplica sozinho, abre tarefa; o Financeiro aplica com percentual informado", async () => {
    const anniversary = daysFrom(TODAY, -60);
    const c = await contract("d", { startDate: iso(addMonthsClamped(anniversary, -12)), endDate: iso(addMonthsClamped(anniversary, 12)), readjustment: { type: "percentual", percent: 6 } });
    const run = await runContractReadjustments(NOW);
    expect(run.appliedContractIds).not.toContain(c.id);
    const tasks = await list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", c.id]] });
    expect(tasks.some((t) => t.title.startsWith("Reajuste não aplicado"))).toBe(true);
    await runContractReadjustments(NOW);
    expect((await list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", c.id]] })).filter((t) => t.title.startsWith("Reajuste não aplicado"))).toHaveLength(1);
    const r = await applyReadjustmentNow({ contractId: c.id, anniversary, percent: 4 }, ACTOR);
    expect(r.monthlyAfter).toBe(1040);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.readjustmentLog).toMatchObject([{ anniversary, outcome: "aplicado", percent: 4, manual: true, byName: ACTOR.name }]);
  });

  it("dispensar a data-base: registra com o motivo e a próxima vira a do ano seguinte", async () => {
    const anniversary = daysFrom(TODAY, -3);
    const c = await contract("e", { startDate: iso(addMonthsClamped(anniversary, -12)), endDate: iso(addMonthsClamped(anniversary, 24)), readjustment: { type: "percentual", percent: 5 } });
    await expect(skipReadjustment({ contractId: c.id, anniversary: daysFrom(anniversary, 1), reason: "data errada" }, ACTOR)).rejects.toThrow(/recarregue/);
    await skipReadjustment({ contractId: c.id, anniversary, reason: "Negociado com o cliente" }, ACTOR);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.readjustmentLog).toMatchObject([{ anniversary, outcome: "dispensado", reason: "Negociado com o cliente" }]);
    const view = await getContractReadjustmentView(after, [], { hideValues: true });
    expect(view?.state.status).toBe("previsto");
    expect(view?.state.anniversary).toBe(addMonthsClamped(anniversary, 12));
    expect(view?.state.monthlyAfter).toBeUndefined();
    const run = await runContractReadjustments(NOW);
    expect(run.appliedContractIds).not.toContain(c.id);
  });

  it("índice desatualizado: espera (sem aplicar) e a tela diz o porquê", async () => {
    const anniversary = daysFrom(TODAY, -1);
    const c = await contract("f", { startDate: iso(addMonthsClamped(anniversary, -12)), endDate: iso(addMonthsClamped(anniversary, 12)), readjustment: { type: "indice", index: IDX_OLD } });
    const run = await runContractReadjustments(NOW);
    expect(run.appliedContractIds).not.toContain(c.id);
    const view = await getContractReadjustmentView(c, [], { hideValues: false });
    expect(view?.state.status).toBe("aguardando_indice");
    expect(view?.state.message).toMatch(/desatualizado/);
  });
});

describe("revisão: renovação, regras antigas e travas", () => {
  it("renovação na data-base com «Sem reajuste» registra a data-base como dispensada; a varredura não reajusta depois", async () => {
    const end = daysFrom(TODAY, 20);
    const c = await contract("g", { termMonths: 12, startDate: iso(addMonthsClamped(end, -12)), endDate: iso(end), readjustment: { type: "percentual", percent: 5 } });
    const a = await createAmendment({ contractId: c.id, effectiveFrom: end, reason: "Renovação negociada pelo CS sem reajuste", requiresSignature: false, renewal: { months: 12, readjustment: { type: "nenhum" } } }, ACTOR, { source: "renovacao_cs" });
    expect(a.readjust).toMatchObject({ anniversary: end, percent: 0, waived: true });
    expect(a.annualModel).toBe(true);
    await applyAmendment(a.id, ACTOR);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.monthlyTotal).toBe(1000);
    expect(after.readjustment).toMatchObject({ type: "percentual", percent: 5 });
    expect(after.readjustmentLog).toMatchObject([{ anniversary: end, outcome: "dispensado" }]);
    const later = await runContractReadjustments(new Date(Date.parse(iso(daysFrom(end, 1)))));
    expect(later.appliedContractIds).not.toContain(c.id);
  });

  it("escolha explícita de reajuste numa renovação fora da data-base é recusada com mensagem clara", async () => {
    const start = addMonthsClamped(TODAY, -5);
    const c = await contract("h", { termMonths: 6, startDate: iso(start), endDate: iso(addMonthsClamped(start, 6)), readjustment: { type: "indice", index: IDX } });
    await expect(createAmendment({ contractId: c.id, effectiveFrom: addMonthsClamped(start, 6), reason: "Renovação com 5% negociado", requiresSignature: false, renewal: { months: 12, readjustment: { type: "percentual", percent: 5 } } }, ACTOR, { source: "renovacao_cs" })).rejects.toThrow(/não cai numa data-base/);
  });

  it("renovação antiga (antes do reajuste anual) conta como data-base decidida: não reajusta de novo", async () => {
    const anniversary = daysFrom(TODAY, -10);
    const c = await contract("i", { termMonths: 12, startDate: iso(addMonthsClamped(anniversary, -12)), endDate: iso(addMonthsClamped(anniversary, 12)), readjustment: { type: "indice", index: IDX, pending: true } });
    await create<ContractAmendment>(
      COLLECTIONS.contractAmendments,
      { number: `${c.number}-A01`, contractId: c.id, clientId: CLIENT_ID, kind: "renovacao", status: "aplicado", effectiveFrom: anniversary, reason: "Renovação automática (antiga)", requiresSignature: false, before: {} as never, after: {} as never, changes: {}, readjustment: { type: "indice", index: IDX, pending: true } } as never,
      `cta_${c.id}_1`,
    );
    const run = await runContractReadjustments(NOW);
    expect(run.appliedContractIds).not.toContain(c.id);
  });

  it("o reajuste preserva a origem por aditivo (`since`) dos itens", async () => {
    const anniversary = daysFrom(TODAY, -4);
    const since = { amendmentId: `${RUN}_a`, installment: 7, setupInstallment: 2 };
    const c = await contract("j", {
      startDate: iso(addMonthsClamped(anniversary, -12)),
      endDate: iso(addMonthsClamped(anniversary, 12)),
      readjustment: { type: "percentual", percent: 10 },
      items: [
        { productId: `${RUN}_p1`, productName: "Sistema", quantity: 1, setupValue: 0, monthlyValue: 1000, hardwareValue: 0, discountPct: 0 },
        { productId: `${RUN}_p2`, productName: "Ponto", quantity: 1, setupValue: 0, monthlyValue: 100, hardwareValue: 0, discountPct: 0, since },
      ],
      monthlyTotal: 1100,
    });
    await runContractReadjustments(NOW);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.monthlyTotal).toBe(1210);
    expect(after.items.find((i) => i.productId === `${RUN}_p2`)?.since).toEqual(since);
  });

  it("regra trocada depois da data-base: não aplica sozinho, vira tarefa para o Financeiro decidir", async () => {
    const anniversary = daysFrom(TODAY, -6);
    const c = await contract("k", { startDate: iso(addMonthsClamped(anniversary, -12)), endDate: iso(addMonthsClamped(anniversary, 12)), readjustment: { type: "percentual", percent: 5 }, readjustmentRuleSince: daysFrom(TODAY, -2) });
    const run = await runContractReadjustments(NOW);
    expect(run.appliedContractIds).not.toContain(c.id);
    expect((await list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", c.id]] })).some((t) => t.title.startsWith("Reajuste não aplicado"))).toBe(true);
  });

  it("cobrança anual: reajusta até 30 dias antes da data-base (vigente nela)", async () => {
    const anniversary = daysFrom(TODAY, 20);
    const c = await contract("l", { recurrence: "anual", startDate: iso(addMonthsClamped(anniversary, -12)), endDate: iso(addMonthsClamped(anniversary, 24)), readjustment: { type: "percentual", percent: 5 } });
    const run = await runContractReadjustments(NOW);
    expect(run.appliedContractIds).toContain(c.id);
    const [a] = await amendmentsOf(c.id);
    expect(a.effectiveFrom).toBe(anniversary);
  });

  it("percentual acima de 25% não é aplicado sozinho", async () => {
    const anniversary = daysFrom(TODAY, -3);
    const c = await contract("m", { startDate: iso(addMonthsClamped(anniversary, -12)), endDate: iso(addMonthsClamped(anniversary, 12)), readjustment: { type: "percentual", percent: 30 } });
    const run = await runContractReadjustments(NOW);
    expect(run.appliedContractIds).not.toContain(c.id);
    const view = await getContractReadjustmentView(c, [], { hideValues: false });
    expect(view?.state.message).toMatch(/fora do esperado/);
  });

  it("sem «ver valores»: o contrato redigido não leva as mensalidades do registro do reajuste", async () => {
    const c = (await getById<Contract>(COLLECTIONS.contracts, `${RUN}_a`))!;
    expect(c.readjustmentLog?.[0].monthlyAfter).toBeGreaterThan(0);
    const redacted = redactContract(c);
    expect(redacted.readjustmentLog?.[0]).not.toHaveProperty("monthlyBefore");
    expect(redacted.readjustmentLog?.[0]).not.toHaveProperty("monthlyAfter");
  });
});

describe("cadastro de índices", () => {
  it("lançamento manual só em mês que a fonte não trouxe; desativar exige nenhum contrato ativo", async () => {
    const missing = addCompetence(MONTH, -1);
    await setReadjustmentIndexValue({ indexId: IDX_OLD, competence: missing, pct: 0.55 }, ACTOR);
    const idx = (await getById<ReadjustmentIndex>(COLLECTIONS.readjustmentIndices, IDX_OLD))!;
    expect(idx.values[missing]).toMatchObject({ pct: 0.55, source: "manual", by: ACTOR.id });
    await expect(setReadjustmentIndexValue({ indexId: IDX_OLD, competence: addCompetence(MONTH, -9), pct: 1 }, ACTOR)).rejects.toThrow(/fonte oficial/);
    await expect(setReadjustmentIndexValue({ indexId: IDX_OLD, competence: addCompetence(MONTH, 1), pct: 1 }, ACTOR)).rejects.toThrow(/ainda não chegou/);
    await expect(setReadjustmentIndexArchived(IDX_OLD, true, "não usamos mais", ACTOR)).rejects.toThrow(/contrato\(s\) ativo\(s\)/);
  });
});
