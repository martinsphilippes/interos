import "server-only";
/**
 * Base de conhecimento pronta para IA: busca ponderada com filtros e contexto limpo de um artigo.
 * São as funções que o futuro agente de IA do suporte deve chamar (não dependem de sessão; quem chama
 * valida o acesso).
 */
import { getById, getManyByIds, list } from "@/server/db";
import { COLLECTIONS, type Product, type User } from "@/domain/types";
import { plainText, rankArticles, type KnowledgeArticleExtra } from "./knowledge-search";

export interface ArticleSearchOptions {
  productId?: string;
  /** Módulo do produto (comparação sem acento e sem caixa). */
  module?: string;
  category?: string;
  /** Inclui rascunhos (padrão: só publicados). */
  includeDrafts?: boolean;
  /** "all" (padrão): todos os termos precisam aparecer. "any": basta um (sugestões a partir de um texto longo). */
  mode?: "all" | "any";
  limit?: number;
}

export interface ArticleSearchResult {
  id: string;
  title: string;
  productId?: string;
  productName?: string;
  module?: string;
  category?: string;
  problem?: string;
  keywords: string[];
  tags: string[];
  excerpt: string;
  score: number;
  published: boolean;
  views: number;
  helpful: number;
  notHelpful: number;
  updatedAt: string;
  href: string;
}

const same = (a: string | undefined, b: string | undefined) =>
  (a ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim() ===
  (b ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * Busca na base de conhecimento. Pondera título e problema (5), palavras-chave (4), tags e
 * produto/módulo/categoria (2) e corpo (1); a frase inteira no título ou problema soma bônus.
 * Filtros por produto, módulo e categoria são de igualdade. Sem texto, devolve os filtrados por relevância de uso.
 */
export async function searchArticles(query: string, options: ArticleSearchOptions = {}): Promise<ArticleSearchResult[]> {
  const [articles, products] = await Promise.all([list<KnowledgeArticleExtra>(COLLECTIONS.knowledgeArticles), list<Product>(COLLECTIONS.products)]);
  const productNames = new Map(products.map((p) => [p.id, p.name]));
  const filtered = articles
    .filter((a) => options.includeDrafts || a.published)
    .filter((a) => !options.productId || a.productId === options.productId)
    .filter((a) => !options.module || same(a.module, options.module))
    .filter((a) => !options.category || same(a.category, options.category))
    .map((a) => ({ ...a, productName: a.productId ? productNames.get(a.productId) : undefined }));
  const ranked = query.trim()
    ? rankArticles(filtered, query, { mode: options.mode ?? "all" })
    : filtered.map((a) => ({ ...a, score: 0 })).sort((a, b) => (b.helpful ?? 0) - (a.helpful ?? 0) || (b.views ?? 0) - (a.views ?? 0));
  const limited = options.limit ? ranked.slice(0, options.limit) : ranked;
  return limited.map((a) => {
    const text = plainText(a.body).replace(/\s+/g, " ");
    return {
      id: a.id,
      title: a.title,
      productId: a.productId,
      productName: a.productName,
      module: a.module,
      category: a.category,
      problem: a.problem,
      keywords: a.keywords ?? [],
      tags: a.tags ?? [],
      excerpt: text.length > 240 ? `${text.slice(0, 237)}…` : text,
      score: a.score,
      published: a.published,
      views: a.views ?? 0,
      helpful: a.helpful ?? 0,
      notHelpful: a.notHelpful ?? 0,
      updatedAt: a.updatedAt,
      href: `/suporte/base-de-conhecimento/${a.id}`,
    };
  });
}

export interface ArticleContextForAI {
  id: string;
  title: string;
  product?: { id: string; name: string };
  module?: string;
  category?: string;
  problem?: string;
  keywords: string[];
  tags: string[];
  /** Conteúdo sem markdown, pronto para compor o prompt. */
  text: string;
  published: boolean;
  author?: string;
  updatedAt: string;
  /** Sinal de qualidade: votos "foi útil" e "não foi útil" e visualizações. */
  feedback: { helpful: number; notHelpful: number; views: number };
  sourceTicketId?: string;
  href: string;
  /** Bloco único (metadados + texto) para colar no contexto do modelo. */
  prompt: string;
}

/** Texto limpo + metadados de um artigo para o agente de IA do suporte. */
export async function getArticleContextForAI(articleId: string): Promise<ArticleContextForAI | null> {
  const article = await getById<KnowledgeArticleExtra>(COLLECTIONS.knowledgeArticles, articleId);
  if (!article) return null;
  const [product, authors] = await Promise.all([
    article.productId ? getById<Product>(COLLECTIONS.products, article.productId) : null,
    getManyByIds<User>(COLLECTIONS.users, [article.authorId]),
  ]);
  const text = plainText(article.body);
  const keywords = article.keywords ?? [];
  const tags = article.tags ?? [];
  const header = [
    `Artigo: ${article.title}`,
    product ? `Produto: ${product.name}` : null,
    article.module ? `Módulo: ${article.module}` : null,
    article.category ? `Categoria: ${article.category}` : null,
    article.problem ? `Problema: ${article.problem}` : null,
    keywords.length ? `Palavras-chave: ${keywords.join(", ")}` : null,
  ].filter(Boolean);
  return {
    id: article.id,
    title: article.title,
    product: product ? { id: product.id, name: product.name } : undefined,
    module: article.module,
    category: article.category,
    problem: article.problem,
    keywords,
    tags,
    text,
    published: article.published,
    author: authors.get(article.authorId)?.name,
    updatedAt: article.updatedAt,
    feedback: { helpful: article.helpful ?? 0, notHelpful: article.notHelpful ?? 0, views: article.views ?? 0 },
    sourceTicketId: article.sourceTicketId,
    href: `/suporte/base-de-conhecimento/${article.id}`,
    prompt: `${header.join("\n")}\n\n${text}`,
  };
}
