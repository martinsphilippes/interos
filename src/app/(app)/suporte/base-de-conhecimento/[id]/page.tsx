import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BookOpen, Eye, Pencil, Tag } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getArticle, listArticles } from "@/server/support/queries";
import { incrementArticleViews } from "@/server/support/service";
import { canEditArticles } from "@/server/support/schemas";
import { formatDate, formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ArticleEditor } from "@/components/support/article-editor";
import { Markdown } from "@/components/support/markdown";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const detail = await getArticle(id);
  return { title: detail?.article.title ?? "Artigo" };
}

/** Artigo da base de conhecimento: conteúdo renderizado, contador de visualizações e edição. */
export default async function ArticlePage({ params }: { params: Params }) {
  const user = await requireUser();
  if (!canAccessModule(user, "suporte")) redirect("/meu-dia?erro=sem-permissao");
  const { id } = await params;
  const editor = canEditArticles(user);
  const [detail, kb] = await Promise.all([getArticle(id), editor ? listArticles({ includeDrafts: true }) : Promise.resolve(null)]);
  if (!detail || (!detail.article.published && !editor)) notFound();
  const { article } = detail;

  // Cada abertura conta uma visualização (o número exibido é o anterior + esta leitura).
  try {
    await incrementArticleViews(article.id);
  } catch (error) {
    console.error("[suporte] falha ao contar visualização", error);
  }

  return (
    <PageContainer size="narrow">
      <PageHeader
        title={article.title}
        breadcrumbs={[{ label: "Suporte", href: "/suporte" }, { label: "Base de Conhecimento", href: "/suporte/base-de-conhecimento" }, { label: article.title }]}
        badge={!article.published ? <Badge variant="warning">Rascunho</Badge> : null}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {detail.productName ? <Badge variant="info">{detail.productName}</Badge> : <Badge variant="muted">Geral</Badge>}
            {article.category ? <Badge variant="outline">{article.category}</Badge> : null}
            <span>{detail.author?.name ?? "—"}</span>
            <span>atualizado em {formatDate(article.updatedAt)}</span>
            <span className="inline-flex items-center gap-1">
              <Eye className="size-3.5" /> {formatNumber((article.views ?? 0) + 1)} visualizações
            </span>
          </span>
        }
        actions={
          editor && kb ? (
            <ArticleEditor
              products={kb.products}
              categories={kb.categories}
              initial={{ id: article.id, title: article.title, productId: article.productId, category: article.category, body: article.body, tags: article.tags, published: article.published }}
              trigger={
                <Button variant="outline" className="min-h-[44px] md:min-h-0">
                  <Pencil /> Editar
                </Button>
              }
            />
          ) : null
        }
      />
      <Card className="mb-5">
        <CardContent className="py-6">
          <Markdown source={article.body} />
          {article.tags.length ? (
            <div className="mt-6 flex flex-wrap items-center gap-1.5 border-t border-border pt-4">
              <Tag className="size-4 text-muted" />
              {article.tags.map((t) => (
                <Link key={t} href={`/suporte/base-de-conhecimento?q=${encodeURIComponent(t)}`}>
                  <Badge variant="muted">{t}</Badge>
                </Link>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
      {detail.related.length ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <BookOpen className="size-4 text-muted" /> Artigos relacionados
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="flex flex-col gap-1">
              {detail.related.map((r) => (
                <li key={r.id}>
                  <Link href={`/suporte/base-de-conhecimento/${r.id}`} className="flex min-h-[44px] items-center justify-between gap-2 rounded-md px-2 text-sm hover:bg-surface-hover md:min-h-9">
                    <span className="font-medium">{r.title}</span>
                    {r.productName ? <span className="text-xs text-muted">{r.productName}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </PageContainer>
  );
}
