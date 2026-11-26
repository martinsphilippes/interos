/**
 * Gestão de Produtos — camada COMERCIAL por cima do catálogo técnico do ERP (fases 7 e 8 da Central de Produtos).
 * Módulo puro: usado pelo servidor (validação, gravação) e pelas telas (ficha, preços, pacotes, simulador).
 *
 * - O catálogo do ERP continua a fonte única dos códigos, nomes técnicos, hierarquia e dependências. Aqui só se
 *   acrescenta o que é comercial: ficha do módulo (nome comercial, texto para proposta, situação, regras), preço e
 *   pacotes.
 * - Preço e pacote são VERSIONADOS por data de início (AAAA-MM-DD, fuso da operação): uma versão nunca é reescrita;
 *   mudar o preço = nova versão a partir de uma data. A vigência (`validTo`) é derivada da próxima versão. Uma versão
 *   ainda não usada (início hoje ou depois) pode ser cancelada; ela fica no histórico, fora da vigência.
 * - Sem cobrança dupla: o que está no pacote não é cobrado de novo como avulso (ver `quote.ts`).
 */

// ---------------------------------------------------------------------------
// Situação comercial
// ---------------------------------------------------------------------------

export const COMMERCIAL_STATUSES = ["rascunho", "a_venda", "sob_consulta", "descontinuado"] as const;
export type CommercialStatus = (typeof COMMERCIAL_STATUSES)[number];

export const COMMERCIAL_STATUS_LABELS: Record<CommercialStatus, string> = {
  rascunho: "Em definição",
  a_venda: "À venda",
  sob_consulta: "Sob consulta",
  descontinuado: "Descontinuado",
};

export const COMMERCIAL_STATUS_HINTS: Record<CommercialStatus, string> = {
  rascunho: "Ainda não é oferecido: ficha e preço em preparação.",
  a_venda: "Oferecido em propostas, avulso ou em pacote.",
  sob_consulta: "Oferecido, mas o preço é negociado caso a caso.",
  descontinuado: "Não entra em vendas novas; quem já tem continua com o que contratou.",
};

export const PACKAGE_STATUSES = ["rascunho", "a_venda", "descontinuado"] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

export const PACKAGE_STATUS_LABELS: Record<PackageStatus, string> = {
  rascunho: "Em definição",
  a_venda: "À venda",
  descontinuado: "Descontinuado",
};

/** Segmentos (tipos de empresa no ERP) para os quais um módulo ou pacote é oferecido. */
export const COMMERCIAL_SEGMENTS = ["varejo", "escritorio_contabil", "parceiro_rede"] as const;
export type CommercialSegment = (typeof COMMERCIAL_SEGMENTS)[number];

export const COMMERCIAL_SEGMENT_LABELS: Record<CommercialSegment, string> = {
  varejo: "Varejo",
  escritorio_contabil: "Escritório contábil",
  parceiro_rede: "Rede de certificação",
};

// ---------------------------------------------------------------------------
// Preço
// ---------------------------------------------------------------------------

/**
 * - fixo: mensalidade única, qualquer quantidade;
 * - por_quantidade: mensalidade base que já inclui `includedQuantity` unidades + `unitPrice` por unidade adicional
 *   (usuário, filial, terminal…); por usuário puro = base 0, nenhuma incluída;
 * - por_faixa: a mensalidade é a da faixa em que a quantidade cai (preço por volume).
 */
export const PRICE_MODELS = ["fixo", "por_quantidade", "por_faixa"] as const;
export type PriceModel = (typeof PRICE_MODELS)[number];

export const PRICE_MODEL_LABELS: Record<PriceModel, string> = {
  fixo: "Mensalidade fixa",
  por_quantidade: "Por quantidade",
  por_faixa: "Por faixa de quantidade",
};

export const PRICE_MODEL_HINTS: Record<PriceModel, string> = {
  fixo: "Um valor por mês, qualquer que seja a quantidade.",
  por_quantidade: "Base mensal com algumas unidades incluídas e um valor por unidade adicional (usuário, filial, terminal…).",
  por_faixa: "O valor do mês é o da faixa em que a quantidade cai (ex.: até 3 usuários, até 10, acima de 10).",
};

/** Exemplos de unidade de medida para por_quantidade e por_faixa (texto livre na tela). */
export const QUANTITY_UNIT_SUGGESTIONS = ["usuário", "filial", "terminal", "CNPJ", "loja", "dispositivo"] as const;

export interface PriceTier {
  /** Quantidade máxima da faixa (inclusive); null = acima da faixa anterior, sem limite (só a última). */
  upTo: number | null;
  /** Mensalidade da faixa inteira (não é por unidade). */
  monthly: number;
}

export interface Actor {
  id: string;
  name: string;
}

interface VersionBase {
  version: number;
  /** Primeiro dia de vigência (AAAA-MM-DD, fuso da operação). */
  validFrom: string;
  /** Último dia de vigência, derivado da próxima versão não cancelada; null = sem fim. */
  validTo: string | null;
  /** Por que a versão foi criada (vai para o histórico). */
  reason: string;
  createdAt: string;
  createdBy: Actor;
  cancelledAt?: string | null;
  cancelledBy?: Actor | null;
  cancelReason?: string | null;
}

export interface PriceVersion extends VersionBase {
  model: PriceModel;
  /** fixo: a mensalidade; por_quantidade: a mensalidade base (pode ser 0); por_faixa: não usado (0). */
  monthly: number;
  /** por_quantidade: valor por unidade além das incluídas. */
  unitPrice: number;
  /** por_quantidade: unidades já cobertas pela base. */
  includedQuantity: number;
  /** por_quantidade e por_faixa: o que é contado ("usuário", "filial"…). */
  unitLabel: string | null;
  /** por_faixa: faixas em ordem crescente; a última sem limite (upTo null). */
  tiers: PriceTier[];
  /** Implantação: cobrança única. */
  setup: number;
}

export interface PackageVersion extends VersionBase {
  /** Unidades comerciais do catálogo incluídas (códigos NN.SS), sem repetição, em ordem de código. */
  units: string[];
  monthly: number;
  setup: number;
}

/** Ficha comercial de uma unidade comercial do catálogo (id do documento = código da unidade). */
export interface CommercialModule {
  id: string;
  code: string;
  /** Nome usado em propostas (padrão: o nome do catálogo). */
  name: string;
  /** Texto curto para proposta e contrato. */
  summary: string | null;
  status: CommercialStatus;
  /** Segmentos em que é oferecido (vazio = todos). */
  segments: CommercialSegment[];
  /** Dependências comerciais além das técnicas do catálogo (ex.: só se vende junto com o PDV). */
  requiresCommercial: string[];
  /** Regras e observações internas (não vão para a proposta). */
  notes: string | null;
  prices: PriceVersion[];
  createdAt: string;
  updatedAt: string;
  updatedBy: Actor;
}

export interface ProductPackage {
  id: string;
  name: string;
  segment: CommercialSegment;
  description: string | null;
  status: PackageStatus;
  /** Pacote de partida do ERP usado na criação (só referência). */
  basedOn: string | null;
  versions: PackageVersion[];
  createdAt: string;
  updatedAt: string;
  updatedBy: Actor;
}

export const NAME_MIN = 2;
export const NAME_MAX = 120;
export const SUMMARY_MAX = 400;
export const NOTES_MAX = 2000;
export const REASON_MIN = 3;
export const REASON_MAX = 300;
/** Teto de sanidade para valores em reais (evita digitação com zeros a mais). */
export const MONEY_MAX = 1_000_000;
export const QUANTITY_MAX = 100_000;
export const TIERS_MAX = 12;

// ---------------------------------------------------------------------------
// Datas e dinheiro
// ---------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Dia anterior de uma chave AAAA-MM-DD. */
export function previousDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - 1));
  return date.toISOString().slice(0, 10);
}

/** Arredonda para centavos (evita 0,1 + 0,2). */
export function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Linha do tempo das versões (preço e pacote)
// ---------------------------------------------------------------------------

export type VersionState = "agendada" | "vigente" | "encerrada" | "cancelada";

export const VERSION_STATE_LABELS: Record<VersionState, string> = {
  agendada: "Agendada",
  vigente: "Vigente",
  encerrada: "Encerrada",
  cancelada: "Cancelada",
};

const isActive = <V extends VersionBase>(v: V) => !v.cancelledAt;

/** Recalcula `validTo` de todas as versões: cada versão ativa termina na véspera da próxima. Não muta a entrada. */
export function withValidity<V extends VersionBase>(versions: readonly V[]): V[] {
  const active = versions.filter(isActive).sort((a, b) => a.validFrom.localeCompare(b.validFrom) || a.version - b.version);
  const ends = new Map<number, string | null>();
  active.forEach((v, i) => ends.set(v.version, i + 1 < active.length ? previousDay(active[i + 1].validFrom) : null));
  return versions.map((v) => ({ ...v, validTo: isActive(v) ? (ends.get(v.version) ?? null) : v.validTo })).sort((a, b) => a.version - b.version);
}

/** Versão que vale na data (a ativa de início mais recente até a data), ou null. */
export function versionAt<V extends VersionBase>(versions: readonly V[], date: string): V | null {
  let best: V | null = null;
  for (const v of versions) {
    if (!isActive(v) || v.validFrom > date) continue;
    if (!best || v.validFrom > best.validFrom || (v.validFrom === best.validFrom && v.version > best.version)) best = v;
  }
  return best;
}

export function versionState(v: VersionBase, today: string): VersionState {
  if (v.cancelledAt) return "cancelada";
  if (v.validFrom > today) return "agendada";
  if (v.validTo && v.validTo < today) return "encerrada";
  return "vigente";
}

export class CommercialRuleError extends Error {}

/**
 * Acrescenta uma versão nova (número seguinte, mesmo depois de canceladas). Regras: começa hoje ou depois (preço não
 * muda o passado) e depois do início da última versão ativa (linha do tempo simples, sem versões intercaladas).
 */
export function appendVersion<V extends VersionBase>(versions: readonly V[], next: Omit<V, "version" | "validTo">, today: string): { versions: V[]; created: V } {
  if (!isDateKey(next.validFrom)) throw new CommercialRuleError("Informe a data de início (dia/mês/ano).");
  if (next.validFrom < today) throw new CommercialRuleError("A nova versão começa hoje ou numa data futura: o preço de um dia que já passou não muda.");
  const last = versions.filter(isActive).reduce<V | null>((acc, v) => (!acc || v.validFrom > acc.validFrom ? v : acc), null);
  if (last && next.validFrom <= last.validFrom) {
    throw new CommercialRuleError(
      last.validFrom > today
        ? `Já existe a versão ${last.version} agendada para ${formatKey(last.validFrom)}. Cancele-a ou escolha uma data depois dela.`
        : `A nova versão precisa começar depois de ${formatKey(last.validFrom)}, início da versão ${last.version}. Para corrigir a versão de hoje, cancele-a e crie de novo.`,
    );
  }
  const number = versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
  const created = { ...next, version: number, validTo: null } as V;
  const all = withValidity([...versions, created]);
  return { versions: all, created: all.find((v) => v.version === number) as V };
}

/** Cancela uma versão que ainda não começou ou começa hoje; a anterior volta a valer sem fim (ou até a seguinte). */
export function cancelVersion<V extends VersionBase>(versions: readonly V[], number: number, today: string, actor: Actor, reason: string, at: string): { versions: V[]; cancelled: V } {
  const target = versions.find((v) => v.version === number);
  if (!target) throw new CommercialRuleError("Versão não encontrada.");
  if (target.cancelledAt) throw new CommercialRuleError("Esta versão já foi cancelada.");
  if (target.validFrom < today) throw new CommercialRuleError("Só se cancela versão que começa hoje ou depois. Para mudar daqui para frente, crie uma versão nova.");
  const all = withValidity(versions.map((v) => (v.version === number ? { ...v, cancelledAt: at, cancelledBy: actor, cancelReason: reason } : v)));
  return { versions: all, cancelled: all.find((v) => v.version === number) as V };
}

function formatKey(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------------------
// Cálculo do preço
// ---------------------------------------------------------------------------

/** Mensalidade de uma versão para a quantidade (mínimo 1). */
export function monthlyFor(price: Pick<PriceVersion, "model" | "monthly" | "unitPrice" | "includedQuantity" | "tiers">, quantity: number): number {
  const q = Math.max(1, Math.floor(quantity || 1));
  if (price.model === "fixo") return money(price.monthly);
  if (price.model === "por_quantidade") return money(price.monthly + Math.max(0, q - price.includedQuantity) * price.unitPrice);
  const tier = tierFor(price.tiers, q);
  return tier ? money(tier.monthly) : 0;
}

export function tierFor(tiers: readonly PriceTier[], quantity: number): PriceTier | null {
  for (const t of tiers) if (t.upTo === null || quantity <= t.upTo) return t;
  return null;
}

/** Validação de negócio de um preço (a forma já veio validada pelo schema). Lista vazia = válido. */
export function priceProblems(p: Pick<PriceVersion, "model" | "monthly" | "unitPrice" | "includedQuantity" | "tiers" | "setup" | "unitLabel">): string[] {
  const problems: string[] = [];
  const bad = (v: number) => !Number.isFinite(v) || v < 0 || v > MONEY_MAX;
  if (bad(p.setup)) problems.push("Valor de implantação inválido.");
  if (p.model === "fixo" && bad(p.monthly)) problems.push("Mensalidade inválida.");
  if (p.model === "por_quantidade") {
    if (bad(p.monthly)) problems.push("Mensalidade base inválida.");
    if (bad(p.unitPrice)) problems.push("Valor por unidade adicional inválido.");
    if (!Number.isInteger(p.includedQuantity) || p.includedQuantity < 0 || p.includedQuantity > QUANTITY_MAX) problems.push("Quantidade incluída inválida.");
    if (p.monthly === 0 && p.unitPrice === 0) problems.push("Informe a mensalidade base ou o valor por unidade.");
    if (!p.unitLabel?.trim()) problems.push("Informe o que é contado (usuário, filial, terminal…).");
  }
  if (p.model === "por_faixa") {
    if (!p.unitLabel?.trim()) problems.push("Informe o que é contado (usuário, filial, terminal…).");
    if (p.tiers.length < 2) problems.push("Informe pelo menos duas faixas (a última sem limite).");
    if (p.tiers.length > TIERS_MAX) problems.push(`No máximo ${TIERS_MAX} faixas.`);
    let previous = 0;
    p.tiers.forEach((t, i) => {
      const last = i === p.tiers.length - 1;
      if (bad(t.monthly)) problems.push(`Faixa ${i + 1}: mensalidade inválida.`);
      if (last && t.upTo !== null) problems.push("A última faixa não tem limite (acima de…).");
      if (!last) {
        if (t.upTo === null || !Number.isInteger(t.upTo) || t.upTo <= previous || t.upTo > QUANTITY_MAX) problems.push(`Faixa ${i + 1}: o limite precisa ser um número inteiro maior que o da faixa anterior.`);
        else previous = t.upTo;
      }
    });
  }
  return problems;
}

/** Descrição curta do preço para listas e propostas. `fmt` formata reais (formatCurrency na tela). */
export function describePrice(p: Pick<PriceVersion, "model" | "monthly" | "unitPrice" | "includedQuantity" | "tiers" | "unitLabel" | "setup">, fmt: (value: number) => string): string {
  const unit = p.unitLabel?.trim() || "unidade";
  let text: string;
  if (p.model === "fixo") text = `${fmt(p.monthly)}/mês`;
  else if (p.model === "por_quantidade") {
    const extra = `${fmt(p.unitPrice)} por ${unit}`;
    text = p.monthly > 0 ? `${fmt(p.monthly)}/mês${p.includedQuantity > 0 ? ` com ${p.includedQuantity} ${plural(unit, p.includedQuantity)}` : ""} + ${extra}${p.includedQuantity > 0 ? " adicional" : ""}` : `${extra}/mês`;
  } else {
    const first = p.tiers[0];
    text = first ? `a partir de ${fmt(first.monthly)}/mês (até ${first.upTo ?? "∞"} ${plural(unit, first.upTo ?? 2)})` : "por faixa";
  }
  return p.setup > 0 ? `${text} · implantação ${fmt(p.setup)}` : text;
}

function plural(word: string, n: number): string {
  if (n === 1) return word;
  if (/[aeiouáéíóú]$/i.test(word)) return `${word}s`;
  if (/ão$/i.test(word)) return word.replace(/ão$/i, "ões");
  if (/[rsz]$/i.test(word)) return `${word}es`;
  if (/l$/i.test(word)) return word.replace(/l$/i, "is");
  return word;
}

/** Faixas legíveis ("até 3 usuários: R$ 99,00"). */
export function describeTiers(tiers: readonly PriceTier[], unitLabel: string | null, fmt: (value: number) => string): string[] {
  const unit = unitLabel?.trim() || "unidade";
  let previous = 0;
  return tiers.map((t) => {
    const label = t.upTo === null ? `acima de ${previous} ${plural(unit, previous)}` : `até ${t.upTo} ${plural(unit, t.upTo)}`;
    if (t.upTo !== null) previous = t.upTo;
    return `${label}: ${fmt(t.monthly)}/mês`;
  });
}
