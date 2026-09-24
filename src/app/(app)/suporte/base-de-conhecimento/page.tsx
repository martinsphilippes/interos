import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BookOpen, Eye, Layers, Plus, ThumbsUp } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { getTicket, listArticles } from "@/server/support/queries";
import { canEditArticles } from "@/server/support/schemas";
import { formatNumber, formatPercent } from "@/lib/format";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { ArticleEditor, articleDraftFromTicket } from "@/components/support/article-editor";
import { ArticlesList } from "@/components/support/articles-list";

export const metadata: Metadata = { title: "Base de Conhecimento" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Base de conhecimento organizada por produto, módulo, categoria, problema e palavras-chave (rascunhos visíveis só
 * para quem edita). ?chamado=<id> abre o editor com o rascunho gerado a partir do chamado.
 */
export default async function KnowledgeBasePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "suporte")) redirect("/meu-dia?erro=sem-permissao");
  const sp = await searchParams;
  const editor = canEditArticles(user);
  const sourceTicketId = first(sp.chamado);
  const [{ articles, products, categories, modules }, source] = await Promise.all([listArticles({ includeDrafts: editor }), editor && sourceTicketId ? getTicket(sourceTicketId, user) : Promise.resolve(null)]);

  const published = articles.filter((a) => a.published);
  const votes = published.reduce((s, a) => s + a.helpful + a.notHelpful, 0);
  const helpful = published.reduce((s, a) => s + a.helpful, 0);
  const views = published.reduce((s, a) => s + a.views, 0);
  const organized = published.filter((a) => a.module && a.problem && a.keywords.length > 0).length;

  return (
    <PageContainer>
      <PageHeader
        title="Base de Conhecimento"
        description="Soluções documentadas por produto, módulo e problema: consulte antes de responder e registre o que resolveu."
        breadcrumbs={[{ label: "Suporte", href: "/suporte" }, { label: "Base de Conhecimento" }]}
        actions={
          editor ? (
            source ? (
              <ArticleEditor
                products={products}
                categories={categories}
                modules={modules}
                sourceTicketId={source.ticket.id}
                initial={articleDraftFromTicket(source)}
                defaultOpen
                trigger={
                  <Button className="min-h-[44px] md:min-h-0">
                    <Plus /> Artigo do chamado {source.ticket.number}
                  </Button>
                }
              />
            ) : (
              <ArticleEditor
                products={products}
                categories={categories}
                modules={modules}
                trigger={
                  <Button className="min-h-[44px] md:min-h-0">
                    <Plus /> Novo artigo
                  </Button>
                }
              />
            )
          ) : null
        }
      />
      <KpiStrip columns={4} mobileColumns={2}>
        <StatCard compact label="Artigos publicados" value={formatNumber(published.length)} icon={<BookOpen />} tone="purple" hint={articles.length > published.length ? `${articles.length - published.length} rascunho(s)` : undefined} />
        <StatCard compact label="Organizados" value={published.length ? formatPercent(organized / published.length) : "—"} icon={<Layers />} tone="info" hint="com módulo, problema e palavras-chave" />
        <StatCard compact label="Visualizações" value={formatNumber(views)} icon={<Eye />} tone="secondary" />
        <StatCard compact label="Avaliados como úteis" value={votes > 0 ? formatPercent(helpful / votes) : "—"} icon={<ThumbsUp />} tone={votes === 0 ? "neutral" : helpful / votes >= 0.8 ? "success" : "warning"} hint={votes > 0 ? `${votes} voto(s)` : "sem votos ainda"} />
      </KpiStrip>
      <ArticlesList articles={articles} products={products} categories={categories} modules={modules} initial={{ q: first(sp.q), produto: first(sp.produto), modulo: first(sp.modulo), categoria: first(sp.categoria) }} />
    </PageContainer>
  );
}
