/**
 * Guardas do trilho B — Financeiro (contratos e cobranças): cobertura real das páginas e actions (verificador A15),
 * mapeamento função → chave do catálogo (inclusive as chaves extras "checkedIn"), capacidades padrão ≡ comportamento
 * anterior (requireFinanceOperator/canOperateFinance), escopos padrão (empresa), escopo por registro com banco em
 * memória (T8: contrato/cobrança de outro vendedor → negado) e ocultação de valores (A13).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCREENS, type PermissionKey, type ScreenKey } from "@/domain/permissions";
import { defaultScopeKind } from "@/server/auth/scope";
import { BusinessError, PermissionError } from "@/server/auth/errors";
import type { Billing, Contract, ContractAmendment } from "@/domain/types";
import { buildContractSummary, redactContractSummary } from "@/components/finance/contract-summary";
import { NO_FINANCE_CAPABILITIES, hasBillingActions } from "@/components/finance/access-model";
import { asCurrentUser, ALL_USERS, SEED_USERS, SYNTHETIC_USERS, label, type FixtureUser } from "./fixtures";
import { legacyCanAccessModule, legacyCanOperateFinance, legacyUser } from "./legacy";

// ---------------------------------------------------------------------------
// Banco em memória (mesmo padrão de guards-vendas.test.ts)
// ---------------------------------------------------------------------------
const store = vi.hoisted(() => ({ data: new Map<string, Record<string, unknown>[]>(), reads: [] as string[] }));

vi.mock("@/server/db", () => {
  type Row = Record<string, unknown>;
  const rows = (name: string): Row[] => store.data.get(name) ?? [];
  const list = async (name: string) => {
    store.reads.push(`list:${name}`);
    return rows(name);
  };
  const getById = async (name: string, id: string) => {
    store.reads.push(`get:${name}`);
    return rows(name).find((r) => r.id === id) ?? null;
  };
  const getManyByIds = async (name: string, ids: string[]) => {
    store.reads.push(`many:${name}`);
    return new Map(rows(name).filter((r) => ids.includes(r.id as string)).map((r) => [r.id as string, r]));
  };
  const fail = async () => {
    throw new Error("escrita não esperada no teste de guardas");
  };
  return { ORG_ID: "intercert", nowIso: () => "2026-09-30T12:00:00.000Z", list, getById, getManyByIds, create: fail, update: fail, remove: fail, batchSet: fail, newId: () => "novo", stripUndefined: <T>(v: T) => v, counterId: () => "c", clearCollection: fail };
});

const { analyzeAccess } = await import("../../scripts/check-access/analyze");
const access = await import("@/server/finance/access");
const redact = await import("@/server/finance/redact");

const ROOT = path.resolve(__dirname, "../..");
const SCOPE_PATHS = /^src\/app\/\(app\)\/financeiro\/(page\.tsx|contratos|assinaturas|cobrancas|contas-a-receber|recorrencia)|^src\/server\/finance\/|^src\/components\/finance\/|^src\/components\/clients\/tab-financeiro/;
const ACTIONS_FILE = "src/server/finance/actions.ts";
const FINANCE_SCREENS: ScreenKey[] = ["financeiro.dashboard", "financeiro.contratos", "financeiro.assinaturas", "financeiro.cobrancas", "financeiro.contas-a-receber", "financeiro.recorrencia"];
const SUBJECTS = [...SEED_USERS, ...SYNTHETIC_USERS];
const byId = (id: string) => SEED_USERS.find((u) => u.id === id)!;
const inModule = (u: FixtureUser) => legacyCanAccessModule(legacyUser(u), "financeiro");
const operates = (u: FixtureUser) => inModule(u) && legacyCanOperateFinance(legacyUser(u));
const isManager = (u: Pick<FixtureUser, "role">) => u.role === "gestor" || u.role === "admin" || u.role === "diretoria";

// ---------------------------------------------------------------------------
// Cobertura (A15) no repositório real
// ---------------------------------------------------------------------------
describe("cobertura do trilho B (verificador de acesso) — Financeiro: contratos e cobranças", () => {
  it("nenhuma pendência em páginas, actions e guards do escopo", () => {
    const report = analyzeAccess(ROOT);
    expect(report.findings.filter((f) => SCOPE_PATHS.test(f.target))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Função → chave (actions.ts ≡ catálogo)
// ---------------------------------------------------------------------------
describe("actions do Financeiro: a primeira chave exigida é a dona no catálogo", () => {
  const source = readFileSync(path.join(ROOT, ACTIONS_FILE), "utf8");
  const functions = [...source.matchAll(/export async function (\w+)\([\s\S]*?\n\}\n/g)].map((m) => ({ name: m[1], body: m[0] }));
  const owners = new Map<string, string>();
  for (const s of SCREENS) for (const a of s.actions) for (const g of a.guards) if (g.startsWith(`${ACTIONS_FILE}#`)) owners.set(g.split("#")[1].split("?")[0], a.key);

  it("todas as 30 funções exportadas têm dono e o exigem antes de qualquer leitura", () => {
    expect(functions.length).toBe(30);
    for (const fn of functions) {
      const first = fn.body.match(/requirePermission\("([^"]+)"\)/);
      expect(first?.[1], fn.name).toBe(owners.get(fn.name));
      // requirePermission vem antes do parse, do escopo e do serviço.
      expect(fn.body.indexOf("requirePermission("), fn.name).toBeLessThan(fn.body.indexOf(".parse("));
    }
  });

  it("não sobra guarda local nem fail() que engula redirect", () => {
    expect(source).not.toMatch(/requireFinanceOperator|canOperateFinance|canAccessModule|requireUser/);
    expect(source).toMatch(/return failAction\(error, fallback, "financeiro"\)/);
  });

  it("checkedIn: enviar boleto/2ª via e liberar com pendência exigem a chave extra na condição", () => {
    const body = (name: string) => functions.find((f) => f.name === name)!.body;
    expect(body("sendBillingMessageAction")).toMatch(/if \(data\.includeBoleto \|\| secondCopy\) await requirePermission\("financeiro\.cobrancas\.boleto\.enviar"\)/);
    expect(body("releaseContractAction")).toMatch(/if \(data\.exceptionReason\?\.trim\(\)\) await requirePermission\("financeiro\.contratos\.liberar-com-pendencia"\)/);
    expect(body("releaseContractAction")).toMatch(/canReleaseWithPendency: can\(user, "financeiro\.contratos\.liberar-com-pendencia"\)/);
  });

  it("actions sobre um registro conferem o escopo (contrato, aditivo ou cobrança)", () => {
    const unscoped = ["createManualContractAction"];
    for (const fn of functions) {
      if (unscoped.includes(fn.name)) continue;
      expect(/assert(Contract|Amendment|Billing|OpportunityContract)Access\(user/.test(fn.body), fn.name).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Padrão = comportamento anterior
// ---------------------------------------------------------------------------
describe("capacidades padrão ≡ comportamento anterior", () => {
  it("ações de contrato e cobrança ≡ módulo ∧ canOperateFinance (requireFinanceOperator)", () => {
    for (const u of ALL_USERS) {
      const caps = access.financeCapabilities(asCurrentUser(u));
      const { view, signatureView, amendmentsView, pendenciesView, documentsView, historyView, releaseWithPendency, ...contractOps } = caps.contracts;
      const { view: billingView, boletoView, ...billingOps } = caps.billings;
      for (const [k, v] of Object.entries({ ...contractOps, ...billingOps })) expect(v, `${label(u)} ${k}`).toBe(operates(u));
      // Liberar com pendência: antes, isManager (com o botão só para quem opera).
      expect(releaseWithPendency, label(u)).toBe(operates(u) && isManager(u));
      // Visualização e seções: todos com o módulo (antes: só o módulo).
      for (const [k, v] of Object.entries({ view, signatureView, amendmentsView, pendenciesView, documentsView, historyView, billingView, boletoView })) expect(v, `${label(u)} ${k}`).toBe(inModule(u));
    }
  });

  it("valores: todos veem por padrão (financeiro.valores.ver não exige o módulo — Cliente 360, implantação)", () => {
    for (const u of ALL_USERS) {
      const cu = asCurrentUser(u);
      expect(access.canSeeFinanceValues(cu), label(u)).toBe(true);
      expect(access.canSeeContractValues(cu), label(u)).toBe(inModule(u));
    }
  });

  it("seções das telas do Financeiro: todas para quem tem o módulo", () => {
    const sections = FINANCE_SCREENS.flatMap((s) => SCREENS.find((x) => x.key === s)!.sections.map((x) => x.key));
    expect(sections.length).toBeGreaterThan(10);
    for (const u of ALL_USERS) {
      const cu = asCurrentUser(u);
      for (const key of sections) expect(cu.permissions.has(key as PermissionKey), `${label(u)} ${key}`).toBe(inModule(u));
    }
  });

  it("escopos padrão: empresa em todas as telas do Financeiro (antes não havia recorte)", () => {
    for (const u of SUBJECTS) for (const screen of FINANCE_SCREENS) expect(defaultScopeKind(u, screen), `${label(u)} ${screen}`).toBe("empresa");
  });

  it("sem provedor, nada liberado", () => {
    expect(hasBillingActions(NO_FINANCE_CAPABILITIES)).toBe(false);
    expect(Object.values(NO_FINANCE_CAPABILITIES.contracts).some(Boolean)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Ajustes: visualizar sem editar; sem valores
// ---------------------------------------------------------------------------
describe("ajustes do CEO/CTO refletem nas capacidades", () => {
  const anapaula = byId("user_anapaula");

  it("visualizar sem editar: negar a ação some com o botão, a tela continua", () => {
    const cu = asCurrentUser(anapaula, { userOverride: { grants: { "financeiro.cobrancas.baixar": false, "financeiro.contratos.cancelar": false } } });
    const caps = access.financeCapabilities(cu);
    expect(caps.billings.pay).toBe(false);
    expect(caps.contracts.cancel).toBe(false);
    expect(caps.billings.view).toBe(true);
    expect(caps.contracts.edit).toBe(true);
  });

  it("sem 'Visualizar valores': baixa, boleto e aditivo (que pedem o valor) ficam indisponíveis", () => {
    const cu = asCurrentUser(anapaula, { userOverride: { grants: { "financeiro.valores.ver": false } } });
    const caps = access.financeCapabilities(cu);
    expect(caps.values).toBe(false);
    expect(caps.contractValues).toBe(false);
    expect(caps.billings.pay).toBe(false);
    expect(caps.billings.boletoCreate).toBe(false);
    expect(caps.contracts.amendmentCreate).toBe(false);
    expect(caps.billings.collect).toBe(true);
  });

  it("sem a seção 'Valores do contrato': valores de contrato ocultos, de cobrança visíveis", () => {
    const cu = asCurrentUser(anapaula, { userOverride: { grants: { "financeiro.contratos.valores.ver": false } } });
    expect(access.canSeeFinanceValues(cu)).toBe(true);
    expect(access.canSeeContractValues(cu)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Escopo por registro com banco em memória (T8)
// ---------------------------------------------------------------------------
const iso = "2026-01-01T00:00:00.000Z";
const base = { organizationId: "intercert", createdAt: iso, updatedAt: iso };
const contract = (id: string, extra: Partial<Contract> = {}) => ({ ...base, id, clientId: "cli_1", number: id, version: 1, status: "aguardando_assinatura", items: [], setupTotal: 100, monthlyTotal: 50, hardwareTotal: 10, billingDay: 10, recurrence: "mensal", termMonths: 12, signers: [], financialStatus: "pendente", documentIds: [], ...extra });

function seedStore() {
  store.reads = [];
  store.data = new Map<string, Record<string, unknown>[]>([
    ["users", SUBJECTS.map((u) => ({ ...base, id: u.id, name: u.name, role: u.role, departmentId: u.departmentId, managerId: u.managerId, active: true }))],
    ["departments", []],
    ["opportunities", [{ ...base, id: "opp_igor", clientId: "cli_1", ownerId: "user_igor", stage: "ganho" }]],
    ["clients", [{ ...base, id: "cli_1", tradeName: "Cliente 1", ownerSalesId: "user_igor" }, { ...base, id: "cli_2", tradeName: "Cliente 2", ownerSalesId: "user_vinicius" }]],
    [
      "contracts",
      [
        contract("c_vinicius", { sellerId: "user_vinicius" }),
        contract("c_resp_vinicius", { sellerId: "user_igor", ownerId: "user_vinicius" }),
        contract("c_opp_igor", { opportunityId: "opp_igor" }),
        contract("c_cli_vinicius", { clientId: "cli_2" }),
        contract("c_igor", { sellerId: "user_igor" }),
        contract("c_anapaula", { sellerId: "user_anapaula" }),
      ],
    ],
    ["billing", [{ ...base, id: "b_igor", clientId: "cli_1", contractId: "c_igor", amount: 50, status: "aberta" }, { ...base, id: "b_vinicius", clientId: "cli_1", contractId: "c_vinicius", amount: 50, status: "aberta" }]],
    ["contract_amendments", [{ ...base, id: "a_igor", contractId: "c_igor", clientId: "cli_1" }]],
  ]);
}

const vinicius = byId("user_vinicius");
const meus = (screen: ScreenKey) => asCurrentUser(vinicius, { userOverride: { scopes: { [screen]: "meus" } } });
const contracts = () => store.data.get("contracts") as unknown as Contract[];

describe("escopo de contratos e cobranças (donos: vendedor com fallback, responsável financeiro)", () => {
  beforeEach(seedStore);

  it("donos resolvidos: sellerId, senão dono da oportunidade, senão vendedor do cliente; + responsável", async () => {
    const owners = await access.contractOwnersMap(contracts());
    expect(owners.get("c_vinicius")).toEqual(["user_vinicius"]);
    expect(owners.get("c_resp_vinicius")).toEqual(["user_igor", "user_vinicius"]);
    expect(owners.get("c_opp_igor")).toEqual(["user_igor"]);
    expect(owners.get("c_cli_vinicius")).toEqual(["user_vinicius"]);
  });

  it("padrão (empresa): lista inteira, sem nenhuma leitura extra", async () => {
    const { resolveDataScope } = await import("@/server/auth/scope");
    const scope = await resolveDataScope(asCurrentUser(vinicius), "financeiro.contratos");
    expect(scope.kind).toBe("empresa");
    store.reads = [];
    expect((await access.filterContractsByScope(contracts(), scope)).length).toBe(6);
    expect(store.reads).toEqual([]);
  });

  it("'meus': só os contratos que vendeu ou de que é responsável", async () => {
    const { resolveDataScope } = await import("@/server/auth/scope");
    const scope = await resolveDataScope(meus("financeiro.contratos"), "financeiro.contratos");
    const visible = (await access.filterContractsByScope(contracts(), scope)).map((c) => c.id).sort();
    expect(visible).toEqual(["c_cli_vinicius", "c_resp_vinicius", "c_vinicius"]);
  });

  it("'departamento' (recorte pelo registro): contratos cujos donos são do departamento", async () => {
    const { resolveDataScope } = await import("@/server/auth/scope");
    const cu = asCurrentUser(vinicius, { userOverride: { scopes: { "financeiro.contratos": "departamento" } } });
    const scope = await resolveDataScope(cu, "financeiro.contratos");
    const visible = (await access.filterContractsByScope(contracts(), scope)).map((c) => c.id).sort();
    // Vendas: vinicius e igor; fica de fora o contrato vendido pela analista financeira.
    expect(visible).toEqual(["c_cli_vinicius", "c_igor", "c_opp_igor", "c_resp_vinicius", "c_vinicius"]);
  });

  it("T8: contrato de outro vendedor → PermissionError; inexistente → BusinessError; o próprio passa", async () => {
    const cu = meus("financeiro.contratos");
    await expect(access.assertContractAccess(cu, "c_igor")).rejects.toBeInstanceOf(PermissionError);
    await expect(access.assertContractAccess(cu, "nao_existe")).rejects.toBeInstanceOf(BusinessError);
    await expect(access.assertContractAccess(cu, "c_vinicius")).resolves.toMatchObject({ id: "c_vinicius" });
    expect(await access.contractAccessById(cu, "c_igor")).toBe("denied");
    expect(await access.contractAccessById(cu, "nao_existe")).toBe("missing");
    expect(await access.contractAccessById(cu, "c_vinicius")).toBe("ok");
  });

  it("aditivo herda o escopo do contrato", async () => {
    await expect(access.assertAmendmentAccess(meus("financeiro.contratos"), "a_igor")).rejects.toBeInstanceOf(PermissionError);
    await expect(access.assertAmendmentAccess(asCurrentUser(vinicius), "a_igor")).resolves.toMatchObject({ id: "a_igor" });
  });

  it("cobrança herda os donos do contrato (Cobranças segue o escopo de Contratos: sameAs)", async () => {
    // As telas do Financeiro com `sameAs: financeiro.contratos` usam o escopo configurado em Contratos.
    const cu = meus("financeiro.contratos");
    expect(cu.permissions.scopes["financeiro.cobrancas"]).toBe("meus");
    await expect(access.assertBillingAccess(cu, "b_igor")).rejects.toBeInstanceOf(PermissionError);
    await expect(access.assertBillingAccess(cu, "b_vinicius")).resolves.toMatchObject({ id: "b_vinicius" });
    const { resolveDataScope } = await import("@/server/auth/scope");
    const visible = await access.visibleContractIds(await resolveDataScope(cu, "financeiro.cobrancas"));
    expect(access.filterBillingsByContracts(store.data.get("billing") as unknown as Billing[], visible).map((b) => b.id)).toEqual(["b_vinicius"]);
  });

  it("gerar contrato da venda: venda de outro vendedor fora do escopo → PermissionError", async () => {
    await expect(access.assertOpportunityContractAccess(meus("financeiro.contratos"), "opp_igor")).rejects.toBeInstanceOf(PermissionError);
    await expect(access.assertOpportunityContractAccess(asCurrentUser(vinicius), "opp_igor")).resolves.toBeUndefined();
  });

  it("sem a tela: nenhum contrato (nem o próprio)", async () => {
    const cu = asCurrentUser(vinicius, { userOverride: { grants: { "financeiro.contratos.ver": false } } });
    expect(await access.contractInScope(cu, contracts()[0])).toBe(false);
    expect(await access.contractAccessById(cu, "c_vinicius")).toBe("denied");
  });
});

// ---------------------------------------------------------------------------
// A13 — o servidor não envia valores
// ---------------------------------------------------------------------------
describe("ocultação de valores (A13)", () => {
  const full = contract("c1", {
    items: [{ productId: "p", productName: "Produto", quantity: 1, setupValue: 100, monthlyValue: 50, hardwareValue: 10, discountPct: 0 }],
    paymentCondition: "Adesão de R$ 1.234,56 em 3x",
    previousVersions: [{ version: 1, kind: "revisao", at: iso, by: "u", snapshot: { version: 1, items: [], setupTotal: 9, monthlyTotal: 9, hardwareTotal: 9, billingDay: 10, recurrence: "mensal", termMonths: 12 } }],
  }) as unknown as Contract;

  it("contrato: totais, itens, versões e condição de pagamento sem números", () => {
    const r = redact.redactContract(full);
    expect([r.setupTotal, r.monthlyTotal, r.hardwareTotal]).toEqual([0, 0, 0]);
    expect(r.items[0]).toMatchObject({ productName: "Produto", setupValue: 0, monthlyValue: 0, hardwareValue: 0 });
    expect(r.previousVersions?.[0].snapshot.monthlyTotal).toBe(0);
    expect(r.paymentCondition).toBe(`Adesão de ${redact.MASKED_AMOUNT} em 3x`);
    expect(JSON.stringify(r)).not.toMatch(/1\.234|\b50\b|\b100\b/);
  });

  it("cobrança: valor, pago e códigos que codificam o valor; o estado do boleto continua", () => {
    const b = { id: "b", amount: 50, paidAmount: 50, status: "paga", boleto: { linhaDigitavel: "34191.79001 01043.510047 91020.150008 5 00000000005000", nossoNumero: "123" }, pix: { copiaECola: "000201...5405" } } as unknown as Billing;
    const r = redact.redactBilling(b);
    expect([r.amount, r.paidAmount]).toEqual([0, 0]);
    expect(r.boleto?.linhaDigitavel).toBe(redact.RESTRICTED_CODE);
    expect(r.pix?.copiaECola).toBe(redact.RESTRICTED_CODE);
    expect(r.boleto?.nossoNumero).toBe("123");
    const stripped = redact.stripBoleto(b);
    expect(stripped.boleto).toEqual({ nossoNumero: redact.RESTRICTED_CODE });
  });

  it("aditivo: totais saem de 'changes'; itens ficam só com nomes", () => {
    const a = {
      id: "a",
      reason: "Reajuste para R$ 99,90",
      before: { version: 1, items: [], setupTotal: 1, monthlyTotal: 1, hardwareTotal: 1, billingDay: 1, recurrence: "mensal", termMonths: 12 },
      after: { version: 2, items: [], setupTotal: 2, monthlyTotal: 2, hardwareTotal: 2, billingDay: 1, recurrence: "mensal", termMonths: 12 },
      changes: { monthlyTotal: { from: 1, to: 2 }, termMonths: { from: 12, to: 24 }, items: { from: [{ productName: "X", monthlyValue: 5, setupValue: 0, hardwareValue: 0 }], to: [] } },
    } as unknown as ContractAmendment;
    const r = redact.redactAmendment(a);
    expect(r.changes.monthlyTotal).toBeUndefined();
    expect(r.changes.termMonths).toEqual({ from: 12, to: 24 });
    expect((r.changes.items.from as { monthlyValue: number }[])[0].monthlyValue).toBe(0);
    expect(r.after.monthlyTotal).toBe(0);
    expect(r.reason).toBe(`Reajuste para ${redact.MASKED_AMOUNT}`);
  });

  it("Resumo do contratado: números zerados e marcado como restrito", () => {
    const s = redactContractSummary(buildContractSummary(full));
    expect(s.valuesHidden).toBe(true);
    expect([s.monthlyTotal, s.setupTotal, s.hardwareTotal, s.items[0].monthlyValue]).toEqual([0, 0, 0, 0]);
    expect(s.paymentCondition).toBe("Restrito");
  });

  it("máscara de quantias em texto livre", () => {
    expect(redact.maskMoneyText("Pagamento de R$ 1.500,00 registrado; R$50 de multa")).toBe(`Pagamento de ${redact.MASKED_AMOUNT} registrado; ${redact.MASKED_AMOUNT} de multa`);
    expect(redact.maskMoneyText(undefined)).toBeUndefined();
  });
});
