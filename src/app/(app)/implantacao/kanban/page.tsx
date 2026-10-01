import type { Metadata } from "next";
import Link from "next/link";
import { List } from "lucide-react";
import { canSeeHref, requireScreen } from "@/server/auth/session";
import { listAssignableUsers, listKanbanProjects } from "@/server/implementation/queries";
import { readProjectFilters } from "@/server/implementation/schemas";
import { implementationCapabilities } from "@/server/implementation/access";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { buttonVariants } from "@/components/ui/button-variants";
import { PageHeader } from "@/components/ui/page-header";
import { KanbanBoard } from "@/components/implementation/kanban-board";
import { ProjectFilterBar } from "@/components/implementation/project-filters";

export const metadata: Metadata = { title: "Kanban de implantação" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Kanban dos projetos ativos do escopo. Arrastar/soltar e "Retomar" seguem as ações do catálogo (servidor). */
export default async function ImplementationKanbanPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("implantacao.kanban");
  const params = await searchParams;
  const filters = readProjectFilters((key) => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  });
  const [{ rows, scope }, users] = await Promise.all([listKanbanProjects(user, filters.scope), listAssignableUsers()]);
  const caps = implementationCapabilities(user);
  const permissions = { move: caps.movePhase, registerWaiting: caps.registerPending, resume: caps.resolvePending };

  return (
    <PageContainer size="full">
      <PageHeader
        title="Kanban de implantação"
        description={
          permissions.move
            ? "Arraste o card para mudar de fase. Só é possível avançar com as tarefas obrigatórias da fase concluídas."
            : "Projetos ativos por fase. Seu perfil pode consultar; a movimentação é feita pela equipe de implantação."
        }
        breadcrumbs={[{ label: "Implantação", href: "/implantacao" }, { label: "Kanban" }]}
        actions={
          canSeeHref(user, "/implantacao") ? (
            <Link href="/implantacao" className={cn(buttonVariants({ variant: "outline" }), "h-11 md:h-9")}>
              <List /> Lista de projetos
            </Link>
          ) : undefined
        }
      >
        <ProjectFilterBar owners={[]} products={[]} statuses={[]} scope={scope.kind} canTeam={scope.canTeam} showListFilters={false} />
      </PageHeader>
      <KanbanBoard rows={rows} users={users} permissions={permissions} />
    </PageContainer>
  );
}
