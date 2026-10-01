/**
 * Cadastros financeiros (etapa CP/CR 1) — regras puras de `src/domain/finance-registry.ts`: hierarquia
 * centro → categoria → subcategoria, herança, centro efetivo, arquivamento, manutenção em massa, importação da
 * configuração antiga (idempotente) e saldo da conta.
 */
import { describe, expect, it } from "vitest";
import {
  NO_COST_CENTER_LABEL,
  accountBalance,
  activeCategoriesByCenter,
  categoriesWithoutCenter,
  categoryCostCenterId,
  categoryUsageTotal,
  countCategoryUsage,
  planApplyCostCenter,
  planArchiveCategory,
  planLegacyImport,
  planMergeCategories,
  planMoveSubcategories,
  registryProblems,
  resolveEffectiveCostCenter,
  validateCategory,
  validateReactivateCategory,
} from "@/domain/finance-registry";
import type { CostCenter, FinanceCategory } from "@/domain/types";

const base = { organizationId: "intercert", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const center = (id: string, name: string, extra: Partial<CostCenter> = {}): CostCenter => ({ ...base, id, name, archived: false, ...extra });
const cat = (id: string, name: string, type: "receita" | "despesa", costCenterId: string | undefined, extra: Partial<FinanceCategory> = {}): FinanceCategory => ({ ...base, id, name, type, parentId: null, costCenterId, archived: false, ...extra });
const sub = (id: string, name: string, parent: FinanceCategory, extra: Partial<FinanceCategory> = {}): FinanceCategory => ({ ...base, id, name, type: parent.type, parentId: parent.id, archived: false, ...extra });

const operacoes = center("cc_ops", "Operações");
const comercial = center("cc_com", "Comercial");
const antigo = center("cc_old", "Antigo", { archived: true });
const centers = [operacoes, comercial, antigo];
const motoristas = cat("fc_mot", "Motoristas", "despesa", "cc_ops");
const diarias = sub("fc_dia", "Diárias", motoristas);
const combustivel = sub("fc_comb", "Combustível", motoristas);
const marketing = cat("fc_mkt", "Marketing", "despesa", "cc_com");
const vendas = cat("fc_ven", "Vendas", "receita", "cc_com");
const recorrente = sub("fc_rec", "Mensalidades", vendas);
const categories = [motoristas, diarias, combustivel, marketing, vendas, recorrente];

describe("validateCategory — categoria (nível 1)", () => {
  it("recusa categoria sem centro de custo", () => {
    const r = validateCategory({ name: "Aluguel", type: "despesa", parentId: null }, { categories, centers });
    expect(r).toEqual({ ok: false, error: "Toda categoria precisa estar atrelada a um centro de custo" });
  });

  it("recusa centro arquivado ou inexistente e exige o tipo", () => {
    expect(validateCategory({ name: "Aluguel", type: "despesa", costCenterId: "cc_old" }, { categories, centers }).ok).toBe(false);
    expect(validateCategory({ name: "Aluguel", type: "despesa", costCenterId: "cc_x" }, { categories, centers }).ok).toBe(false);
    expect(validateCategory({ name: "Aluguel", costCenterId: "cc_ops" }, { categories, centers })).toEqual({ ok: false, error: "Escolha o tipo: receita ou despesa" });
  });

  it("aceita com tipo e centro e normaliza o nome", () => {
    expect(validateCategory({ name: "  Aluguel   da sala ", type: "despesa", costCenterId: "cc_ops" }, { categories, centers })).toEqual({ ok: true, value: { name: "Aluguel da sala", type: "despesa", parentId: null, costCenterId: "cc_ops" } });
  });

  it("nome único entre as ATIVAS do mesmo tipo (sem diferenciar maiúsculas/acentos); arquivada não bloqueia", () => {
    expect(validateCategory({ name: "MARKETING", type: "despesa", costCenterId: "cc_ops" }, { categories, centers }).ok).toBe(false);
    expect(validateCategory({ name: "Marketing", type: "receita", costCenterId: "cc_ops" }, { categories, centers }).ok).toBe(true);
    const archived = [...categories, cat("fc_x", "Eventos", "despesa", "cc_ops", { archived: true })];
    expect(validateCategory({ name: "Eventos", type: "despesa", costCenterId: "cc_ops" }, { categories: archived, centers }).ok).toBe(true);
  });

  it("tipo não muda com subcategorias ou com uso", () => {
    expect(validateCategory({ id: "fc_mot", name: "Motoristas", type: "receita", costCenterId: "cc_ops" }, { categories, centers }).ok).toBe(false);
    const usage = new Map([["fc_mkt", 2]]);
    expect(validateCategory({ id: "fc_mkt", name: "Marketing", type: "receita", costCenterId: "cc_com" }, { categories, centers, usage }).ok).toBe(false);
    expect(validateCategory({ id: "fc_mkt", name: "Marketing", type: "receita", costCenterId: "cc_com" }, { categories, centers }).ok).toBe(true);
  });
});

describe("validateCategory — subcategoria (nível 2)", () => {
  it("não pede centro e herda o tipo da mãe", () => {
    expect(validateCategory({ name: "Pedágio", type: "receita", parentId: "fc_mot" }, { categories, centers })).toEqual({ ok: true, value: { name: "Pedágio", type: "despesa", parentId: "fc_mot" } });
  });

  it("recusa centro próprio, mãe inexistente, arquivada ou de nível 2", () => {
    expect(validateCategory({ name: "Pedágio", parentId: "fc_mot", costCenterId: "cc_com" }, { categories, centers })).toEqual({ ok: false, error: "Subcategoria não tem centro de custo próprio: herda o da categoria-mãe" });
    expect(validateCategory({ name: "Pedágio", parentId: "fc_nao" }, { categories, centers }).ok).toBe(false);
    expect(validateCategory({ name: "Pedágio", parentId: "fc_dia" }, { categories, centers }).ok).toBe(false);
    const archivedParent = [...categories.filter((c) => c.id !== "fc_mkt"), { ...marketing, archived: true }];
    expect(validateCategory({ name: "Pedágio", parentId: "fc_mkt" }, { categories: archivedParent, centers }).ok).toBe(false);
  });

  it("nome único dentro da mesma mãe; o mesmo nome em outra mãe é aceito", () => {
    expect(validateCategory({ name: "diarias", parentId: "fc_mot" }, { categories, centers }).ok).toBe(false);
    expect(validateCategory({ name: "Diárias", parentId: "fc_mkt" }, { categories, centers }).ok).toBe(true);
  });

  it("categoria com subcategorias não vira subcategoria; troca de mãe exige o mesmo tipo", () => {
    expect(validateCategory({ id: "fc_mot", name: "Motoristas", parentId: "fc_mkt" }, { categories, centers }).ok).toBe(false);
    expect(validateCategory({ id: "fc_dia", name: "Diárias", parentId: "fc_ven" }, { categories, centers }).ok).toBe(false);
    expect(validateCategory({ id: "fc_dia", name: "Diárias", parentId: "fc_mkt" }, { categories, centers }).ok).toBe(true);
  });
});

describe("centro de custo efetivo (título/lançamento → próprio → categoria → mãe → Sem centro)", () => {
  it("o próprio vence", () => {
    expect(resolveEffectiveCostCenter({ costCenterId: "cc_com", categoryId: "fc_dia" }, categories, centers)).toEqual({ id: "cc_com", name: "Comercial", source: "proprio" });
  });
  it("sem próprio: o da categoria", () => {
    expect(resolveEffectiveCostCenter({ categoryId: "fc_mkt" }, categories, centers)).toEqual({ id: "cc_com", name: "Comercial", source: "categoria" });
  });
  it("subcategoria 'Diárias' sem centro próprio entra no centro da mãe 'Motoristas'", () => {
    expect(resolveEffectiveCostCenter({ categoryId: "fc_dia" }, categories, centers)).toEqual({ id: "cc_ops", name: "Operações", source: "categoria-mae" });
    expect(categoryCostCenterId("fc_dia", categories)).toBe("cc_ops");
  });
  it("sem nada (ou categoria desconhecida): Sem centro de custo", () => {
    expect(resolveEffectiveCostCenter({}, categories, centers)).toEqual({ id: null, name: NO_COST_CENTER_LABEL, source: "nenhum" });
    expect(resolveEffectiveCostCenter({ categoryId: "fc_nao" }, categories, centers).source).toBe("nenhum");
    expect(resolveEffectiveCostCenter({ categoryId: "fc_sem" }, [cat("fc_sem", "Sem", "despesa", undefined)], centers).name).toBe(NO_COST_CENTER_LABEL);
  });
});

describe("uso e arquivamento", () => {
  const refs = [{ categoryId: "fc_dia" }, { categoryId: "fc_dia" }, { categoryId: "fc_mot" }, { categoryId: "fc_mkt" }, {}];
  const usage = countCategoryUsage(refs);

  it("uso direto e total (categoria soma as subcategorias)", () => {
    expect(usage.get("fc_dia")).toBe(2);
    expect(categoryUsageTotal(motoristas, categories, usage)).toBe(3);
    expect(categoryUsageTotal(diarias, categories, usage)).toBe(2);
  });

  it("arquivar a categoria avisa quantas subcategorias vão junto e quantos registros usam", () => {
    const plan = planArchiveCategory(motoristas, categories, usage);
    expect(plan.subcategories.map((s) => s.name).sort()).toEqual(["Combustível", "Diárias"]);
    expect(plan.usage).toBe(3);
    expect(planArchiveCategory(diarias, categories, usage)).toEqual({ subcategories: [], usage: 2 });
  });

  it("reativar subcategoria exige a mãe ativa; categoria exige centro ativo", () => {
    const archived = categories.map((c) => (c.id === "fc_mot" || c.id === "fc_dia" ? { ...c, archived: true } : c));
    expect(validateReactivateCategory(archived.find((c) => c.id === "fc_dia")!, archived, centers)).toEqual({ ok: false, error: "Reative antes a categoria-mãe" });
    expect(validateReactivateCategory(archived.find((c) => c.id === "fc_mot")!, archived, centers).ok).toBe(true);
    const onArchivedCenter = cat("fc_y", "Y", "despesa", "cc_old", { archived: true });
    expect(validateReactivateCategory(onArchivedCenter, [onArchivedCenter], centers).ok).toBe(false);
    expect(validateReactivateCategory({ ...marketing, archived: true, mergedIntoId: "fc_mot" }, categories, centers).ok).toBe(false);
  });

  it("categorias sem centro e categorias ativas por centro", () => {
    const list = [...categories, cat("fc_z", "Z", "despesa", undefined), cat("fc_w", "W", "despesa", "cc_inexistente"), cat("fc_v", "V", "despesa", undefined, { archived: true })];
    expect(categoriesWithoutCenter(list, centers).map((c) => c.id).sort()).toEqual(["fc_w", "fc_z"]);
    expect(activeCategoriesByCenter(categories)).toEqual(new Map([["cc_ops", 1], ["cc_com", 2]]));
  });
});

describe("manutenção em massa", () => {
  it("aplicar centro a várias categorias (pula as que já estão nele; recusa subcategoria e centro arquivado)", () => {
    const r = planApplyCostCenter(["fc_mot", "fc_mkt", "fc_ven"], "cc_com", categories, centers);
    expect(r.ok && r.value).toEqual([{ id: "fc_mot", name: "Motoristas", from: "cc_ops", to: "cc_com" }]);
    expect(planApplyCostCenter(["fc_dia"], "cc_com", categories, centers).ok).toBe(false);
    expect(planApplyCostCenter(["fc_mot"], "cc_old", categories, centers).ok).toBe(false);
    expect(planApplyCostCenter([], "cc_com", categories, centers).ok).toBe(false);
  });

  it("mover subcategorias para outra mãe do mesmo tipo", () => {
    const r = planMoveSubcategories(["fc_dia", "fc_comb"], "fc_mkt", categories);
    expect(r.ok && r.value.map((m) => [m.id, m.from, m.to])).toEqual([
      ["fc_dia", "fc_mot", "fc_mkt"],
      ["fc_comb", "fc_mot", "fc_mkt"],
    ]);
    expect(planMoveSubcategories(["fc_dia"], "fc_ven", categories).ok).toBe(false); // tipo diferente
    expect(planMoveSubcategories(["fc_mkt"], "fc_mot", categories).ok).toBe(false); // nível 1
    expect(planMoveSubcategories(["fc_dia"], "fc_comb", categories).ok).toBe(false); // destino nível 2
    const clash = [...categories, sub("fc_mkt_dia", "Diárias", marketing)];
    expect(planMoveSubcategories(["fc_dia"], "fc_mkt", clash).ok).toBe(false); // nome repetido na destino
    const same = planMoveSubcategories(["fc_dia"], "fc_mot", categories);
    expect(same.ok && same.value).toEqual([]);
  });

  it("mesclar: subcategorias e registros da origem vão para a destino", () => {
    const records = [{ categoryId: "fc_mot" }, { categoryId: "fc_dia" }, { categoryId: "fc_mkt" }, { categoryId: "fc_mot" }];
    const r = planMergeCategories("fc_mot", "fc_mkt", categories, records);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.movedSubcategories.map((m) => m.id).sort()).toEqual(["fc_comb", "fc_dia"]);
    expect(r.value.reassignedRecords).toEqual([0, 3]);
    expect(r.value.target.id).toBe("fc_mkt");
  });

  it("mesclar: recusa tipos diferentes, destino filha da origem, origem com filhas em subcategoria e nome repetido", () => {
    expect(planMergeCategories("fc_mot", "fc_ven", categories, []).ok).toBe(false);
    expect(planMergeCategories("fc_mot", "fc_dia", categories, []).ok).toBe(false);
    const other = [...categories, sub("fc_mkt_x", "Brindes", marketing)];
    expect(planMergeCategories("fc_mot", "fc_mkt_x", other, []).ok).toBe(false);
    expect(planMergeCategories("fc_mot", "fc_mot", categories, []).ok).toBe(false);
    const clash = [...categories, sub("fc_mkt_dia", "Diárias", marketing)];
    expect(planMergeCategories("fc_mot", "fc_mkt", clash, []).ok).toBe(false);
    // Subcategoria sem filhas pode ser mesclada em outra subcategoria do mesmo tipo.
    expect(planMergeCategories("fc_dia", "fc_comb", categories, [{ categoryId: "fc_dia" }]).ok).toBe(true);
  });
});

describe("importar da configuração atual (só cria, idempotente)", () => {
  const setting = { categorias: ["comissao_comercial", "bonus", "outros", "aluguel", "software"], centrosDeCusto: ["Administrativo", "Tecnologia", " tecnologia "] };
  const payables = [
    { category: "software", costCenter: "Tecnologia" },
    { category: "software", costCenter: "Tecnologia" },
    { category: "software", costCenter: "Administrativo" },
    { category: "aluguel", costCenter: "Administrativo" },
    { category: "bonus" },
  ];

  it("planeja centros da configuração e categorias de despesa (+ fixas do circuito) com o centro mais usado", () => {
    const plan = planLegacyImport({ setting, centers: [], categories: [], payables, defaultCenterName: "administrativo" });
    expect(plan.centers).toEqual([
      { name: "Administrativo", legacyKey: "Administrativo" },
      { name: "Tecnologia", legacyKey: "Tecnologia" },
    ]);
    const byKey = Object.fromEntries(plan.categories.map((c) => [c.legacyKey, c]));
    expect(Object.keys(byKey).sort()).toEqual(["aluguel", "bonus", "comissao_comercial", "estorno_comissao", "outros", "software"]);
    expect(byKey.software).toMatchObject({ name: "Software e assinaturas", centerName: "Tecnologia", centerSource: "historico" });
    expect(byKey.aluguel).toMatchObject({ centerName: "Administrativo", centerSource: "historico" });
    expect(byKey.bonus).toMatchObject({ centerName: "Administrativo", centerSource: "padrao" });
    expect(plan.needsDefaultCenter).toBe(true);
  });

  it("sem centro padrão, as categorias sem histórico ficam sem centro (a importação exige escolher)", () => {
    const plan = planLegacyImport({ setting, centers: [], categories: [], payables });
    expect(plan.categories.find((c) => c.legacyKey === "outros")).toMatchObject({ centerName: null, centerSource: null });
  });

  it("rodar de novo depois de importar não cria nada (mesma chave antiga ou mesmo nome)", () => {
    const first = planLegacyImport({ setting, centers: [], categories: [], payables, defaultCenterName: "Administrativo" });
    const createdCenters = first.centers.map((c, i) => center(`cc_${i}`, c.name, { legacyKey: c.legacyKey }));
    const createdCategories = first.categories.map((c, i) => cat(`fc_${i}`, c.name, "despesa", createdCenters.find((x) => x.name === c.centerName)!.id, { legacyKey: c.legacyKey }));
    const second = planLegacyImport({ setting, centers: createdCenters, categories: createdCategories, payables, defaultCenterName: "Administrativo" });
    expect(second.centers).toEqual([]);
    expect(second.categories).toEqual([]);
    expect(second.skippedCenters.length).toBe(2);
    expect(second.skippedCategories.length).toBe(6);
    expect(registryProblems(createdCategories, createdCenters)).toEqual([]);
  });

  it("cadastro manual com o mesmo nome conta como já existente", () => {
    const plan = planLegacyImport({ setting, centers: [center("cc_t", "TECNOLOGIA")], categories: [cat("fc_s", "software e assinaturas", "despesa", "cc_t")], payables, defaultCenterName: "Tecnologia" });
    expect(plan.centers.map((c) => c.name)).toEqual(["Administrativo"]);
    expect(plan.categories.map((c) => c.legacyKey)).not.toContain("software");
  });
});

describe("conta financeira: saldo", () => {
  it("sem lançamentos, saldo = saldo inicial", () => {
    expect(accountBalance({ id: "fa_1", initialBalance: 1500.1 })).toBe(1500.1);
  });
  it("soma entradas e subtrai saídas só da própria conta, em centavos", () => {
    const movements = [
      { accountId: "fa_1", direction: "entrada" as const, amount: 0.1 },
      { accountId: "fa_1", direction: "entrada" as const, amount: 0.2 },
      { accountId: "fa_1", direction: "saida" as const, amount: 100 },
      { accountId: "fa_2", direction: "entrada" as const, amount: 999 },
    ];
    expect(accountBalance({ id: "fa_1", initialBalance: 1000 }, movements)).toBe(900.3);
  });
});

describe("invariantes da hierarquia (verify.ts)", () => {
  it("dados consistentes não acusam nada", () => {
    expect(registryProblems(categories, centers)).toEqual([]);
  });
  it("acusa categoria sem centro, subcategoria com centro próprio, mãe inexistente e tipo diferente", () => {
    const bad = [cat("a", "A", "despesa", undefined), { ...sub("b", "B", motoristas), costCenterId: "cc_ops" }, { ...sub("c", "C", motoristas), parentId: "nao" }, { ...sub("d", "D", motoristas), type: "receita" as const }, motoristas];
    const problems = registryProblems(bad, centers);
    expect(problems).toHaveLength(4);
  });
});
