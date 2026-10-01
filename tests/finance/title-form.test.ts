/**
 * Etapa CP/CR 4 — formulário de títulos: máscara de dinheiro em centavos (src/lib/money-mask.ts), repetição
 * Único/Fixo/Parcelado com intervalo em dias/semanas/meses (src/domain/title-repeat.ts) e classificação
 * Centro → Categoria → Subcategoria com o mapeamento para os campos antigos (src/domain/title-classification.ts).
 * Inclui os casos do checklist: "1250" → "12,50"; parcelado R$ 1.000 em 3 → 333,33 + 333,33 + 333,34 com (1/3),(2/3),(3/3);
 * fixo mensal 31/01 → 31/01, 28/02, 31/03; a cada 2 semanas 01/10 → 01/10, 15/10, 29/10.
 */
import { describe, expect, it } from "vitest";
import { formatMoneyInput, MONEY_MAX_DIGITS, moneyInputStep, moneyInputText, parseMoneyInput } from "@/lib/money-mask";
import { addInterval, describeRepeat, installmentSuffix, normalizeRepeat, planOccurrences, REPEAT_MAX_OCCURRENCES, stripInstallmentSuffix } from "@/domain/title-repeat";
import { categoriesForCenter, classificationLabel, classificationOptions, ENGINE_ONLY_CATEGORY_KEYS, hasClassification, legacyPayableFields, resolveClassification, splitCategoryId, splitCategoryOption, subcategoriesOf, titleCategoryId } from "@/domain/title-classification";
import type { CostCenter, FinanceCategory } from "@/domain/types";

// ---------------------------------------------------------------------------
// Máscara de dinheiro
// ---------------------------------------------------------------------------

/** Simula a digitação tecla a tecla (o texto exibido volta formatado a cada tecla). */
function type(keys: string, options: { allowNegative?: boolean; start?: number | null } = {}): { value: number | null; text: string } {
  let state = { value: options.start ?? null, negativeDraft: false };
  for (const k of keys) state = moneyInputStep(moneyInputText(state.value, state.negativeDraft) + k, state, { allowNegative: options.allowNegative });
  return { value: state.value, text: moneyInputText(state.value, state.negativeDraft) };
}

describe("máscara de dinheiro (centavos)", () => {
  it('"1250" → "12,50" (checklist) e o valor real em número', () => {
    expect(type("1250")).toEqual({ value: 12.5, text: "12,50" });
  });
  it("milhar com ponto e centavos sempre com 2 dígitos", () => {
    expect(type("125000").text).toBe("1.250,00");
    expect(type("100000000").text).toBe("1.000.000,00");
    expect(type("5").text).toBe("0,05");
    expect(type("50").text).toBe("0,50");
    expect(formatMoneyInput(1234567.8)).toBe("1.234.567,80");
    expect(formatMoneyInput(0)).toBe("0,00");
    expect(formatMoneyInput(null)).toBe("");
  });
  it("apagar (backspace) remove o último dígito e esvaziar dá null", () => {
    expect(parseMoneyInput("12,5")).toBe(1.25);
    expect(parseMoneyInput("0,0")).toBeNull();
    expect(parseMoneyInput("")).toBeNull();
  });
  it("ignora letras e símbolos; colar 'R$ 1.250,00' mantém o valor", () => {
    expect(parseMoneyInput("R$ 1.250,00")).toBe(1250);
    expect(parseMoneyInput("abc")).toBeNull();
    expect(type("1a2b").value).toBe(0.12);
  });
  it("centavos exatos sem erro de ponto flutuante", () => {
    expect(parseMoneyInput("333,33")).toBe(333.33);
    expect(formatMoneyInput(0.1 + 0.2)).toBe("0,30");
    expect(formatMoneyInput(333.335)).toBe("333,34");
  });
  it("limite de dígitos", () => {
    const v = parseMoneyInput("9".repeat(MONEY_MAX_DIGITS + 5));
    expect(v).toBe(Number("9".repeat(MONEY_MAX_DIGITS)) / 100);
  });
  it("negativo só com allowNegative: '-' liga e desliga o sinal", () => {
    expect(type("-1500").value).toBe(15);
    expect(type("-1500", { allowNegative: true })).toEqual({ value: -15, text: "-15,00" });
    // "-" de novo volta a positivo; apagar o "-" também.
    expect(type("-", { allowNegative: true, start: -15 }).value).toBe(15);
    expect(parseMoneyInput("15,00", { allowNegative: true, previousNegative: true })).toBe(15);
    expect(parseMoneyInput("-15,003", { allowNegative: true, previousNegative: true })).toBe(-150.03);
    // "-" com o campo vazio fica pendente e o próximo dígito já nasce negativo; apagar o "-" desfaz.
    expect(type("-", { allowNegative: true })).toEqual({ value: null, text: "-" });
    expect(moneyInputStep("", { value: null, negativeDraft: true }, { allowNegative: true })).toEqual({ value: null, negativeDraft: false });
    expect(type("1500-", { allowNegative: true }).value).toBe(-15);
  });
});

// ---------------------------------------------------------------------------
// Repetição
// ---------------------------------------------------------------------------

describe("repetição Único / Fixo / Parcelado", () => {
  it("parcelado R$ 1.000 em 3 → 333,33 + 333,33 + 333,34 e (1/3),(2/3),(3/3) (checklist, sobra na última)", () => {
    const r = planOccurrences({ description: "Notebook", amount: 1000, dueDate: "2026-10-10", repeat: { mode: "parcelado", count: 3 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((o) => o.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(r.value.map((o) => o.description)).toEqual(["Notebook (1/3)", "Notebook (2/3)", "Notebook (3/3)"]);
    expect(r.value.map((o) => o.installment)).toEqual([{ n: 1, total: 3 }, { n: 2, total: 3 }, { n: 3, total: 3 }]);
    expect(r.value.map((o) => o.dueDate)).toEqual(["2026-10-10", "2026-11-10", "2026-12-10"]);
    expect(r.value.reduce((s, o) => s + Math.round(o.amount * 100), 0)).toBe(100000);
  });
  it("fixo mensal a partir de 31/01 → 31/01, 28/02, 31/03 (sempre do dia ORIGINAL), mesmo valor e descrição sem sufixo", () => {
    const r = planOccurrences({ description: "Aluguel", amount: 2500, dueDate: "2027-01-31", repeat: { mode: "fixo", count: 3, every: 1, unit: "meses" } });
    expect(r.ok && r.value.map((o) => o.dueDate)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(r.ok && r.value.map((o) => o.amount)).toEqual([2500, 2500, 2500]);
    expect(r.ok && r.value.map((o) => o.description)).toEqual(["Aluguel", "Aluguel", "Aluguel"]);
    expect(r.ok && r.value.every((o) => o.installment === undefined)).toBe(true);
  });
  it("29/02 em ano bissexto e 31 → 30 → 31 nos meses", () => {
    const r = planOccurrences({ description: "X", amount: 10, dueDate: "2028-01-31", repeat: { mode: "fixo", count: 4 } });
    expect(r.ok && r.value.map((o) => o.dueDate)).toEqual(["2028-01-31", "2028-02-29", "2028-03-31", "2028-04-30"]);
    const leap = planOccurrences({ description: "X", amount: 10, dueDate: "2028-02-29", repeat: { mode: "fixo", count: 3, every: 12, unit: "meses" } });
    expect(leap.ok && leap.value.map((o) => o.dueDate)).toEqual(["2028-02-29", "2029-02-28", "2030-02-28"]);
  });
  it("a cada 2 semanas a partir de 01/10 → 01/10, 15/10, 29/10 (checklist)", () => {
    const r = planOccurrences({ description: "Diária", amount: 80, dueDate: "2026-10-01", repeat: { mode: "fixo", count: 3, every: 2, unit: "semanas" } });
    expect(r.ok && r.value.map((o) => o.dueDate)).toEqual(["2026-10-01", "2026-10-15", "2026-10-29"]);
  });
  it("intervalo em dias é soma de calendário (atravessa mês e ano)", () => {
    const r = planOccurrences({ description: "X", amount: 1, dueDate: "2026-12-20", repeat: { mode: "fixo", count: 3, every: 10, unit: "dias" } });
    expect(r.ok && r.value.map((o) => o.dueDate)).toEqual(["2026-12-20", "2026-12-30", "2027-01-09"]);
    expect(addInterval("2028-02-28", 1, "dias")).toBe("2028-02-29");
    expect(addInterval("2027-02-28", 1, "dias")).toBe("2027-03-01");
  });
  it("competência acompanha o vencimento (vazia = mês do vencimento; informada anda os mesmos meses)", () => {
    const empty = planOccurrences({ description: "X", amount: 1, dueDate: "2026-12-20", repeat: { mode: "fixo", count: 3, every: 3, unit: "semanas" } });
    expect(empty.ok && empty.value.map((o) => [o.dueDate, o.competence])).toEqual([
      ["2026-12-20", "2026-12"],
      ["2027-01-10", "2027-01"],
      ["2027-01-31", "2027-01"],
    ]);
    const given = planOccurrences({ description: "X", amount: 1, dueDate: "2026-11-05", competence: "2026-10", repeat: { mode: "parcelado", count: 3 } });
    expect(given.ok && given.value.map((o) => o.competence)).toEqual(["2026-10", "2026-11", "2026-12"]);
    const single = planOccurrences({ description: "X", amount: 1, dueDate: "2026-11-05" });
    expect(single.ok && single.value).toEqual([{ index: 1, total: 1, description: "X", amount: 1, dueDate: "2026-11-05", competence: "2026-11" }]);
  });
  it("limites: ao menos 2 ocorrências, no máximo 120, intervalo ≥ 1, unidade válida", () => {
    expect(planOccurrences({ description: "X", amount: 10, dueDate: "2026-10-01", repeat: { mode: "fixo", count: 1 } }).ok).toBe(false);
    expect(planOccurrences({ description: "X", amount: 10, dueDate: "2026-10-01", repeat: { mode: "fixo", count: REPEAT_MAX_OCCURRENCES + 1 } }).ok).toBe(false);
    const max = planOccurrences({ description: "X", amount: 10, dueDate: "2026-10-01", repeat: { mode: "parcelado", count: REPEAT_MAX_OCCURRENCES } });
    expect(max.ok && max.value.length).toBe(REPEAT_MAX_OCCURRENCES);
    expect(max.ok && max.value[119].dueDate).toBe("2036-09-01");
    expect(planOccurrences({ description: "X", amount: 10, dueDate: "2026-10-01", repeat: { mode: "fixo", count: 3, every: 0 } }).ok).toBe(false);
    expect(planOccurrences({ description: "X", amount: 10, dueDate: "2026-10-01", repeat: { mode: "fixo", count: 3, every: 1.5 } }).ok).toBe(false);
    expect(normalizeRepeat({ mode: "fixo", count: 3, unit: "anos" as never }).ok).toBe(false);
    expect(normalizeRepeat(undefined)).toEqual({ ok: true, value: { mode: "unico", count: 1, every: 1, unit: "meses" } });
  });
  it("parcela menor que R$ 0,01, valor zero e vencimento ausente são recusados", () => {
    expect(planOccurrences({ description: "X", amount: 0.02, dueDate: "2026-10-01", repeat: { mode: "parcelado", count: 3 } })).toEqual({ ok: false, error: "Valor total menor que R$ 0,01 por parcela" });
    expect(planOccurrences({ description: "X", amount: 0, dueDate: "2026-10-01" }).ok).toBe(false);
    expect(planOccurrences({ description: "X", amount: 10, dueDate: "" }).ok).toBe(false);
    expect(planOccurrences({ description: "X", amount: 10, dueDate: "2026-10-01", competence: "2026-13" }).ok).toBe(false);
  });
  it("sufixo de parcela: novo formato ' (i/N)' e clonar tira o novo e o antigo ' (parcela i/N)'", () => {
    expect(installmentSuffix(3, 12)).toBe(" (3/12)");
    expect(stripInstallmentSuffix("Notebook (2/3)")).toBe("Notebook");
    expect(stripInstallmentSuffix("Notebook (parcela 2/3)")).toBe("Notebook");
    expect(stripInstallmentSuffix("Serviço (urgente)")).toBe("Serviço (urgente)");
    expect(stripInstallmentSuffix("Serviço — Resíduo")).toBe("Serviço — Resíduo");
  });
  it("resumo da repetição para o histórico", () => {
    expect(describeRepeat({ mode: "parcelado", count: 3 })).toBe("Parcelado em 3 · a cada 1 mês(es)");
    expect(describeRepeat({ mode: "fixo", count: 4, every: 2, unit: "semanas" })).toBe("Fixo 4× · a cada 2 semana(s)");
    expect(describeRepeat(undefined)).toBe("Único");
  });
});

// ---------------------------------------------------------------------------
// Classificação Centro → Categoria → Subcategoria
// ---------------------------------------------------------------------------

const base = { organizationId: "intercert", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const center = (id: string, name: string, extra: Partial<CostCenter> = {}): CostCenter => ({ ...base, id, name, archived: false, ...extra });
const cat = (id: string, name: string, type: "receita" | "despesa", parentId: string | null, costCenterId?: string, extra: Partial<FinanceCategory> = {}): FinanceCategory => ({ ...base, id, name, type, parentId, costCenterId, archived: false, ...extra });

const centers = [center("cc_adm", "Administrativo", { legacyKey: "Administrativo" }), center("cc_ops", "Operações"), center("cc_old", "Antigo", { archived: true })];
const categories = [
  cat("c_adm", "Despesas administrativas", "despesa", null, "cc_adm", { legacyKey: "administrativo" }),
  cat("c_mat", "Material", "despesa", "c_adm"),
  cat("c_lim", "Limpeza", "despesa", "c_adm", undefined, { archived: true }),
  cat("c_mot", "Motoristas", "despesa", null, "cc_ops"),
  cat("c_dia", "Diárias", "despesa", "c_mot"),
  cat("c_com", "Comissão comercial", "despesa", null, "cc_ops", { legacyKey: "comissao_comercial" }),
  cat("c_rec", "Consultoria", "receita", null, "cc_ops"),
  cat("c_rec_sub", "Parametrização", "receita", "c_rec"),
  cat("c_arch", "Arquivada", "despesa", null, "cc_adm", { archived: true }),
];

describe("classificação no formulário", () => {
  it("a pagar lista só DESPESA e a receber só RECEITA (ativas); centros ativos", () => {
    const pay = classificationOptions(categories, centers, "despesa", { excludeEngineOnly: true });
    expect(pay.categories.map((c) => c.value)).toEqual(["c_adm", "c_mot"]);
    expect(pay.subcategories.map((c) => c.value)).toEqual(["c_dia", "c_mat"]);
    expect(pay.centers.map((c) => c.value)).toEqual(["cc_adm", "cc_ops"]);
    const rec = classificationOptions(categories, centers, "receita");
    expect(rec.categories.map((c) => c.value)).toEqual(["c_rec"]);
    expect(rec.subcategories.map((c) => c.value)).toEqual(["c_rec_sub"]);
    expect(hasClassification(rec)).toBe(true);
    expect(hasClassification(classificationOptions([], centers, "receita"))).toBe(false);
    // Sem excluir as do motor, "Comissão comercial" aparece (relatórios, outras telas).
    expect(classificationOptions(categories, centers, "despesa").categories.map((c) => c.value)).toContain("c_com");
    expect(ENGINE_ONLY_CATEGORY_KEYS).toContain("estorno_comissao");
  });
  it("escolher o centro filtra as categorias; a já escolhida continua (centro editável)", () => {
    const pay = classificationOptions(categories, centers, "despesa", { excludeEngineOnly: true });
    expect(categoriesForCenter(pay, "cc_ops").map((c) => c.value)).toEqual(["c_mot"]);
    expect(categoriesForCenter(pay, "").map((c) => c.value)).toEqual(["c_adm", "c_mot"]);
    expect(categoriesForCenter(pay, "cc_ops", "c_adm").map((c) => c.value)).toEqual(["c_adm", "c_mot"]);
    // Escolher a categoria preenche o centro: o centro gravado nela.
    expect(pay.categories.find((c) => c.value === "c_mot")?.costCenterId).toBe("cc_ops");
  });
  it("subcategoria lista só as filhas ativas da categoria escolhida", () => {
    const pay = classificationOptions(categories, centers, "despesa");
    expect(subcategoriesOf(pay, "c_adm").map((s) => s.value)).toEqual(["c_mat"]);
    expect(subcategoriesOf(pay, "c_mot").map((s) => s.value)).toEqual(["c_dia"]);
    expect(subcategoriesOf(pay, "")).toEqual([]);
  });
  it("grava a subcategoria quando escolhida, senão a categoria; ao editar separa de volta", () => {
    expect(titleCategoryId({ categoryId: "c_mot", subcategoryId: "c_dia" })).toBe("c_dia");
    expect(titleCategoryId({ categoryId: "c_mot", subcategoryId: "" })).toBe("c_mot");
    expect(titleCategoryId({})).toBeUndefined();
    expect(splitCategoryId("c_dia", categories)).toEqual({ categoryId: "c_mot", subcategoryId: "c_dia" });
    expect(splitCategoryId("c_mot", categories)).toEqual({ categoryId: "c_mot", subcategoryId: "" });
    expect(splitCategoryId(undefined, categories)).toEqual({ categoryId: "", subcategoryId: "" });
    const pay = classificationOptions(categories, centers, "despesa");
    expect(splitCategoryOption("c_dia", pay)).toEqual({ categoryId: "c_mot", subcategoryId: "c_dia" });
    expect(splitCategoryOption("c_mot", pay)).toEqual({ categoryId: "c_mot", subcategoryId: "" });
  });
  it("valida tipo, arquivamento, chaves do motor e centro", () => {
    expect(resolveClassification({ categoryId: "c_rec" }, "despesa", categories, centers).ok).toBe(false);
    expect(resolveClassification({ categoryId: "c_rec_sub" }, "despesa", categories, centers).ok).toBe(false);
    expect(resolveClassification({ categoryId: "c_mat" }, "receita", categories, centers).ok).toBe(false);
    expect(resolveClassification({ categoryId: "c_arch" }, "despesa", categories, centers).ok).toBe(false);
    expect(resolveClassification({ categoryId: "c_lim" }, "despesa", categories, centers).ok).toBe(false);
    expect(resolveClassification({ categoryId: "c_com" }, "despesa", categories, centers, { excludeEngineOnly: true })).toEqual({ ok: false, error: "Comissões e estornos nascem do motor de comissões, não de lançamento manual" });
    expect(resolveClassification({ costCenterId: "cc_old" }, "despesa", categories, centers).ok).toBe(false);
    expect(resolveClassification({ costCenterId: "x" }, "despesa", categories, centers).ok).toBe(false);
    expect(resolveClassification({}, "despesa", categories, centers)).toEqual({ ok: true, value: { categoryId: undefined, costCenterId: undefined, effectiveCostCenterId: undefined, names: {} } });
  });
  it("subcategoria sem centro próprio entra no centro da mãe; centro próprio vence", () => {
    const sub = resolveClassification({ categoryId: "c_dia" }, "despesa", categories, centers);
    expect(sub.ok && sub.value).toEqual({ categoryId: "c_dia", costCenterId: undefined, effectiveCostCenterId: "cc_ops", names: { category: "Motoristas", subcategory: "Diárias", center: "Operações" } });
    const own = resolveClassification({ categoryId: "c_dia", costCenterId: "cc_adm" }, "despesa", categories, centers);
    expect(own.ok && own.value.effectiveCostCenterId).toBe("cc_adm");
    expect(classificationLabel({ category: "Motoristas", subcategory: "Diárias" })).toBe("Motoristas › Diárias");
    expect(classificationLabel({})).toBeUndefined();
  });
  it("campos antigos derivados: chave antiga da categoria (ou da mãe), senão 'outros'; chave antiga do centro, senão o nome", () => {
    // Subcategoria de categoria importada da configuração: herda a chave antiga da mãe.
    expect(legacyPayableFields({ categoryId: "c_mat", effectiveCostCenterId: "cc_adm" }, categories, centers)).toEqual({ category: "administrativo", costCenter: "Administrativo" });
    // Categoria criada no cadastro (sem chave antiga) → "outros"; centro sem chave antiga → nome do centro.
    expect(legacyPayableFields({ categoryId: "c_dia", effectiveCostCenterId: "cc_ops" }, categories, centers)).toEqual({ category: "outros", costCenter: "Operações" });
    expect(legacyPayableFields({}, categories, centers)).toEqual({ category: undefined, costCenter: undefined });
  });
});
