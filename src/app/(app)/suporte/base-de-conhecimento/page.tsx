import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { listArticles } from "@/server/support/queries";
import { canEditArticles } from "@/server/support/schemas";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ArticleEditor } from "@/components/support/article-editor";
import { ArticlesList } from "@/components/support/articles-list";

export const metadata: Metadata = { title: "Base de Conhecimento" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Artigos da base (rascunhos visíveis só para quem edita), com busca e criação. */
export default async function KnowledgeBasePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "suporte")) redirect("/meu-dia?erro=sem-permissao");
  const sp = await searchParams;
  const q = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const editor = canEditArticles(user);
  const { articles, products, categories } = await listArticles({ includeDrafts: editor });

  return (
    <PageContainer>
      <PageHeader
        title="Base de Conhecimento"
        description="Soluções documentadas pela equipe: consulte antes de responder e registre o que resolveu."
        breadcrumbs={[{ label: "Suporte", href: "/suporte" }, { label: "Base de Conhecimento" }]}
        actions={
          editor ? (
            <ArticleEditor
              products={products}
              categories={categories}
              trigger={
                <Button className="min-h-[44px] md:min-h-0">
                  <Plus /> Novo artigo
                </Button>
              }
            />
          ) : null
        }
      />
      <ArticlesList articles={articles} products={products} categories={categories} initialQuery={q ?? ""} />
    </PageContainer>
  );
}
