import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { List } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { listAssignableUsers, listKanbanProjects } from "@/server/implementation/queries";
import { canOperateImplementation, readProjectFilters } from "@/server/implementation/schemas";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { KanbanBoard } from "@/components/implementation/kanban-board";
import { ProjectFilterBar } from "@/components/implementation/project-filters";

export const metadata: Metadata = { title: "Kanban de implantação" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ImplementationKanbanPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "implantacao")) redirect("/meu-dia?erro=sem-permissao");
  const params = await searchParams;
  const filters = readProjectFilters((key) => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  });
  const [{ rows, scope }, users] = await Promise.all([listKanbanProjects(user, filters.scope), listAssignableUsers()]);
  const canOperate = canOperateImplementation(user);

  return (
    <PageContainer size="full">
      <PageHeader
        title="Kanban de implantação"
        description={
          canOperate
            ? "Arraste o card para mudar de fase. Só é possível avançar com as tarefas obrigatórias da fase concluídas."
            : "Projetos ativos por fase. Seu perfil pode consultar; a movimentação é feita pela equipe de implantação."
        }
        breadcrumbs={[{ label: "Implantação", href: "/implantacao" }, { label: "Kanban" }]}
        actions={
          <Button asChild variant="outline" className="h-11 md:h-9">
            <Link href="/implantacao">
              <List /> Lista de projetos
            </Link>
          </Button>
        }
      >
        <ProjectFilterBar owners={[]} products={[]} statuses={[]} scope={scope.kind} canTeam={scope.canTeam} showListFilters={false} />
      </PageHeader>
      <KanbanBoard rows={rows} users={users} canOperate={canOperate} />
    </PageContainer>
  );
}
