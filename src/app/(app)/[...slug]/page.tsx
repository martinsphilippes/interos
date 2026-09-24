import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Construction, Lock, Sun } from "lucide-react";
import { NAVIGATION, type NavItem, type NavSection } from "@/domain/constants";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type Params = Promise<{ slug: string[] }>;

function findNavItem(pathname: string): { section: NavSection; item: NavItem } | null {
  for (const section of NAVIGATION) {
    const item = section.items.find((i) => i.href === pathname);
    if (item) return { section, item };
  }
  return null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const found = findNavItem(`/${slug.join("/")}`);
  return { title: found ? found.item.label : "Página não encontrada" };
}

/** Catch-all: "Módulo em construção" para rotas de NAVIGATION que ainda não têm página. */
export default async function UnderConstructionPage({ params }: { params: Params }) {
  const { slug } = await params;
  const pathname = `/${slug.join("/")}`;
  const found = findNavItem(pathname);
  if (!found) notFound();

  const user = await requireUser();
  const { section, item } = found;
  const allowed = canAccessModule(user, section.key);

  return (
    <PageContainer size="narrow">
      <PageHeader
        title={item.label}
        breadcrumbs={[{ label: section.label }, { label: item.label }]}
        badge={allowed ? <Badge variant="muted">Onda {item.wave ?? 1}</Badge> : null}
      />
      <Card>
        <CardContent className="py-2">
          {allowed ? (
            <EmptyState
              icon={<Construction />}
              title="Módulo em construção"
              description={
                <>
                  <strong>{item.label}</strong> faz parte da seção {section.label} e está previsto para a onda {item.wave ?? 1} do INTEROS. Enquanto isso,
                  acompanhe suas prioridades no Meu Dia.
                </>
              }
              action={
                <Button asChild>
                  <Link href="/meu-dia">
                    <Sun /> Ir para Meu Dia
                  </Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Lock />}
              title="Sem permissão"
              description="Seu perfil não tem acesso a este módulo. Fale com o administrador se precisar dele."
              action={
                <Button asChild variant="outline">
                  <Link href="/meu-dia">Voltar para Meu Dia</Link>
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
