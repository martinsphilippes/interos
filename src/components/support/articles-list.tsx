"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BookOpen, Eye, KeyRound, ThumbsUp, X } from "lucide-react";
import type { ArticleRow } from "@/server/support/queries";
import { rankArticles } from "@/server/support/knowledge-search";
import { formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { RelativeTime } from "@/components/ui/relative-time";

export interface ArticleFilters {
  q: string;
  produto: string;
  modulo: string;
  categoria: string;
}

export interface ArticlesListProps {
  articles: ArticleRow[];
  products: { id: string; name: string }[];
  categories: string[];
  modules: string[];
  initial: ArticleFilters;
}

/**
 * Lista da base de conhecimento com filtros por produto, módulo e categoria e busca ponderada (título e problema
 * valem mais que palavras-chave, que valem mais que o conteúdo). Filtros ficam na URL (compartilháveis).
 */
export function ArticlesList({ articles, products, categories, modules, initial }: ArticlesListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [filters, setFilters] = React.useState<ArticleFilters>(initial);

  const update = (patch: Partial<ArticleFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const filtered = React.useMemo(() => {
    const base = articles.filter((a) => (!filters.produto || a.productId === filters.produto) && (!filters.modulo || a.module === filters.modulo) && (!filters.categoria || a.category === filters.categoria));
    return filters.q.trim() ? rankArticles(base, filters.q, { mode: "all" }) : base.map((a) => ({ ...a, score: 0 }));
  }, [articles, filters]);

  const active = Boolean(filters.q || filters.produto || filters.modulo || filters.categoria);

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        className="mb-0"
        actions={
          active ? (
            <Button variant="ghost" size="sm" onClick={() => update({ q: "", produto: "", modulo: "", categoria: "" })}>
              <X /> Limpar filtros
            </Button>
          ) : null
        }
      >
        <FilterField label="Busca" className="min-w-[240px] flex-[2]">
          <SearchInput value={filters.q} onChange={(q) => update({ q })} debounceMs={200} placeholder="Problema, palavra-chave ou título" />
        </FilterField>
        <FilterField label="Produto" className="min-w-[180px] flex-1">
          <Select aria-label="Produto" value={filters.produto} onChange={(e) => update({ produto: e.target.value })} placeholder="Todos os produtos" options={products.map((p) => ({ value: p.id, label: p.name }))} />
        </FilterField>
        <FilterField label="Módulo" className="min-w-[160px] flex-1">
          <Select aria-label="Módulo" value={filters.modulo} onChange={(e) => update({ modulo: e.target.value })} placeholder="Todos os módulos" options={modules.map((m) => ({ value: m, label: m }))} />
        </FilterField>
        <FilterField label="Categoria" className="min-w-[160px] flex-1">
          <Select aria-label="Categoria" value={filters.categoria} onChange={(e) => update({ categoria: e.target.value })} placeholder="Todas as categorias" options={categories.map((c) => ({ value: c, label: c }))} />
        </FilterField>
      </FilterBar>
      <p className="text-xs text-muted" aria-live="polite">
        {filtered.length} artigo{filtered.length === 1 ? "" : "s"}
        {filters.q.trim() ? " · ordenados por relevância" : " · mais consultados primeiro"}
      </p>
      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BookOpen />}
            title={articles.length === 0 ? "Base de conhecimento vazia" : "Nenhum artigo encontrado"}
            description={articles.length === 0 ? "Crie o primeiro artigo ou gere um a partir de um chamado resolvido." : "Tente outras palavras ou limpe os filtros."}
          />
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((a) => (
            <li key={a.id}>
              <Link href={`/suporte/base-de-conhecimento/${a.id}`} className="flex h-full flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-card transition-colors hover:border-border-strong hover:bg-surface-hover/60">
                <div className="flex flex-wrap items-center gap-1.5">
                  {a.productName ? (
                    <Badge variant="info" size="sm">
                      {a.productName}
                    </Badge>
                  ) : (
                    <Badge variant="muted" size="sm">
                      Geral
                    </Badge>
                  )}
                  {a.module ? (
                    <Badge variant="secondary" size="sm">
                      {a.module}
                    </Badge>
                  ) : null}
                  {a.category ? (
                    <Badge variant="outline" size="sm">
                      {a.category}
                    </Badge>
                  ) : null}
                  {!a.published ? (
                    <Badge variant="warning" size="sm">
                      Rascunho
                    </Badge>
                  ) : null}
                </div>
                <h3 className="font-semibold leading-snug text-foreground">{a.title}</h3>
                {a.problem ? (
                  <p className="line-clamp-2 text-sm text-foreground/90">
                    <span className="text-muted">Problema: </span>
                    {a.problem}
                  </p>
                ) : (
                  <p className="line-clamp-2 text-sm text-muted">{a.excerpt}</p>
                )}
                {a.keywords.length ? (
                  <p className="flex items-center gap-1 truncate text-xs text-muted">
                    <KeyRound className="size-3.5 shrink-0" aria-hidden /> {a.keywords.slice(0, 5).join(", ")}
                  </p>
                ) : null}
                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-muted">
                  <span>{a.authorName}</span>
                  <span className="inline-flex items-center gap-1" title="Visualizações">
                    <Eye className="size-3.5" /> {formatNumber(a.views)}
                  </span>
                  {a.helpful + a.notHelpful > 0 ? (
                    <span className="inline-flex items-center gap-1" title={`${a.helpful} acharam útil · ${a.notHelpful} não`}>
                      <ThumbsUp className="size-3.5" /> {Math.round((a.helpful / (a.helpful + a.notHelpful)) * 100)}% útil
                    </span>
                  ) : null}
                  <span>
                    atualizado <RelativeTime value={a.updatedAt} />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
