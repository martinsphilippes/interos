"use client";

import * as React from "react";
import Link from "next/link";
import { BookOpen, Eye, Tag } from "lucide-react";
import type { ArticleRow } from "@/server/support/queries";
import { formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { RelativeTime } from "@/components/ui/relative-time";

const normalize = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Lista de artigos com busca (título, tags, conteúdo) e filtros de produto/categoria. */
export function ArticlesList({ articles, products, categories, initialQuery = "" }: { articles: ArticleRow[]; products: { id: string; name: string }[]; categories: string[]; initialQuery?: string }) {
  const [q, setQ] = React.useState(initialQuery);
  const [productId, setProductId] = React.useState("");
  const [category, setCategory] = React.useState("");

  const filtered = React.useMemo(() => {
    const terms = normalize(q).split(/\s+/).filter(Boolean);
    return articles.filter((a) => {
      if (productId && a.productId !== productId) return false;
      if (category && a.category !== category) return false;
      if (terms.length === 0) return true;
      const hay = normalize(`${a.title} ${a.tags.join(" ")} ${a.excerpt} ${a.productName ?? ""} ${a.category ?? ""}`);
      return terms.every((t) => hay.includes(t));
    });
  }, [articles, q, productId, category]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_220px_200px]">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar por problema, tag ou produto" />
        <Select aria-label="Produto" value={productId} onChange={(e) => setProductId(e.target.value)} placeholder="Todos os produtos" options={products.map((p) => ({ value: p.id, label: p.name }))} />
        <Select aria-label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Todas as categorias" options={categories.map((c) => ({ value: c, label: c }))} />
      </div>
      <p className="text-xs text-muted" aria-live="polite">
        {filtered.length} artigo{filtered.length === 1 ? "" : "s"}
      </p>
      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={<BookOpen />} title={articles.length === 0 ? "Base de conhecimento vazia" : "Nenhum artigo encontrado"} description={articles.length === 0 ? "Crie o primeiro artigo ou gere um a partir de um chamado resolvido." : "Tente outras palavras ou limpe os filtros."} />
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {filtered.map((a) => (
            <li key={a.id}>
              <Link href={`/suporte/base-de-conhecimento/${a.id}`} className="flex h-full flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-card transition-colors hover:border-border-strong hover:bg-surface-muted">
                <div className="flex flex-wrap items-center gap-1.5">
                  {a.productName ? <Badge variant="info" size="sm">{a.productName}</Badge> : <Badge variant="muted" size="sm">Geral</Badge>}
                  {a.category ? <Badge variant="outline" size="sm">{a.category}</Badge> : null}
                  {!a.published ? <Badge variant="warning" size="sm">Rascunho</Badge> : null}
                </div>
                <h3 className="font-semibold leading-snug">{a.title}</h3>
                <p className="line-clamp-2 text-sm text-muted">{a.excerpt}</p>
                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-muted">
                  <span>{a.authorName}</span>
                  <span className="inline-flex items-center gap-1">
                    <Eye className="size-3.5" /> {formatNumber(a.views)}
                  </span>
                  <span>atualizado <RelativeTime value={a.updatedAt} /></span>
                  {a.tags.length ? (
                    <span className="inline-flex items-center gap-1">
                      <Tag className="size-3.5" /> {a.tags.slice(0, 3).join(", ")}
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
