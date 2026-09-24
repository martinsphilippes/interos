/**
 * Base de conhecimento: tipo estendido do artigo e busca ponderada.
 * Módulo puro (sem dependências de servidor): usado pelas queries, pelo serviço e pela lista de artigos no navegador,
 * para que a ordem dos resultados seja a mesma na tela e nas sugestões/IA.
 */
import type { KnowledgeArticle } from "@/domain/types";

/**
 * Campos gravados além do tipo `KnowledgeArticle` (aditivos; ver "needs" do relatório):
 * - module: módulo do produto (ex.: "PDV", "Fiscal", "Financeiro");
 * - problem: descrição do problema/sintoma que o artigo resolve (o que o cliente relata);
 * - keywords: palavras-chave de busca (termos que o cliente ou o atendente digitam);
 * - helpful / notHelpful: contadores do "Este artigo foi útil?";
 * - sourceTicketId: chamado que originou o artigo.
 */
export type KnowledgeArticleExtra = KnowledgeArticle & {
  module?: string;
  problem?: string;
  keywords?: string[];
  helpful?: number;
  notHelpful?: number;
  sourceTicketId?: string;
};

/** Texto normalizado (minúsculas, sem acentos) para comparação. */
export function normalizeText(value: string | undefined | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const STOPWORDS = new Set([
  "para",
  "com",
  "sem",
  "que",
  "nao",
  "uma",
  "como",
  "pelo",
  "pela",
  "esta",
  "este",
  "isso",
  "mais",
  "desde",
  "quando",
  "erro",
  "cliente",
  "sistema",
  "dando",
  "todas",
  "todos",
  "dos",
  "das",
  "nos",
  "nas",
  "ele",
  "ela",
  "foi",
  "tem",
]);

/** Termos relevantes de um texto (≥ 3 letras, sem stopwords, sem repetição). */
export function searchTerms(text: string): string[] {
  return Array.from(new Set(normalizeText(text).split(/[^a-z0-9-]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w))));
}

/** Markdown simples → texto corrido (para trechos e para o contexto da IA). */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/[*_`>]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface SearchableArticle {
  title: string;
  problem?: string;
  keywords?: string[];
  tags?: string[];
  module?: string;
  category?: string;
  productName?: string;
  body: string;
}

/** Pesos da busca: título e problema valem mais que palavras-chave, que valem mais que o corpo. */
export const SEARCH_WEIGHTS = { title: 5, problem: 5, keyword: 4, tag: 2, facet: 2, body: 1, phrase: 6 } as const;

export interface ArticleScore {
  score: number;
  /** Termos da busca encontrados em algum campo. */
  matched: number;
}

/**
 * Pontua um artigo para uma lista de termos já normalizados (ver `searchTerms`).
 * Cada termo soma o peso de cada campo em que aparece; a frase inteira no título/problema soma um bônus.
 */
export function scoreArticle(article: SearchableArticle, terms: string[], phrase?: string): ArticleScore {
  const title = normalizeText(article.title);
  const problem = normalizeText(article.problem);
  const keywords = (article.keywords ?? []).map(normalizeText);
  const tags = (article.tags ?? []).map(normalizeText);
  const facets = normalizeText([article.module, article.category, article.productName].filter(Boolean).join(" "));
  const body = normalizeText(article.body);
  let score = 0;
  let matched = 0;
  for (const term of terms) {
    let hit = 0;
    if (title.includes(term)) hit += SEARCH_WEIGHTS.title;
    if (problem.includes(term)) hit += SEARCH_WEIGHTS.problem;
    if (keywords.some((k) => k === term)) hit += SEARCH_WEIGHTS.keyword;
    else if (keywords.some((k) => k.includes(term) || (k.length >= 3 && term.includes(k)))) hit += SEARCH_WEIGHTS.keyword / 2;
    if (tags.some((t) => t.includes(term) || (t.length >= 3 && term.includes(t)))) hit += SEARCH_WEIGHTS.tag;
    if (facets.includes(term)) hit += SEARCH_WEIGHTS.facet;
    if (body.includes(term)) hit += SEARCH_WEIGHTS.body;
    if (hit > 0) matched++;
    score += hit;
  }
  const p = normalizeText(phrase).trim();
  if (p.length >= 6 && terms.length > 1 && (title.includes(p) || problem.includes(p))) score += SEARCH_WEIGHTS.phrase;
  return { score, matched };
}

export interface RankOptions<T> {
  /** "all": todos os termos precisam aparecer (busca digitada). "any": basta um (sugestões a partir do chamado). */
  mode?: "all" | "any";
  /** Pontuação mínima para entrar no resultado. */
  minScore?: number;
  /** Bônus por afinidade (ex.: mesmo produto do chamado). Só é somado a quem já pontuou. */
  boost?: (item: T) => number;
  limit?: number;
}

/** Ordena artigos pela busca ponderada. Sem termos, devolve a lista original (sem pontuação). */
export function rankArticles<T extends SearchableArticle>(items: T[], query: string, options: RankOptions<T> = {}): (T & { score: number })[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return items.map((item) => ({ ...item, score: 0 }));
  const mode = options.mode ?? "all";
  const ranked = items
    .map((item) => {
      const { score, matched } = scoreArticle(item, terms, query);
      if (mode === "all" && matched < terms.length) return null;
      const total = score > 0 ? score + (options.boost?.(item) ?? 0) : 0;
      return { ...item, score: total };
    })
    .filter((x): x is T & { score: number } => x !== null && x.score > 0 && x.score >= (options.minScore ?? 1))
    .sort((a, b) => b.score - a.score);
  return options.limit ? ranked.slice(0, options.limit) : ranked;
}
