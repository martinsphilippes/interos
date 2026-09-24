import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertCircle, BookOpen, Boxes, Eye, FolderTree, KeyRound, Package, Pencil, Tag, Ticket, UserRound } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getArticle, listArticles } from "@/server/support/queries";
import { incrementArticleViews } from "@/server/support/service";
import { canEditArticles } from "@/server/support/schemas";
import { formatDate, formatNumber } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataList } from "@/components/ui/data-list";
import { PageHeader } from "@/components/ui/page-header";
import { ArticleEditor } from "@/components/support/article-editor";
import { ArticleFeedback } from "@/components/support/article-feedback";
import { Markdown } from "@/components/support/markdown";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const detail = await getArticle(id);
  return { title: detail?.article.title ?? "Artigo" };
}

const kbLink = (key: string, value: string) => `/suporte/base-de-conhecimento?${key}=${encodeURIComponent(value)}`;

/** Artigo da base: metadados (produto, módulo, categoria, problema, palavras-chave), conteúdo, "foi útil?" e relacionados. */
export default async function ArticlePage({ params }: { params: Params }) {
  const user = await requireUser();
  if (!canAccessModule(user, "suporte")) redirect("/meu-dia?erro=sem-permissao");
  const { id } = await params;
  const editor = canEditArticles(user);
  const [detail, kb] = await Promise.all([getArticle(id), editor ? listArticles({ includeDrafts: true }) : Promise.resolve(null)]);
  if (!detail || (!detail.article.published && !editor)) notFound();
  const { article } = detail;
  const keywords = article.keywords ?? [];

  // Cada abertura conta uma visualização (o número exibido é o anterior + esta leitura).
  try {
    await incrementArticleViews(article.id);
  } catch (error) {
    console.error("[suporte] falha ao contar visualização", error);
  }

  return (
    <PageContainer>
      <PageHeader
        title={article.title}
        breadcrumbs={[{ label: "Suporte", href: "/suporte" }, { label: "Base de Conhecimento", href: "/suporte/base-de-conhecimento" }, { label: article.title }]}
        badge={!article.published ? <Badge variant="warning">Rascunho</Badge> : null}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {detail.productName ? <Badge variant="info">{detail.productName}</Badge> : <Badge variant="muted">Geral</Badge>}
            {article.module ? <Badge variant="secondary">{article.module}</Badge> : null}
            {article.category ? <Badge variant="outline">{article.category}</Badge> : null}
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
              modules={kb.modules}
              initial={{
                id: article.id,
                title: article.title,
                productId: article.productId,
                module: article.module,
                category: article.category,
                problem: article.problem,
                keywords,
                body: article.body,
                tags: article.tags,
                published: article.published,
              }}
              trigger={
                <Button variant="outline" className="min-h-[44px] md:min-h-0">
                  <Pencil /> Editar
                </Button>
              }
            />
          ) : null
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {article.problem ? (
            <Card className="border-warning/30">
              <CardContent className="flex gap-3 py-4">
                <AlertCircle className="mt-0.5 size-5 shrink-0 text-warning-fg" aria-hidden />
                <div>
                  <p className="label-caps mb-1">Problema</p>
                  <p className="whitespace-pre-line text-sm text-foreground">{article.problem}</p>
                </div>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardContent className="py-6">
              <Markdown source={article.body} />
              {article.tags.length ? (
                <div className="mt-6 flex flex-wrap items-center gap-1.5 border-t border-border pt-4">
                  <Tag className="size-4 text-muted" />
                  {article.tags.map((t) => (
                    <Link key={t} href={kbLink("q", t)}>
                      <Badge variant="muted">{t}</Badge>
                    </Link>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
          <ArticleFeedback articleId={article.id} helpful={article.helpful ?? 0} notHelpful={article.notHelpful ?? 0} />
        </div>

        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[15px]">Metadados</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <DataList
                labelWidth="8.25rem"
                items={[
                  { key: "produto", icon: <Package />, label: "Produto", value: detail.productName ?? "Geral", href: article.productId ? kbLink("produto", article.productId) : undefined },
                  { key: "modulo", icon: <Boxes />, label: "Módulo", value: article.module, href: article.module ? kbLink("modulo", article.module) : undefined },
                  { key: "categoria", icon: <FolderTree />, label: "Categoria", value: article.category, href: article.category ? kbLink("categoria", article.category) : undefined },
                  {
                    key: "palavras",
                    icon: <KeyRound />,
                    label: "Palavras-chave",
                    value: keywords.length ? (
                      <span className="flex flex-wrap gap-1">
                        {keywords.map((k) => (
                          <Link key={k} href={kbLink("q", k)}>
                            <Badge variant="purple" size="sm">
                              {k}
                            </Badge>
                          </Link>
                        ))}
                      </span>
                    ) : undefined,
                  },
                  { key: "autor", icon: <UserRound />, label: "Autor", value: detail.author?.name },
                  {
                    key: "origem",
                    icon: <Ticket />,
                    label: "Origem",
                    value: detail.sourceTicket ? `${detail.sourceTicket.number} · ${detail.sourceTicket.subject}` : undefined,
                    href: detail.sourceTicket ? `/suporte?chamado=${detail.sourceTicket.id}` : undefined,
                  },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-[15px]">
                <BookOpen className="size-4 text-muted" /> Artigos relacionados
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {detail.related.length === 0 ? (
                <p className="text-sm text-muted">Nenhum artigo relacionado ainda.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {detail.related.map((r) => (
                    <li key={r.id}>
                      <Link href={`/suporte/base-de-conhecimento/${r.id}`} className="flex min-h-[44px] flex-col justify-center rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover md:min-h-9">
                        <span className="font-medium leading-snug text-foreground">{r.title}</span>
                        <span className="text-xs text-muted">{[r.productName, r.module].filter(Boolean).join(" · ") || "Geral"}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </PageContainer>
  );
}
