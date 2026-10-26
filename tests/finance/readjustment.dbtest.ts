/**
 * Reajuste anual no banco (npm run test:db): varredura `reajustes_contratos` aplicando o acumulado do índice por aditivo
 * "reajuste" (registro da data-base, mensalidade, evento), idempotência, renovação automática que cai na data-base
 * levando o reajuste junto, índice negativo «mantido», atraso além da folga (tarefa ao Financeiro, sem aplicar),
 * aplicar com percentual informado, dispensar, e o cadastro de índices (lançamento manual, valor oficial vence,
 * desativar em uso).
 *
 * Datas relativas a hoje (o teste roda em qualquer dia; a data-base sai do próprio início da vigência, como no
 * servidor — 29/02 vira 28/02). Isolamento: cliente, contratos e índices com prefixo próprio, apagados no fim; as
 * varreduras rodam só para o cliente do teste (o banco local pode ter o seed).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docdb } from "@/server/docdb";
import { create, getById, list, update } from "@/server/db";
import { dateKey } from "@/lib/format";
import { addCompetence, addMonthsClamped, anniversaryOf } from "@/domain/readjustment";
import { COLLECTIONS, type Billing, type Client, type Contract, type ContractAmendment, type DomainEvent, type ReadjustmentIndex, type Task } from "@/domain/types";
import { applyReadjustmentNow, getContractReadjustmentView, runContractReadjustments as runAll, skipReadjustment } from "@/server/finance/readjustments";
import { autoRenewContracts as renewAll, renewalReadjustmentText } from "@/server/finance/renewals";
import { billingDocId } from "@/server/finance/billing";
import { createTaskInternal } from "@/server/tasks/service";
import { applyAmendment, createAmendment } from "@/server/finance/amendments";
import { redactContract } from "@/server/finance/redact";
import { setReadjustmentIndexArchived, setReadjustmentIndexValue } from "@/server/finance-registry/indices";

const RUN = `t${Date.now().toString(36)}`;
const ACTOR = { id: `${RUN}_fin`, name: "Financeiro Teste" };
const CLIENT_ID = `${RUN}_cli`;
const IDX = `${RUN}-idx`;
const IDX_NEG = `${RUN}-neg`;
const IDX_OLD = `${RUN}-old`;
const IDX_LATE = `${RUN}-late`;
const IDX_CRASH = `${RUN}-crash`;
const INDEX_IDS = [IDX, IDX_NEG, IDX_OLD, IDX_LATE, IDX_CRASH];
const contractIds: string[] = [];

const NOW = new Date();
const TODAY = dateKey(NOW);
const MONTH = TODAY.slice(0, 7);
const daysFrom = (key: string, days: number) => new Date(Date.parse(`${key}T12:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
const iso = (key: string) => `${key}T12:00:00.000Z`;
const at = (key: string) => new Date(Date.parse(iso(key)));
/** Início da vigência para a 1ª data-base cair perto de hoje + `days`, e a data-base que o servidor calcula a partir dele. */
const baseFrom = (days: number) => {
  const start = addMonthsClamped(daysFrom(TODAY, days), -12);
  return { start, anniversary: anniversaryOf(start, 1) };
};
const runContractReadjustments = (now: Date) => runAll(now, { clientId: CLIENT_ID });
const autoRenewContracts = (now: Date) => renewAll(now, { clientId: CLIENT_ID });

/** 14 meses de 0,4% até o mês passado: acumulado de 12 meses = 1,004^12 − 1. */
const STEADY = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [addCompetence(MONTH, -1 - i), { pct: 0.4, source: "manual" as const, at: iso(TODAY) }]));
const STEADY_ACC = Math.round(((1.004 ** 12 - 1) * 100 + Number.EPSILON) * 100) / 100;
const NEGATIVE = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [addCompetence(MONTH, -1 - i), { pct: -0.2, source: "manual" as const, at: iso(TODAY) }]));
/** Série errada para baixo: 12 meses de −3% (acumulado ≈ −30,6%). */
const CRASH = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [addCompetence(MONTH, -1 - i), { pct: -3, source: "manual" as const, at: iso(TODAY) }]));

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
  await create<ReadjustmentIndex>(COLLECTIONS.readjustmentIndices, { ...base, name: `Atrasado ${RUN}`, source: { kind: "manual" }, values: STEADY } as never, IDX_LATE);
  await create<ReadjustmentIndex>(COLLECTIONS.readjustmentIndices, { ...base, name: `Despenca ${RUN}`, source: { kind: "manual" }, values: CRASH } as never, IDX_CRASH);
});

afterAll(async () => {
  const sql = docdb.sql();
  if (contractIds.length) {
    await sql`delete from interos.contract_amendments where data->>'contractId' = any(${contractIds})`;
    await sql`delete from interos.billing where data->>'contractId' = any(${contractIds})`;
    await sql`delete from interos.contracts where id = any(${contractIds})`;
  }
  await sql`delete from interos.client_products where data->>'clientId' = ${CLIENT_ID}`;
  // Avisos «nova tarefa» das tarefas de reajuste atrasado criadas pelo teste.
  await sql`delete from interos.notifications where data->>'entityId' in (select id from interos.tasks where data->>'clientId' = ${CLIENT_ID})`;
  await sql`delete from interos.tasks where data->>'clientId' = ${CLIENT_ID}`;
  await sql`delete from interos.events where data->>'clientId' = ${CLIENT_ID}`;
  await sql`delete from interos.timeline_events where data->>'clientId' = ${CLIENT_ID}`;
  await sql`delete from interos.notifications where data->>'entityId' = any(${contractIds})`;
  await sql`delete from interos.events where data->'payload'->>'indexId' = any(${INDEX_IDS})`;
  await sql`delete from interos.readjustment_indices where id = any(${INDEX_IDS})`;
  await sql`delete from interos.clients where id = ${CLIENT_ID}`;
});

describe("reajuste anual na data-base", () => {
  it("aplica o acumulado do índice por aditivo «reajuste» na data-base que chegou e não repete", async () => {
    const { start, anniversary } = baseFrom(-5);
    const c = await contract("a", { startDate: iso(start), endDate: iso(addMonthsClamped(start, 24)), readjustment: { type: "indice", index: IDX } });
    // Mensalidade em aberto que venceu ontem (a rotina de vencidas ainda não marcou) não é refeita; a futura é.
    const billing = (n: number, due: string) => create<Billing>(COLLECTIONS.billing, { clientId: CLIENT_ID, contractId: c.id, type: "mensalidade", competence: due.slice(0, 7), installment: n, amount: 1000, dueDate: iso(due), status: "aberta", method: "boleto" } as never, billingDocId(c.id, "mensalidade", n));
    await billing(1, daysFrom(TODAY, -1));
    await billing(2, daysFrom(TODAY, 25));
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
    const billings = await list<Billing>(COLLECTIONS.billing, { where: [["contractId", "==", c.id]] });
    expect(billings.find((b) => b.id === billingDocId(c.id, "mensalidade", 1))).toMatchObject({ status: "aberta", amount: 1000 });
    expect(billings.find((b) => b.id === billingDocId(c.id, "mensalidade", 2))?.status).toBe("cancelada");
    expect(billings.find((b) => b.installment === 2 && b.status === "aberta")?.amount).toBe(after.monthlyTotal);

    const second = await runContractReadjustments(NOW);
    expect(second.appliedContractIds).not.toContain(c.id);
    expect(await amendmentsOf(c.id)).toHaveLength(1);
    // A mesma data-base não entra por outro caminho.
    await expect(createAmendment({ contractId: c.id, effectiveFrom: anniversary, reason: "Reajuste repetido", requiresSignature: false }, ACTOR, { readjust: { ...a.readjust! } })).rejects.toThrow(/já foi decidido/);
  });

  it("renovação automática que cai na data-base leva o reajuste junto; a varredura não reajusta de novo", async () => {
    const { start, anniversary: end } = baseFrom(20);
    const c = await contract("b", { termMonths: 12, startDate: iso(start), endDate: iso(end), autoRenew: true, noticeDays: 30, readjustment: { type: "percentual", percent: 5 } });
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
    const { start, anniversary } = baseFrom(-2);
    const c = await contract("c", { startDate: iso(start), endDate: iso(addMonthsClamped(start, 24)), readjustment: { type: "indice", index: IDX_NEG } });
    const run = await runContractReadjustments(NOW);
    expect(run.held).toBeGreaterThanOrEqual(1);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.monthlyTotal).toBe(1000);
    expect(after.readjustmentLog).toMatchObject([{ anniversary, outcome: "mantido", percent: 0 }]);
    expect(after.readjustmentLog![0].rawPercent).toBeLessThan(0);
    expect(await amendmentsOf(c.id)).toHaveLength(0);
  });

  it("data-base passou da folga (45 dias): não aplica sozinho, abre tarefa; o Financeiro aplica com percentual informado", async () => {
    const { start, anniversary } = baseFrom(-60);
    const c = await contract("d", { startDate: iso(start), endDate: iso(addMonthsClamped(start, 24)), readjustment: { type: "percentual", percent: 6 } });
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
    // Data-base decidida: a tarefa de atraso dela é concluída sozinha.
    const late = (await list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", c.id]] })).filter((t) => t.title.startsWith("Reajuste não aplicado"));
    expect(late.map((t) => t.status)).toEqual(["concluida"]);
  });

  it("dispensar a data-base: registra com o motivo e a próxima vira a do ano seguinte", async () => {
    const { start, anniversary } = baseFrom(-3);
    const c = await contract("e", { startDate: iso(start), endDate: iso(addMonthsClamped(start, 36)), readjustment: { type: "percentual", percent: 5 } });
    await expect(skipReadjustment({ contractId: c.id, anniversary: daysFrom(anniversary, 1), reason: "data errada" }, ACTOR)).rejects.toThrow(/recarregue/);
    await skipReadjustment({ contractId: c.id, anniversary, reason: "Negociado com o cliente" }, ACTOR);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.readjustmentLog).toMatchObject([{ anniversary, outcome: "dispensado", reason: "Negociado com o cliente" }]);
    const view = await getContractReadjustmentView(after, [], { hideValues: true });
    expect(view?.state.status).toBe("previsto");
    expect(view?.state.anniversary).toBe(anniversaryOf(start, 2));
    expect(view?.state.monthlyAfter).toBeUndefined();
    // Tarefa de atraso de outra data-base (já decidida ou que ficou para trás) é cancelada pela rotina.
    const stale = await createTaskInternal({ title: `Reajuste não aplicado: ACME ${RUN} (data-base 10/01/2020)`, clientId: CLIENT_ID, departmentId: "financeiro", priority: "alta", processType: "contract", processId: c.id, origin: "automacao" }, ACTOR);
    const run = await runContractReadjustments(NOW);
    expect(run.appliedContractIds).not.toContain(c.id);
    expect((await getById<Task>(COLLECTIONS.tasks, stale.id))?.status).toBe("cancelada");
  });

  it("índice desatualizado: espera (sem aplicar) e a tela diz o porquê", async () => {
    const { start } = baseFrom(-1);
    const c = await contract("f", { startDate: iso(start), endDate: iso(addMonthsClamped(start, 24)), readjustment: { type: "indice", index: IDX_OLD } });
    const run = await runContractReadjustments(NOW);
    expect(run.appliedContractIds).not.toContain(c.id);
    const view = await getContractReadjustmentView(c, [], { hideValues: false });
    expect(view?.state.status).toBe("aguardando_indice");
    expect(view?.state.message).toMatch(/desatualizado/);
  });
});

describe("revisão: renovação, regras antigas e travas", () => {
  it("renovação na data-base com «Sem reajuste» registra a data-base como dispensada; a varredura não reajusta depois", async () => {
    const { start, anniversary: end } = baseFrom(20);
    const c = await contract("g", { termMonths: 12, startDate: iso(start), endDate: iso(end), readjustment: { type: "percentual", percent: 5 } });
    const a = await createAmendment({ contractId: c.id, effectiveFrom: end, reason: "Renovação negociada pelo CS sem reajuste", requiresSignature: false, renewal: { months: 12, readjustment: { type: "nenhum" } } }, ACTOR, { source: "renovacao_cs" });
    expect(a.readjust).toMatchObject({ anniversary: end, percent: 0, waived: true });
    expect(a.annualModel).toBe(true);
    expect(renewalReadjustmentText(a)).toMatch(/dispensado na renovação/);
    await applyAmendment(a.id, ACTOR);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.monthlyTotal).toBe(1000);
    expect(after.readjustment).toMatchObject({ type: "percentual", percent: 5 });
    expect(after.readjustmentLog).toMatchObject([{ anniversary: end, outcome: "dispensado" }]);
    const later = await runContractReadjustments(at(daysFrom(end, 1)));
    expect(later.appliedContractIds).not.toContain(c.id);
  });

  it("escolha explícita de reajuste numa renovação fora da data-base é recusada com mensagem clara", async () => {
    const start = addMonthsClamped(TODAY, -5);
    const c = await contract("h", { termMonths: 6, startDate: iso(start), endDate: iso(addMonthsClamped(start, 6)), readjustment: { type: "indice", index: IDX } });
    await expect(createAmendment({ contractId: c.id, effectiveFrom: addMonthsClamped(start, 6), reason: "Renovação com 5% negociado", requiresSignature: false, renewal: { months: 12, readjustment: { type: "percentual", percent: 5 } } }, ACTOR, { source: "renovacao_cs" })).rejects.toThrow(/não cai numa data-base/);
    // «Sem reajuste» também: senão a rotina reajustaria na data-base seguinte, contra o combinado.
    await expect(createAmendment({ contractId: c.id, effectiveFrom: addMonthsClamped(start, 6), reason: "Renovação sem reajuste", requiresSignature: false, renewal: { months: 12, readjustment: { type: "nenhum" } } }, ACTOR, { source: "renovacao_cs" })).rejects.toThrow(/não cai numa data-base/);
    // «Conforme o contrato» (a própria regra) renova normalmente.
    const ok = await createAmendment({ contractId: c.id, effectiveFrom: addMonthsClamped(start, 6), reason: "Renovação conforme o contrato", requiresSignature: false, renewal: { months: 12, readjustment: { type: "indice", index: IDX } } }, ACTOR, { source: "renovacao_cs" });
    expect(ok.readjust).toBeUndefined();
  });

  it("renovação antiga (antes do reajuste anual) conta como data-base decidida: não reajusta de novo", async () => {
    const { start, anniversary } = baseFrom(-10);
    const c = await contract("i", { termMonths: 12, startDate: iso(start), endDate: iso(addMonthsClamped(start, 24)), readjustment: { type: "indice", index: IDX, pending: true } });
    await create<ContractAmendment>(
      COLLECTIONS.contractAmendments,
      { number: `${c.number}-A01`, contractId: c.id, clientId: CLIENT_ID, kind: "renovacao", status: "aplicado", effectiveFrom: anniversary, reason: "Renovação automática (antiga)", requiresSignature: false, before: {} as never, after: {} as never, changes: {}, readjustment: { type: "indice", index: IDX, pending: true } } as never,
      `cta_${c.id}_1`,
    );
    const run = await runContractReadjustments(NOW);
    expect(run.appliedContractIds).not.toContain(c.id);
  });

  it("o reajuste preserva a origem por aditivo (`since`) dos itens", async () => {
    const { start } = baseFrom(-4);
    const since = { amendmentId: `${RUN}_a`, installment: 7, setupInstallment: 2 };
    const c = await contract("j", {
      startDate: iso(start),
      endDate: iso(addMonthsClamped(start, 24)),
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
    const { start } = baseFrom(-6);
    const c = await contract("k", { startDate: iso(start), endDate: iso(addMonthsClamped(start, 24)), readjustment: { type: "percentual", percent: 5 }, readjustmentRuleSince: daysFrom(TODAY, -2) });
    const run = await runContractReadjustments(NOW);
    expect(run.appliedContractIds).not.toContain(c.id);
    expect((await list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", c.id]] })).some((t) => t.title.startsWith("Reajuste não aplicado"))).toBe(true);
  });

  it("cobrança anual: reajusta até 30 dias antes da data-base (vigente nela) e refaz a parcela do ano que vence antes dela", async () => {
    // Data-base no dia 3 de daqui a 2 meses; a rotina roda 10 dias antes; a parcela anual vence 5 dias antes (mês anterior).
    const anniversary = `${addCompetence(MONTH, 2)}-03`;
    const start = addMonthsClamped(anniversary, -12);
    const c = await contract("l", { recurrence: "anual", startDate: iso(start), endDate: iso(addMonthsClamped(start, 36)), readjustment: { type: "percentual", percent: 5 } });
    const due = daysFrom(anniversary, -5);
    await create<Billing>(COLLECTIONS.billing, { clientId: CLIENT_ID, contractId: c.id, type: "mensalidade", competence: due.slice(0, 7), installment: 2, amount: 12000, dueDate: iso(due), status: "aberta", method: "boleto" } as never, billingDocId(c.id, "mensalidade", 2));
    const run = await runContractReadjustments(at(daysFrom(anniversary, -10)));
    expect(run.appliedContractIds).toContain(c.id);
    const [a] = await amendmentsOf(c.id);
    expect(a.effectiveFrom).toBe(anniversary);
    const billings = await list<Billing>(COLLECTIONS.billing, { where: [["contractId", "==", c.id]] });
    expect(billings.find((b) => b.id === billingDocId(c.id, "mensalidade", 2))?.status).toBe("cancelada");
    // Parcela anual = 12 × a mensalidade reajustada.
    expect(billings.find((b) => b.installment === 2 && b.status === "aberta")?.amount).toBe(12600);
  });

  it("percentual acima de 25% não é aplicado sozinho", async () => {
    const { start } = baseFrom(-3);
    const c = await contract("m", { startDate: iso(start), endDate: iso(addMonthsClamped(start, 24)), readjustment: { type: "percentual", percent: 30 } });
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

describe("revisão 2: renovação com as travas da rotina, série errada e decisões", () => {
  it("renovação de contrato SEM reajuste na data-base não registra «dispensado» (ninguém escolheu)", async () => {
    const { start, anniversary: end } = baseFrom(15);
    const c = await contract("n", { termMonths: 12, startDate: iso(start), endDate: iso(end), autoRenew: true, noticeDays: 30, readjustment: { type: "nenhum" } });
    const renewed = await autoRenewContracts(NOW);
    expect(renewed.renewedContractIds).toContain(c.id);
    const [a] = await amendmentsOf(c.id);
    expect(a.readjust).toBeUndefined();
    expect((await getById<Contract>(COLLECTIONS.contracts, c.id))!.readjustmentLog ?? []).toHaveLength(0);
    expect(renewalReadjustmentText(a)).toBe("nenhum nesta renovação");
  });

  it("renovação automática com acumulado acima de 25%: renova sem reajuste e a data-base vira tarefa ao Financeiro", async () => {
    const { start, anniversary: end } = baseFrom(15);
    const c = await contract("o", { termMonths: 12, startDate: iso(start), endDate: iso(end), autoRenew: true, noticeDays: 30, readjustment: { type: "percentual", percent: 30 } });
    await autoRenewContracts(NOW);
    const [a] = await amendmentsOf(c.id);
    expect(a.kind).toBe("renovacao");
    expect(a.readjust).toBeUndefined();
    expect(renewalReadjustmentText(a)).toMatch(/fica para o Financeiro/);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.monthlyTotal).toBe(1000);
    const run = await runContractReadjustments(at(daysFrom(end, 1)));
    expect(run.appliedContractIds).not.toContain(c.id);
    expect((await list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", c.id]] })).some((t) => t.title.startsWith("Reajuste não aplicado"))).toBe(true);
  });

  it("renovação antes da data-base com o mês anterior a ela ainda não publicado: fica «aguardando» e a rotina aplica na data-base com o mês certo", async () => {
    // Data-base no dia 5 de daqui a 2 meses: o mês anterior a ela (daqui a 1 mês) ainda não saiu.
    const end = `${addCompetence(MONTH, 2)}-05`;
    const start = addMonthsClamped(end, -12);
    const c = await contract("p", { termMonths: 12, startDate: iso(start), endDate: iso(end), autoRenew: true, noticeDays: 90, readjustment: { type: "indice", index: IDX_LATE } });
    const renewed = await autoRenewContracts(NOW);
    expect(renewed.renewedContractIds).toContain(c.id);
    expect(renewed.indexPending).toBeGreaterThanOrEqual(1);
    const [a] = await amendmentsOf(c.id);
    expect(a.readjust).toBeUndefined();
    expect(a.readjustment).toMatchObject({ type: "indice", index: IDX_LATE, indexName: `Atrasado ${RUN}`, pending: true });
    expect((await getById<Contract>(COLLECTIONS.contracts, c.id))!.readjustment?.pending).toBe(true);
    // Os meses saem; na data-base a rotina aplica o acumulado até o mês anterior a ela.
    const idx = (await getById<ReadjustmentIndex>(COLLECTIONS.readjustmentIndices, IDX_LATE))!;
    await update<ReadjustmentIndex>(COLLECTIONS.readjustmentIndices, IDX_LATE, { values: { ...idx.values, [MONTH]: { pct: 0.4, source: "manual", at: iso(TODAY) }, [addCompetence(MONTH, 1)]: { pct: 0.4, source: "manual", at: iso(TODAY) } } });
    const run = await runContractReadjustments(at(daysFrom(end, 1)));
    expect(run.appliedContractIds).toContain(c.id);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.readjustmentLog).toMatchObject([{ anniversary: end, outcome: "aplicado", to: addCompetence(MONTH, 1) }]);
    expect(after.readjustment?.pending).toBeUndefined();
  });

  it("acumulado negativo absurdo com «manter»: não vira «sem aumento» sozinho (trava pelo acumulado bruto)", async () => {
    const { start, anniversary } = baseFrom(-2);
    const c = await contract("q", { startDate: iso(start), endDate: iso(addMonthsClamped(start, 24)), readjustment: { type: "indice", index: IDX_CRASH } });
    const run = await runContractReadjustments(NOW);
    expect(run.appliedContractIds).not.toContain(c.id);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.readjustmentLog ?? []).toHaveLength(0);
    const view = await getContractReadjustmentView(after, [], { hideValues: false });
    expect(view?.state).toMatchObject({ status: "bloqueado", anniversary });
    expect(view?.state.message).toMatch(/fora do esperado/);
  });

  it("«sem aumento» antes da data-base é recusado (o índice ainda pode mudar); dispensar contrato cancelado também", async () => {
    const { start, anniversary } = baseFrom(50);
    const c = await contract("r", { startDate: iso(start), endDate: iso(addMonthsClamped(start, 24)), readjustment: { type: "indice", index: IDX_NEG } });
    await expect(applyReadjustmentNow({ contractId: c.id, anniversary }, ACTOR)).rejects.toThrow(/sem aumento/);
    expect((await getById<Contract>(COLLECTIONS.contracts, c.id))!.readjustmentLog ?? []).toHaveLength(0);
    await update<Contract>(COLLECTIONS.contracts, c.id, { status: "cancelado" });
    await expect(skipReadjustment({ contractId: c.id, anniversary, reason: "cancelado" }, ACTOR)).rejects.toThrow(/liberado/);
  });

  it("aditivo de condições que só reenvia a regra de um contrato antigo (sem o nome do índice) não é mudança", async () => {
    const { start } = baseFrom(100);
    const c = await contract("s", { startDate: iso(start), endDate: iso(addMonthsClamped(start, 24)), readjustment: { type: "indice", index: IDX } });
    await expect(createAmendment({ contractId: c.id, effectiveFrom: TODAY, reason: "Sem mudança", requiresSignature: false, conditions: { readjustment: { type: "indice", index: IDX } } }, ACTOR)).rejects.toThrow(/Nenhuma alteração/);
    // Contrato «aguardando o índice»: reenviar a mesma regra também não é mudança (o «aguardando» continua).
    const p = await contract("s2", { startDate: iso(start), endDate: iso(addMonthsClamped(start, 24)), readjustment: { type: "indice", index: IDX, indexName: `Índice ${RUN}`, pending: true } });
    await expect(createAmendment({ contractId: p.id, effectiveFrom: TODAY, reason: "Sem mudança", requiresSignature: false, conditions: { readjustment: { type: "indice", index: IDX } } }, ACTOR)).rejects.toThrow(/Nenhuma alteração/);
  });
});

describe("revisão 3: ordem das datas-base, regra incluída depois", () => {
  // 1ª data-base daqui a 10 dias (pendente); a renovação, com vigência no fim (2ª data-base), vem depois dela.
  const start = addMonthsClamped(daysFrom(TODAY, 10), -12);
  const first = anniversaryOf(start, 1);
  const second = anniversaryOf(start, 2);

  it("data-base anterior pendente segura a da renovação: escolha explícita recusada com o motivo certo, «conforme» deixa para a rotina", async () => {
    const c = await contract("t", { termMonths: 24, startDate: iso(start), endDate: iso(second), readjustment: { type: "percentual", percent: 5 } });
    await expect(createAmendment({ contractId: c.id, effectiveFrom: second, reason: "Renovação sem reajuste", requiresSignature: false, renewal: { months: 12, readjustment: { type: "nenhum" } } }, ACTOR, { source: "renovacao_cs" })).rejects.toThrow(/ainda não foi decidida/);
    const a = await createAmendment({ contractId: c.id, effectiveFrom: second, reason: "Renovação conforme o contrato", requiresSignature: false, renewal: { months: 12 } }, ACTOR, { source: "renovacao_cs" });
    expect(a.readjust).toBeUndefined();
    expect(renewalReadjustmentText(a)).toMatch(new RegExp(`espera a decisão da data-base ${first.split("-").reverse().join("/")}`));
  });

  it("contrato SEM regra: o percentual negociado na renovação vale para a data-base dela (nada fica pendente antes)", async () => {
    const c = await contract("u", { termMonths: 24, startDate: iso(start), endDate: iso(second), readjustment: { type: "nenhum" } });
    const a = await createAmendment({ contractId: c.id, effectiveFrom: second, reason: "Renovação com 5% negociado", requiresSignature: false, renewal: { months: 12, readjustment: { type: "percentual", percent: 5 } } }, ACTOR, { source: "renovacao_cs" });
    expect(a.readjust).toMatchObject({ anniversary: second, percent: 5 });
  });

  it("regra incluída por aditivo num contrato sem reajuste: as datas-base anteriores não viram pendência", async () => {
    const { start: s0, anniversary: past } = baseFrom(-5);
    const c = await contract("v", { startDate: iso(s0), endDate: iso(addMonthsClamped(s0, 36)), readjustment: { type: "nenhum" } });
    const a = await createAmendment({ contractId: c.id, effectiveFrom: TODAY, reason: "Inclui o reajuste", requiresSignature: false, conditions: { readjustment: { type: "indice", index: IDX } } }, ACTOR);
    await applyAmendment(a.id, ACTOR);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.readjustmentGaps).toEqual([{ to: TODAY }]);
    expect(after.readjustmentRuleSince).toBeUndefined();
    const view = await getContractReadjustmentView(after, await amendmentsOf(c.id), { hideValues: false });
    expect(view?.state.anniversary).not.toBe(past);
    // A próxima é a do ano que vem (o índice do período dela ainda não saiu): nada travado nem pendente agora.
    expect(view?.state).toMatchObject({ due: false, anniversary: anniversaryOf(s0, 2) });
    expect(["previsto", "aguardando_indice"]).toContain(view?.state.status);
    const run = await runContractReadjustments(NOW);
    expect(run.appliedContractIds).not.toContain(c.id);
    expect((await list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", c.id]] })).filter((t) => t.title.startsWith("Reajuste não aplicado"))).toHaveLength(0);
  });

  it("cobrança única que passa a recorrente com a mesma regra: começa a acompanhar na vigência do aditivo", async () => {
    const { start: s0, anniversary: past } = baseFrom(-5);
    const c = await contract("w", { recurrence: "unico", startDate: iso(s0), endDate: iso(addMonthsClamped(s0, 36)), readjustment: { type: "indice", index: IDX } });
    const a = await createAmendment({ contractId: c.id, effectiveFrom: TODAY, reason: "Passa a mensal", requiresSignature: false, conditions: { recurrence: "mensal" } }, ACTOR);
    await applyAmendment(a.id, ACTOR);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.readjustmentGaps).toEqual([{ to: TODAY }]);
    const view = await getContractReadjustmentView(after, await amendmentsOf(c.id), { hideValues: false });
    expect(view?.state.anniversary).not.toBe(past);
    expect(view?.state.due).toBe(false);
  });

  it("contrato sem regra com reajuste só na renovação: incluir a regra depois não cria pendência (o registro da renovação não conta como regra)", async () => {
    const c = await contract("u2", { termMonths: 24, startDate: iso(start), endDate: iso(second), readjustment: { type: "nenhum" } });
    const r = await createAmendment({ contractId: c.id, effectiveFrom: second, reason: "Renovação com 5% negociado", requiresSignature: false, renewal: { months: 12, readjustment: { type: "percentual", percent: 5 } } }, ACTOR, { source: "renovacao_cs" });
    await applyAmendment(r.id, ACTOR);
    const inc = await createAmendment({ contractId: c.id, effectiveFrom: TODAY, reason: "Inclui o reajuste", requiresSignature: false, conditions: { readjustment: { type: "indice", index: IDX } } }, ACTOR);
    await applyAmendment(inc.id, ACTOR);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.readjustmentRuleSince).toBeUndefined();
    expect(after.readjustmentGaps).toEqual([{ to: TODAY }]);
  });

  it("data-base que cai no período sem regra (removida e reincluída) não vira pendência", async () => {
    const { start: s0, anniversary: inside } = baseFrom(-5);
    const c = await contract("x2", { startDate: iso(s0), endDate: iso(addMonthsClamped(s0, 36)), readjustment: { type: "percentual", percent: 5 } });
    const off = await createAmendment({ contractId: c.id, effectiveFrom: daysFrom(TODAY, -10), reason: "Remove o reajuste", requiresSignature: false, conditions: { readjustment: { type: "nenhum" } } }, ACTOR);
    await applyAmendment(off.id, ACTOR);
    const on = await createAmendment({ contractId: c.id, effectiveFrom: TODAY, reason: "Volta o reajuste", requiresSignature: false, conditions: { readjustment: { type: "percentual", percent: 5 } } }, ACTOR);
    await applyAmendment(on.id, ACTOR);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.readjustmentGaps).toEqual([{ from: daysFrom(TODAY, -10), to: TODAY }]);
    const view = await getContractReadjustmentView(after, await amendmentsOf(c.id), { hideValues: false });
    expect(view?.state.anniversary).not.toBe(inside);
    expect(view?.state.due).toBe(false);
    await runContractReadjustments(NOW);
    expect((await list<Task>(COLLECTIONS.tasks, { where: [["processId", "==", c.id]] })).filter((t) => t.title.startsWith("Reajuste não aplicado"))).toHaveLength(0);
  });

  it("regra removida: o reajuste negociado na renovação ainda vale para a data-base dela", async () => {
    const { start: s0, anniversary: end } = baseFrom(20);
    const c = await contract("x4", { termMonths: 12, startDate: iso(s0), endDate: iso(end), readjustment: { type: "percentual", percent: 5 } });
    const off = await createAmendment({ contractId: c.id, effectiveFrom: TODAY, reason: "Remove o reajuste", requiresSignature: false, conditions: { readjustment: { type: "nenhum" } } }, ACTOR);
    await applyAmendment(off.id, ACTOR);
    const r = await createAmendment({ contractId: c.id, effectiveFrom: end, reason: "Renovação com 4% negociado", requiresSignature: false, renewal: { months: 12, readjustment: { type: "percentual", percent: 4 } } }, ACTOR, { source: "renovacao_cs" });
    expect(r.readjust).toMatchObject({ anniversary: end, percent: 4 });
    // «Conforme o contrato» (sem regra agora) não reajusta.
    const d = await contract("x5", { termMonths: 12, startDate: iso(s0), endDate: iso(end), readjustment: { type: "percentual", percent: 5 } });
    const off2 = await createAmendment({ contractId: d.id, effectiveFrom: TODAY, reason: "Remove o reajuste", requiresSignature: false, conditions: { readjustment: { type: "nenhum" } } }, ACTOR);
    await applyAmendment(off2.id, ACTOR);
    const r2 = await createAmendment({ contractId: d.id, effectiveFrom: end, reason: "Renovação conforme o contrato", requiresSignature: false, renewal: { months: 12 } }, ACTOR, { source: "renovacao_cs" });
    expect(r2.readjust).toBeUndefined();
  });

  it("regra removida com data-base anterior pendente: a escolha da renovação não passa por cima dela", async () => {
    const c = await contract("x6", { termMonths: 24, startDate: iso(start), endDate: iso(second), readjustment: { type: "percentual", percent: 5 } });
    const off = await createAmendment({ contractId: c.id, effectiveFrom: daysFrom(first, 10), reason: "Remove o reajuste", requiresSignature: false, conditions: { readjustment: { type: "nenhum" } } }, ACTOR);
    await applyAmendment(off.id, ACTOR);
    await expect(createAmendment({ contractId: c.id, effectiveFrom: second, reason: "Renovação com 4%", requiresSignature: false, renewal: { months: 12, readjustment: { type: "percentual", percent: 4 } } }, ACTOR, { source: "renovacao_cs" })).rejects.toThrow(/regra de reajuste anterior, ainda não foi decidida/);
  });

  it("data-base num período sem regra: escolher a mesma regra guardada no contrato também vale", async () => {
    const { start: s0, anniversary: end } = baseFrom(20);
    const c = await contract("x7", { termMonths: 12, startDate: iso(s0), endDate: iso(end), readjustment: { type: "percentual", percent: 5 } });
    const once = await createAmendment({ contractId: c.id, effectiveFrom: TODAY, reason: "Cobrança única", requiresSignature: false, conditions: { recurrence: "unico" } }, ACTOR);
    await applyAmendment(once.id, ACTOR);
    const r = await createAmendment({ contractId: c.id, effectiveFrom: end, reason: "Renovação com 5%", requiresSignature: false, renewal: { months: 12, readjustment: { type: "percentual", percent: 5 } } }, ACTOR, { source: "renovacao_cs" });
    expect(r.readjust).toMatchObject({ anniversary: end, percent: 5 });
  });

  it("regra incluída depois da data-base: «Sem reajuste» na renovação ainda dispensa a data-base dela", async () => {
    const { start: s0, anniversary: end } = baseFrom(20);
    const c = await contract("x8", { termMonths: 12, startDate: iso(s0), endDate: iso(end), readjustment: { type: "nenhum" } });
    const inc = await createAmendment({ contractId: c.id, effectiveFrom: daysFrom(end, 10), reason: "Reajuste a partir do próximo período", requiresSignature: false, conditions: { readjustment: { type: "percentual", percent: 5 } } }, ACTOR);
    await applyAmendment(inc.id, ACTOR);
    const r = await createAmendment({ contractId: c.id, effectiveFrom: end, reason: "Renovação sem reajuste", requiresSignature: false, renewal: { months: 12, readjustment: { type: "nenhum" } } }, ACTOR, { source: "renovacao_cs" });
    expect(r.readjust).toMatchObject({ anniversary: end, waived: true });
  });

  it("mensal → única → mensal com data-base pendente antes: ela continua para o Financeiro", async () => {
    const { start: s0, anniversary } = baseFrom(-3);
    const c = await contract("x3", { startDate: iso(s0), endDate: iso(addMonthsClamped(s0, 36)), readjustment: { type: "percentual", percent: 5 } });
    const once = await createAmendment({ contractId: c.id, effectiveFrom: daysFrom(TODAY, -1), reason: "Cobrança única", requiresSignature: false, conditions: { recurrence: "unico" } }, ACTOR);
    await applyAmendment(once.id, ACTOR);
    const back = await createAmendment({ contractId: c.id, effectiveFrom: TODAY, reason: "Volta a mensal", requiresSignature: false, conditions: { recurrence: "mensal" } }, ACTOR);
    await applyAmendment(back.id, ACTOR);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.readjustmentGaps).toEqual([{ from: daysFrom(TODAY, -1), to: TODAY }]);
    expect(after.readjustmentRuleSince).toBe(TODAY);
    const view = await getContractReadjustmentView(after, await amendmentsOf(c.id), { hideValues: false });
    expect(view?.state).toMatchObject({ anniversary, status: "bloqueado" });
  });

  it("regra removida e reincluída: a data-base pendente da regra antiga continua em foco (o Financeiro decide)", async () => {
    const { start: s0, anniversary } = baseFrom(-3);
    const c = await contract("x", { startDate: iso(s0), endDate: iso(addMonthsClamped(s0, 36)), readjustment: { type: "indice", index: IDX } });
    const off = await createAmendment({ contractId: c.id, effectiveFrom: TODAY, reason: "Remove o reajuste", requiresSignature: false, conditions: { readjustment: { type: "nenhum" } } }, ACTOR);
    await applyAmendment(off.id, ACTOR);
    const tomorrow = daysFrom(TODAY, 1);
    const on = await createAmendment({ contractId: c.id, effectiveFrom: tomorrow, reason: "Volta o reajuste", requiresSignature: false, conditions: { readjustment: { type: "indice", index: IDX } } }, ACTOR);
    await applyAmendment(on.id, ACTOR);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.readjustmentGaps).toEqual([{ from: TODAY, to: tomorrow }]);
    expect(after.readjustmentRuleSince).toBe(tomorrow);
    const view = await getContractReadjustmentView(after, await amendmentsOf(c.id), { hideValues: false });
    expect(view?.state).toMatchObject({ anniversary, status: "bloqueado" });
  });

  it("«aguardando» preservado no rascunho não volta depois que a data-base foi decidida", async () => {
    const { start: s0, anniversary } = baseFrom(-3);
    const c = await contract("y", { startDate: iso(s0), endDate: iso(addMonthsClamped(s0, 36)), readjustment: { type: "indice", index: IDX, indexName: `Índice ${RUN}`, pending: true } });
    const a = await createAmendment({ contractId: c.id, effectiveFrom: TODAY, reason: "Muda o vencimento", requiresSignature: false, conditions: { billingDay: 15, readjustment: { type: "indice", index: IDX } } }, ACTOR);
    expect(a.after.readjustment?.pending).toBe(true);
    await skipReadjustment({ contractId: c.id, anniversary, reason: "Negociado" }, ACTOR);
    await applyAmendment(a.id, ACTOR);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.billingDay).toBe(15);
    expect(after.readjustment?.pending).toBeUndefined();
  });

  it("tarefa de data-base coberta por aditivo em andamento fica; a de outra data-base (aditivo sem reajuste aberto) é cancelada", async () => {
    // Renovação na data-base aguardando assinatura: a data-base dela ainda não foi decidida de fato.
    const { start: s0, anniversary: end } = baseFrom(20);
    const c = await contract("z", { termMonths: 12, startDate: iso(s0), endDate: iso(end), readjustment: { type: "percentual", percent: 5 } });
    await createAmendment({ contractId: c.id, effectiveFrom: end, reason: "Renovação com assinatura", requiresSignature: true, renewal: { months: 12 } }, ACTOR, { source: "renovacao_cs" });
    const held = await createTaskInternal({ title: `Reajuste não aplicado: ACME ${RUN} (data-base ${end.split("-").reverse().join("/")})`, clientId: CLIENT_ID, departmentId: "financeiro", priority: "alta", processType: "contract", processId: c.id, origin: "automacao" }, ACTOR);
    // Aditivo de condições aberto (sem reajuste) não segura a tarefa de uma data-base que ficou para trás.
    const { start: s1 } = baseFrom(-3);
    const d = await contract("z2", { startDate: iso(s1), endDate: iso(addMonthsClamped(s1, 36)), readjustment: { type: "percentual", percent: 5 } });
    await createAmendment({ contractId: d.id, effectiveFrom: TODAY, reason: "Muda o vencimento", requiresSignature: true, conditions: { billingDay: 20 } }, ACTOR);
    const stale = await createTaskInternal({ title: `Reajuste não aplicado: ACME ${RUN} (data-base 10/01/2020)`, clientId: CLIENT_ID, departmentId: "financeiro", priority: "alta", processType: "contract", processId: d.id, origin: "automacao" }, ACTOR);
    await runContractReadjustments(NOW);
    expect((await getById<Task>(COLLECTIONS.tasks, held.id))?.status).toBe("aberta");
    expect((await getById<Task>(COLLECTIONS.tasks, stale.id))?.status).toBe("cancelada");
  });
});

describe("data-base conta da assinatura", () => {
  it("assinado antes da liberação: o reajuste entra no aniversário da assinatura; a renovação no fim da vigência não reajusta de novo", async () => {
    const { start: signed, anniversary } = baseFrom(-5);
    const released = daysFrom(signed, 20);
    const end = addMonthsClamped(released, 12);
    const c = await contract("sg", { termMonths: 12, signedAt: iso(signed), startDate: iso(released), endDate: iso(end), autoRenew: true, noticeDays: 30, readjustment: { type: "percentual", percent: 5 } });
    const view = await getContractReadjustmentView(c, [], { hideValues: false });
    expect(view).toMatchObject({ baseDate: signed, baseLabel: "assinatura" });
    const run = await runContractReadjustments(NOW);
    expect(run.appliedContractIds).toContain(c.id);
    const after = (await getById<Contract>(COLLECTIONS.contracts, c.id))!;
    expect(after.readjustmentLog).toMatchObject([{ anniversary, outcome: "aplicado", percent: 5 }]);
    expect(after.monthlyTotal).toBe(1050);
    await autoRenewContracts(NOW);
    const renewal = (await amendmentsOf(c.id)).find((a) => a.kind === "renovacao");
    expect(renewal?.readjust).toBeUndefined();
    expect((await getById<Contract>(COLLECTIONS.contracts, c.id))!.monthlyTotal).toBe(1050);
  });

  it("assinado antes da liberação: a renovação do CS decide a data-base que cai pouco antes do fim da vigência", async () => {
    const signed = addMonthsClamped(daysFrom(TODAY, 15), -12);
    const anniversary = anniversaryOf(signed, 1);
    const released = daysFrom(signed, 10);
    const end = addMonthsClamped(released, 12);
    const c = await contract("sg3", { termMonths: 12, signedAt: iso(signed), startDate: iso(released), endDate: iso(end), readjustment: { type: "percentual", percent: 5 } });
    const waived = await createAmendment({ contractId: c.id, effectiveFrom: end, reason: "Renovação sem reajuste", requiresSignature: false, renewal: { months: 12, readjustment: { type: "nenhum" } } }, ACTOR, { source: "renovacao_cs" });
    expect(waived.readjust).toMatchObject({ anniversary, waived: true });
    const d = await contract("sg4", { termMonths: 12, signedAt: iso(signed), startDate: iso(released), endDate: iso(end), readjustment: { type: "percentual", percent: 5 } });
    const conforme = await createAmendment({ contractId: d.id, effectiveFrom: end, reason: "Renovação conforme o contrato", requiresSignature: false, renewal: { months: 12 } }, ACTOR, { source: "renovacao_cs" });
    expect(conforme.readjust).toMatchObject({ anniversary, percent: 5 });
  });

  it("contrato sem assinatura registrada conta do início da vigência", async () => {
    const { start } = baseFrom(40);
    const c = await contract("sg2", { startDate: iso(start), endDate: iso(addMonthsClamped(start, 24)), readjustment: { type: "percentual", percent: 5 } });
    const view = await getContractReadjustmentView(c, [], { hideValues: false });
    expect(view).toMatchObject({ baseDate: start, baseLabel: "início da vigência" });
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
