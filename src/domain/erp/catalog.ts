/**
 * Catálogo técnico de módulos do ERP Intercert (contrato v2, `catalogo-modulos-erp-v2`), normalizado para o INTEROS.
 * Módulo puro: usado pelo servidor (importação, validação) e pelas telas (árvore, busca, dependências).
 *
 * Hierarquia: Produto → Módulo (NN) → Submódulo (NN.SS) → Recurso (NN.SS.RR). O catálogo é a fonte ÚNICA dos códigos,
 * nomes, dependências e disponibilidade técnica: o INTEROS não cria nem renomeia itens, só acrescenta a camada
 * comercial (contratação por empresa) por cima.
 *
 * Contratação (decisão 4 do contrato v2): só as UNIDADES COMERCIAIS são contratadas (`commercialUnit === code`). Cada
 * outro item está "incluído" numa unidade (`includedIn`, às vezes em cadeia), é da plataforma (CORE, sempre ativo), é
 * recurso compartilhado/integração/permissão, ou é futuro (não existe ainda no ERP e nunca aparece como operacional).
 */

export type ErpItemLevel = "module" | "submodule" | "resource";

/** Situação técnica no ERP (devStatus). Valores desconhecidos são preservados e tratados como "não operacional". */
export const ERP_DEV_STATUS_LABELS: Record<string, string> = {
  OP: "Operacional",
  PARC: "Parcial",
  FALHA: "Com falhas",
  DEV: "Em desenvolvimento",
  PLAN: "Planejado",
  NAO: "Não implementado",
  EXT: "Depende de integração externa",
  DESC: "Descontinuado",
};

/** Classe comercial definida pelo ERP. */
export const ERP_COMMERCIAL_CLASS_LABELS: Record<string, string> = {
  CORE: "Plataforma",
  MODULO_COMERCIAL: "Módulo comercial",
  ADD_ON: "Adicional",
  INTEGRACAO: "Integração",
  RECURSO_COMPARTILHADO: "Recurso compartilhado",
  PERMISSAO: "Permissão de perfil",
  RECURSO_FUTURO: "Futuro",
};

export interface ErpCatalogItem {
  code: string;
  level: ErpItemLevel;
  parent: string | null;
  /** Código do módulo raiz (NN). */
  module: string;
  /** Nome para exibição (caixa alta do catálogo convertida, siglas preservadas). */
  name: string;
  description: string | null;
  notes: string | null;
  devStatus: string;
  /** `availability === "disponivel"` no ERP (operacional hoje). */
  available: boolean;
  commercialClass: string;
  /** Item duplicado de outro (mesma funcionalidade, proprietário técnico único). */
  aliasOf: string | null;
  /** Reaproveita a implementação de outro item. */
  reuses: string | null;
  /** Chaves do runtime v1 que este item envolve. */
  v1Keys: string[];
  /** Unidade comercial: a chave do runtime v1 que ela liga e desliga no ERP (ponte para o estado operacional). */
  v1Key: string | null;
  /** É uma unidade comercial (contratada por si). */
  unit: boolean;
  /** Unidade ou item em que este está incluído (sem cobrança própria). */
  includedIn: string | null;
  requires: string[];
  optional: string[];
  /** Permissões de perfil do ERP ligadas ao item (só informação: quem usa é decidido no ERP). */
  permissions: string[];
  routes: string[];
  /** Vendável agora (vem da API quando informado; sem ele, deriva da situação técnica). */
  sellable: boolean | null;
  /** Tipos de empresa a que se aplica (vem da API quando informado). */
  kinds: string[] | null;
  /** O ERP inclui o item ao contratar o módulo pai inteiro (vem da API quando informado). */
  includedInParent: boolean | null;
}

export interface ErpCatalog {
  catalogVersion: string;
  /** Situação declarada pelo ERP (ex.: "proposta — aguarda validação"). */
  status: string | null;
  product: { code: string; name: string } | null;
  items: ErpCatalogItem[];
}

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : []);
const boolOrNull = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

const CODE = /^\d{2}(\.\d{2}){0,2}$/;

/** Siglas que continuam em caixa alta quando o nome do catálogo vem todo em maiúsculas. */
const ACRONYMS = new Map(
  ["PDV", "CRM", "WMS", "PCP", "ERP", "TEF", "API", "APIS", "PIX", "RH", "DP", "OS", "SPED", "ICMS", "IPI", "XML", "PDF", "QR", "SMS", "IA", "SKU", "MRP", "NCM", "CFOP", "CNPJ", "CPF", "B2B", "B2C", "KDS", "ABC"].map((a) => [a, a]),
);
const SPECIAL = new Map([
  ["NF-E", "NF-e"],
  ["NFC-E", "NFC-e"],
  ["NFS-E", "NFS-e"],
  ["CT-E", "CT-e"],
  ["MDF-E", "MDF-e"],
  ["E-COMMERCE", "E-commerce"],
  ["WHATSAPP", "WhatsApp"],
]);

/** "PDV — PONTO DE VENDA" → "PDV — Ponto de venda". Nomes que não estão todos em maiúsculas ficam como vieram. */
export function displayItemName(raw: string): string {
  const letters = raw.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (!letters || letters !== letters.toUpperCase()) return raw;
  let first = true;
  return raw
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s+$/.test(token) || token === "-" || token === "/") return token;
      if (token === "—" || token === "–") {
        // Depois do travessão começa outra frase: "PDV — Ponto de venda".
        first = true;
        return token;
      }
      const bare = token.replace(/[(),:;]/g, "");
      const special = SPECIAL.get(bare);
      const acronym = ACRONYMS.get(bare);
      let out: string;
      if (special) out = token.replace(bare, first ? special : special === "E-commerce" ? "e-commerce" : special);
      else if (acronym) out = token;
      else {
        const lower = token.toLocaleLowerCase("pt-BR");
        out = first ? lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1) : lower;
      }
      first = false;
      return out;
    })
    .join("");
}

function levelOf(raw: unknown, code: string): ErpItemLevel {
  if (raw === "module" || raw === "submodule" || raw === "resource") return raw;
  const depth = code.split(".").length;
  return depth === 1 ? "module" : depth === 2 ? "submodule" : "resource";
}

/**
 * Lê o documento do catálogo (como devolvido por `GET /api/interos/v2/catalog` ou o arquivo
 * `catalogo-modulos-erp-v2.json`). Campos desconhecidos são ignorados; itens sem código válido são descartados.
 * Lança erro só quando não há lista de itens (documento que não é o catálogo).
 */
export function normalizeCatalog(raw: unknown): ErpCatalog {
  const doc = asRecord(raw);
  const list = doc && Array.isArray(doc.items) ? doc.items : null;
  if (!doc || !list) throw new Error("Documento do catálogo sem a lista de itens.");
  const items: ErpCatalogItem[] = [];
  const seen = new Set<string>();
  // Unidade → chave v1 (o documento traz o inverso em v1Compatibility.unitsByV1Key).
  const keyByUnit = new Map<string, string>();
  const byV1 = asRecord(asRecord(doc.v1Compatibility)?.unitsByV1Key);
  for (const [key, unit] of Object.entries(byV1 ?? {})) if (typeof unit === "string" && !keyByUnit.has(unit)) keyByUnit.set(unit, key);
  for (const entry of list) {
    const r = asRecord(entry);
    const code = str(r?.code);
    if (!r || !code || !CODE.test(code) || seen.has(code)) continue;
    seen.add(code);
    const deps = asRecord(r.dependencies);
    const rawName = str(r.name) ?? code;
    const availability = str(r.availability);
    items.push({
      code,
      level: levelOf(r.level, code),
      parent: str(r.parent),
      module: code.slice(0, 2),
      name: displayItemName(rawName),
      description: str(r.description) && str(r.description) !== rawName ? str(r.description) : null,
      notes: str(r.notes),
      devStatus: str(r.devStatus) ?? "NAO",
      available: availability === "disponivel",
      commercialClass: str(r.commercialClass) ?? "RECURSO_FUTURO",
      aliasOf: str(r.aliasOf),
      reuses: str(r.reuses),
      v1Keys: strList(r.v1Keys),
      v1Key: str(r.commercialUnit) === code ? (keyByUnit.get(code) ?? (strList(r.v1Keys).length === 1 ? strList(r.v1Keys)[0] : null)) : null,
      unit: str(r.commercialUnit) === code,
      includedIn: str(r.includedIn),
      requires: strList(deps?.required),
      optional: strList(deps?.optional),
      permissions: strList(r.permissions),
      routes: strList(r.routes),
      sellable: boolOrNull(r.sellable),
      kinds: Array.isArray(r.kinds) || Array.isArray(r.companyKinds) ? strList(r.kinds ?? r.companyKinds) : null,
      includedInParent: boolOrNull(r.includedInParent),
    });
  }
  items.sort((a, b) => compareCodes(a.code, b.code));
  const product = asRecord(doc.product);
  return {
    catalogVersion: str(doc.catalogVersion) ?? "desconhecida",
    status: str(doc.status),
    product: product && str(product.code) ? { code: str(product.code) as string, name: str(product.name) ?? (str(product.code) as string) } : null,
    items,
  };
}

/** Ordem natural dos códigos: "07" < "07.02" < "07.10" < "08". */
export function compareCodes(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? -1;
    const y = pb[i] ?? -1;
    if (x !== y) return x - y;
  }
  return 0;
}

/** Papel do item na contratação de uma empresa. */
export type ErpItemRole =
  /** Cabeçalho de módulo (agrupa os submódulos; o estado é o resumo dos filhos). */
  | "module"
  /** Unidade comercial: contratada, ligada e desligada por si. */
  | "unit"
  /** Incluída numa unidade (acompanha o estado dela). */
  | "included"
  /** Plataforma: sempre ativo, não pode ser desativado. */
  | "core"
  /** Recurso compartilhado entre módulos (proprietário técnico único). */
  | "shared"
  /** Conector com serviço externo. */
  | "integration"
  /** Permissão de perfil: decidida pelo administrador da empresa no ERP. */
  | "permission"
  /** Planejado ou inexistente: indisponível para contratação. */
  | "future";

export interface ErpCatalogIndex {
  catalog: ErpCatalog;
  byCode: ReadonlyMap<string, ErpCatalogItem>;
  modules: readonly ErpCatalogItem[];
  childrenOf: (code: string) => readonly ErpCatalogItem[];
  units: readonly ErpCatalogItem[];
  roleOf: (code: string) => ErpItemRole;
  /** Unidade comercial que "carrega" o item (a própria, a da cadeia de inclusão ou a do original, se for duplicata). */
  ownerUnitOf: (code: string) => string | null;
  /** Unidades que exigem diretamente a unidade dada (dependentes diretos). */
  dependentUnitsOf: (unitCode: string) => readonly string[];
  /** Unidades exigidas diretamente pela unidade dada (dependências diretas resolvidas para unidades). */
  requiredUnitsOf: (unitCode: string) => readonly string[];
  /** Texto de busca normalizado (código, nome, descrição, observação e chaves v1). */
  searchTextOf: (code: string) => string;
}

/** Texto sem acento e em minúsculas, para busca. */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function indexCatalog(catalog: ErpCatalog): ErpCatalogIndex {
  const byCode = new Map(catalog.items.map((i) => [i.code, i]));
  const children = new Map<string, ErpCatalogItem[]>();
  for (const item of catalog.items) {
    const parent = item.parent ?? (item.level === "module" ? null : item.code.split(".").slice(0, -1).join("."));
    if (!parent) continue;
    const list = children.get(parent) ?? [];
    list.push(item);
    children.set(parent, list);
  }
  const modules = catalog.items.filter((i) => i.level === "module");
  const units = catalog.items.filter((i) => i.unit);

  const ownerCache = new Map<string, string | null>();
  const ownerUnitOf = (code: string): string | null => {
    if (ownerCache.has(code)) return ownerCache.get(code) ?? null;
    const visited = new Set<string>();
    let current: ErpCatalogItem | undefined = byCode.get(code);
    let owner: string | null = null;
    while (current && !visited.has(current.code)) {
      visited.add(current.code);
      if (current.unit) {
        owner = current.code;
        break;
      }
      const next: string | null = current.includedIn ?? current.aliasOf;
      current = next ? byCode.get(next) : undefined;
    }
    ownerCache.set(code, owner);
    return owner;
  };

  const roleCache = new Map<string, ErpItemRole>();
  const roleOf = (code: string): ErpItemRole => {
    const cached = roleCache.get(code);
    if (cached) return cached;
    const item = byCode.get(code);
    let role: ErpItemRole;
    if (!item) role = "future";
    else if (item.level === "module") role = "module";
    else if (item.unit) role = "unit";
    else if (item.commercialClass === "CORE") role = "core";
    else if (ownerUnitOf(code)) role = "included";
    else if (rootIsCore(item, byCode)) role = "core";
    else if (item.commercialClass === "PERMISSAO") role = "permission";
    else if (item.commercialClass === "INTEGRACAO") role = "integration";
    else if (item.commercialClass === "RECURSO_COMPARTILHADO") role = "shared";
    else role = "future";
    roleCache.set(code, role);
    return role;
  };

  // Dependências declaradas entre itens viram dependências entre UNIDADES (o que se contrata).
  const requiredUnits = new Map<string, Set<string>>();
  const dependentUnits = new Map<string, Set<string>>();
  for (const item of catalog.items) {
    const fromUnit = ownerUnitOf(item.code);
    if (!fromUnit) continue;
    for (const dep of item.requires) {
      const toUnit = ownerUnitOf(dep);
      if (!toUnit || toUnit === fromUnit) continue;
      (requiredUnits.get(fromUnit) ?? requiredUnits.set(fromUnit, new Set()).get(fromUnit)!).add(toUnit);
      (dependentUnits.get(toUnit) ?? dependentUnits.set(toUnit, new Set()).get(toUnit)!).add(fromUnit);
    }
  }
  const sortedList = (set: Set<string> | undefined) => (set ? [...set].sort(compareCodes) : []);

  const searchCache = new Map<string, string>();
  const searchTextOf = (code: string): string => {
    const cached = searchCache.get(code);
    if (cached !== undefined) return cached;
    const item = byCode.get(code);
    const text = item ? normalizeSearch([item.code, item.name, item.description ?? "", item.notes ?? "", ...item.v1Keys].join(" ")) : "";
    searchCache.set(code, text);
    return text;
  };

  return {
    catalog,
    byCode,
    modules,
    childrenOf: (code) => children.get(code) ?? [],
    units,
    roleOf,
    ownerUnitOf,
    dependentUnitsOf: (unitCode) => sortedList(dependentUnits.get(unitCode)),
    requiredUnitsOf: (unitCode) => sortedList(requiredUnits.get(unitCode)),
    searchTextOf,
  };
}

/** Item incluído (em cadeia) num item da plataforma: também é da plataforma. */
function rootIsCore(item: ErpCatalogItem, byCode: ReadonlyMap<string, ErpCatalogItem>): boolean {
  const visited = new Set<string>();
  let current: ErpCatalogItem | undefined = item;
  while (current && !visited.has(current.code)) {
    visited.add(current.code);
    if (current.commercialClass === "CORE") return true;
    const next: string | null = current.includedIn ?? current.aliasOf;
    current = next ? byCode.get(next) : undefined;
  }
  return false;
}

/**
 * A unidade pode ser oferecida para contratação agora? Exige existir e estar operacional no ERP (o INTEROS nunca
 * oferece o que o ERP marca como indisponível). Quando a API informa `sellable`, ele manda.
 */
export function isUnitSellable(item: ErpCatalogItem): boolean {
  if (!item.unit) return false;
  if (item.sellable !== null) return item.sellable;
  return SELLABLE_DEV_STATUS.has(item.devStatus);
}

/**
 * Mesma regra do ERP (scripts/modules/build-catalog-v2.ts): unidade implementada — operacional, parcial ou com falhas —
 * é vendável; integração externa pendente (EXT), em desenvolvimento, planejada ou inexistente, não (decisão 1 do
 * contrato v2: só depois da homologação). O ERP recusa ativar o que não é vendável (`not_homologated`).
 */
const SELLABLE_DEV_STATUS = new Set(["OP", "PARC", "FALHA"]);

/**
 * Fechamento das dependências obrigatórias: as unidades pedidas mais todas as que elas exigem (em cadeia). Devolve as
 * incluídas por dependência separadas das pedidas, com quem exigiu cada uma, para a tela explicar o conjunto.
 */
export function requiredClosure(index: ErpCatalogIndex, requested: Iterable<string>, alreadyOn: ReadonlySet<string> = new Set()): { all: string[]; added: { code: string; requiredBy: string }[] } {
  const all = new Set<string>();
  const added: { code: string; requiredBy: string }[] = [];
  const queue: string[] = [];
  for (const code of requested) {
    if (!all.has(code)) {
      all.add(code);
      queue.push(code);
    }
  }
  while (queue.length) {
    const code = queue.shift() as string;
    for (const dep of index.requiredUnitsOf(code)) {
      if (all.has(dep)) continue;
      all.add(dep);
      queue.push(dep);
      if (!alreadyOn.has(dep)) added.push({ code: dep, requiredBy: code });
    }
  }
  return { all: [...all].sort(compareCodes), added: added.sort((a, b) => compareCodes(a.code, b.code)) };
}

/**
 * Unidades ligadas que deixariam de ter uma dependência obrigatória se as unidades dadas fossem desligadas (cascata em
 * cadeia), com a unidade que as faz cair.
 */
export function dependentsClosure(index: ErpCatalogIndex, turningOff: Iterable<string>, enabled: ReadonlySet<string>): { code: string; because: string }[] {
  const off = new Set(turningOff);
  const out: { code: string; because: string }[] = [];
  const queue = [...off];
  while (queue.length) {
    const code = queue.shift() as string;
    for (const dependent of index.dependentUnitsOf(code)) {
      if (!enabled.has(dependent) || off.has(dependent)) continue;
      off.add(dependent);
      queue.push(dependent);
      out.push({ code: dependent, because: code });
    }
  }
  return out.sort((a, b) => compareCodes(a.code, b.code));
}

export interface ErpCatalogDiff {
  added: string[];
  removed: string[];
  /** Itens cujo nome, situação técnica, classe, unidade, inclusão ou dependências mudaram. */
  changed: { code: string; fields: string[] }[];
}

const DIFF_FIELDS: (keyof ErpCatalogItem)[] = ["name", "devStatus", "available", "commercialClass", "unit", "includedIn", "aliasOf", "requires", "sellable", "kinds"];

/** Diferença entre duas versões do catálogo (novos, retirados, alterados), para o registro da importação. */
export function catalogDiff(previous: ErpCatalog | null, next: ErpCatalog): ErpCatalogDiff {
  const before = new Map((previous?.items ?? []).map((i) => [i.code, i]));
  const after = new Map(next.items.map((i) => [i.code, i]));
  const added = [...after.keys()].filter((c) => !before.has(c)).sort(compareCodes);
  const removed = [...before.keys()].filter((c) => !after.has(c)).sort(compareCodes);
  const changed: { code: string; fields: string[] }[] = [];
  for (const [code, item] of after) {
    const old = before.get(code);
    if (!old) continue;
    const fields = DIFF_FIELDS.filter((f) => JSON.stringify(old[f]) !== JSON.stringify(item[f])).map(String);
    if (fields.length) changed.push({ code, fields });
  }
  return { added: previous ? added : [], removed, changed: changed.sort((a, b) => compareCodes(a.code, b.code)) };
}
