/**
 * Simulação de preço (pacote + módulos avulsos) SEM COBRANÇA DUPLA. Módulo puro: roda no servidor e na tela.
 *
 * Regras:
 * 1. O pacote é cobrado pela versão vigente na data; as unidades dele não são cobradas de novo como avulsas.
 * 2. Dentro do pacote, cada unidade vem com a quantidade incluída no preço dela (no mínimo 1). Quantidade a mais é
 *    cobrada só pelo que passa: por_quantidade = unidades adicionais × valor por unidade; por_faixa = diferença entre
 *    a faixa da quantidade pedida e a primeira faixa (o pacote cobre a primeira); fixo = nada a mais.
 * 3. Avulso fora do pacote: preço vigente na data para a quantidade; sem ficha "à venda" ou sem preço vigente, a
 *    linha fica "sem preço" e o total é marcado incompleto (nunca se inventa preço).
 * 4. Unidade que o ERP não vende (não homologada) ou descontinuada não é cobrada: aparece como indisponível.
 * 5. Dependências (técnicas do catálogo e comerciais da ficha) que faltam no conjunto são apontadas, não incluídas
 *    sozinhas: quem vende decide.
 */
import {
  COMMERCIAL_STATUS_LABELS,
  money,
  monthlyFor,
  tierFor,
  versionAt,
  type CommercialModule,
  type PackageVersion,
  type PriceVersion,
  type ProductPackage,
} from "./commercial";

/** O que a simulação precisa saber de cada unidade comercial do catálogo (montado pelo servidor). */
export interface QuoteUnit {
  code: string;
  name: string;
  /** Código e nome do módulo do ERP (NN). */
  module: string;
  moduleName: string;
  /** Unidades exigidas diretamente (dependências técnicas já resolvidas para unidades). */
  requires: string[];
  /** O ERP vende hoje (homologado). */
  sellable: boolean;
}

export interface QuoteItem {
  code: string;
  quantity: number;
}

export type QuoteLineStatus = "cobrado" | "incluido" | "sem_preco" | "indisponivel";

export const QUOTE_LINE_STATUS_LABELS: Record<QuoteLineStatus, string> = {
  cobrado: "Cobrado",
  incluido: "Incluído",
  sem_preco: "Sem preço",
  indisponivel: "Indisponível",
};

export interface QuoteLine {
  /** Código da unidade ou id do pacote. */
  code: string;
  kind: "pacote" | "modulo";
  name: string;
  quantity: number;
  monthly: number;
  setup: number;
  status: QuoteLineStatus;
  /** Por que o valor é esse (incluído no pacote, adicional além do incluído, sem preço…). */
  note: string | null;
  /** Versão de preço usada (para a proposta guardar a referência). */
  priceVersion: number | null;
}

export interface QuoteResult {
  date: string;
  lines: QuoteLine[];
  monthly: number;
  setup: number;
  /** Todas as linhas cobráveis têm preço vigente. */
  complete: boolean;
  /** Unidades exigidas que não estão no conjunto, com quem exige cada uma. */
  missingDependencies: { code: string; name: string; requiredBy: string[] }[];
  warnings: string[];
  /** Quanto custariam as unidades do pacote compradas avulsas (para mostrar a economia). */
  packageComparison: PackageComparison | null;
}

export interface PackageComparison {
  monthly: number;
  setup: number;
  /** Unidades do pacote sem preço avulso vigente (a comparação fica parcial). */
  unpriced: string[];
  /** Economia mensal do pacote sobre os avulsos (negativa = o pacote sai mais caro). */
  savingMonthly: number;
  /** Economia em % da soma avulsa (null quando a soma é 0). */
  savingPct: number | null;
}

export interface QuoteInput {
  date: string;
  units: ReadonlyMap<string, QuoteUnit>;
  modules: ReadonlyMap<string, CommercialModule>;
  pkg: ProductPackage | null;
  items: readonly QuoteItem[];
}

/** Junta itens repetidos (soma as quantidades) e descarta quantidades inválidas. */
export function normalizeItems(items: readonly QuoteItem[]): QuoteItem[] {
  const byCode = new Map<string, number>();
  for (const item of items) {
    const q = Math.max(1, Math.floor(Number(item.quantity) || 1));
    byCode.set(item.code, (byCode.get(item.code) ?? 0) + q);
  }
  return [...byCode.entries()].map(([code, quantity]) => ({ code, quantity }));
}

/** Preço avulso vigente de uma unidade (null = sem ficha à venda ou sem versão vigente). */
export function sellingPrice(record: CommercialModule | undefined, date: string): PriceVersion | null {
  if (!record || record.status !== "a_venda") return null;
  return versionAt(record.prices, date);
}

export function quote(input: QuoteInput): QuoteResult {
  const { date, units, modules, pkg } = input;
  const lines: QuoteLine[] = [];
  const warnings: string[] = [];
  let complete = true;

  const pkgVersion: PackageVersion | null = pkg ? versionAt(pkg.versions, date) : null;
  const inPackage = new Set(pkgVersion?.units ?? []);
  if (pkg) {
    if (pkg.status !== "a_venda") warnings.push(`O pacote ${pkg.name} está ${pkg.status === "rascunho" ? "em definição" : "descontinuado"}: confira antes de oferecer.`);
    if (!pkgVersion) {
      complete = false;
      lines.push({ code: pkg.id, kind: "pacote", name: pkg.name, quantity: 1, monthly: 0, setup: 0, status: "sem_preco", note: "Sem versão vigente na data.", priceVersion: null });
    } else {
      lines.push({ code: pkg.id, kind: "pacote", name: pkg.name, quantity: 1, monthly: money(pkgVersion.monthly), setup: money(pkgVersion.setup), status: "cobrado", note: `${pkgVersion.units.length} módulos incluídos`, priceVersion: pkgVersion.version });
      for (const code of pkgVersion.units) {
        const unit = units.get(code);
        if (!unit) warnings.push(`O pacote inclui ${code}, que não está no catálogo atual do ERP.`);
        else if (!unit.sellable) warnings.push(`O pacote inclui ${code} ${unit.name}, que o ERP ainda não vende (não homologado).`);
      }
    }
  }

  const items = normalizeItems(input.items);
  const selected = new Set([...inPackage, ...items.map((i) => i.code)]);

  for (const item of items) {
    const unit = units.get(item.code);
    const record = modules.get(item.code);
    const name = record?.name ?? unit?.name ?? item.code;
    const base = { code: item.code, kind: "modulo" as const, name, quantity: item.quantity };
    if (!unit) {
      lines.push({ ...base, monthly: 0, setup: 0, status: "indisponivel", note: "Não é uma unidade comercial do catálogo atual do ERP.", priceVersion: null });
      continue;
    }
    if (!unit.sellable) {
      lines.push({ ...base, monthly: 0, setup: 0, status: "indisponivel", note: "O ERP ainda não vende esta unidade (não homologada).", priceVersion: null });
      continue;
    }
    if (record?.status === "descontinuado") {
      lines.push({ ...base, monthly: 0, setup: 0, status: "indisponivel", note: "Descontinuado: não entra em vendas novas.", priceVersion: null });
      continue;
    }
    if (inPackage.has(item.code) && pkg) {
      // Já está no pacote: só a quantidade além da incluída é cobrada.
      const price = versionAt(record?.prices ?? [], date);
      const extra = price ? extraInsidePackage(price, item.quantity) : 0;
      lines.push({
        ...base,
        monthly: extra,
        setup: 0,
        status: extra > 0 ? "cobrado" : "incluido",
        note: extra > 0 ? `No pacote ${pkg.name}; cobrado só o que passa do incluído.` : `Já está no pacote ${pkg.name}: não é cobrado de novo.`,
        priceVersion: extra > 0 && price ? price.version : null,
      });
      continue;
    }
    const price = sellingPrice(record, date);
    if (!price) {
      complete = false;
      const why = !record ? "Sem ficha comercial." : record.status !== "a_venda" ? `${COMMERCIAL_STATUS_LABELS[record.status]}.` : "Sem preço vigente na data.";
      lines.push({ ...base, monthly: 0, setup: 0, status: "sem_preco", note: why, priceVersion: null });
      continue;
    }
    lines.push({ ...base, monthly: monthlyFor(price, item.quantity), setup: money(price.setup), status: "cobrado", note: null, priceVersion: price.version });
  }

  // Dependências técnicas (catálogo) e comerciais (ficha) que faltam no conjunto.
  const missing = new Map<string, Set<string>>();
  for (const code of selected) {
    const needs = [...(units.get(code)?.requires ?? []), ...(modules.get(code)?.requiresCommercial ?? [])];
    for (const dep of needs) {
      if (selected.has(dep) || dep === code) continue;
      const set = missing.get(dep) ?? new Set<string>();
      set.add(code);
      missing.set(dep, set);
    }
  }
  const missingDependencies = [...missing.entries()]
    .map(([code, by]) => ({ code, name: modules.get(code)?.name ?? units.get(code)?.name ?? code, requiredBy: [...by].sort() }))
    .sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true }));

  const charged = lines.filter((l) => l.status === "cobrado");
  return {
    date,
    lines,
    monthly: money(charged.reduce((s, l) => s + l.monthly, 0)),
    setup: money(charged.reduce((s, l) => s + l.setup, 0)),
    complete,
    missingDependencies,
    warnings,
    packageComparison: pkgVersion ? comparePackage(pkgVersion, modules, date) : null,
  };
}

/** Mensalidade além do que o pacote já cobre (ver regra 2). */
export function extraInsidePackage(price: PriceVersion, quantity: number): number {
  const q = Math.max(1, Math.floor(quantity || 1));
  if (price.model === "por_quantidade") return money(Math.max(0, q - Math.max(1, price.includedQuantity)) * price.unitPrice);
  if (price.model === "por_faixa") {
    const first = price.tiers[0];
    const tier = tierFor(price.tiers, q);
    return first && tier ? money(Math.max(0, tier.monthly - first.monthly)) : 0;
  }
  return 0;
}

/** Soma avulsa (quantidade 1) das unidades do pacote e a economia do pacote sobre ela. */
export function comparePackage(version: Pick<PackageVersion, "units" | "monthly" | "setup">, modules: ReadonlyMap<string, CommercialModule>, date: string): PackageComparison {
  let monthly = 0;
  let setup = 0;
  const unpriced: string[] = [];
  for (const code of version.units) {
    const price = sellingPrice(modules.get(code), date);
    if (!price) {
      unpriced.push(code);
      continue;
    }
    monthly += monthlyFor(price, 1);
    setup += price.setup;
  }
  monthly = money(monthly);
  const savingMonthly = money(monthly - version.monthly);
  return { monthly, setup: money(setup), unpriced, savingMonthly, savingPct: monthly > 0 ? Math.round((savingMonthly / monthly) * 1000) / 10 : null };
}

/** Problemas de um conjunto de unidades para um pacote: erros (bloqueiam) e avisos. */
export function packageUnitProblems(codes: readonly string[], units: ReadonlyMap<string, QuoteUnit>, modules: ReadonlyMap<string, CommercialModule>): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!codes.length) errors.push("Escolha pelo menos um módulo para o pacote.");
  const set = new Set(codes);
  if (set.size !== codes.length) errors.push("Há módulos repetidos no pacote.");
  for (const code of set) {
    const unit = units.get(code);
    if (!unit) {
      errors.push(`${code} não é uma unidade comercial do catálogo do ERP.`);
      continue;
    }
    if (!unit.sellable) warnings.push(`${code} ${unit.name}: o ERP ainda não vende (não homologado).`);
    if (modules.get(code)?.status === "descontinuado") warnings.push(`${code} ${unit.name}: descontinuado.`);
    for (const dep of unit.requires) if (!set.has(dep)) warnings.push(`${code} ${unit.name} exige ${dep} ${units.get(dep)?.name ?? ""}`.trim() + ", que não está no pacote.");
  }
  return { errors, warnings };
}
