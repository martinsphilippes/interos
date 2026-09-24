import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Info } from "lucide-react";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { listTemplates } from "@/server/implementation/queries";
import { canOperateImplementation } from "@/server/implementation/schemas";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { TemplatesManager } from "@/components/implementation/templates-manager";

export const metadata: Metadata = { title: "Checklists de implantação" };

/** Templates de implantação por produto (fases, tarefas e checklist). */
export default async function ChecklistsPage() {
  const user = await requireUser();
  if (!canAccessModule(user, "implantacao")) redirect("/meu-dia?erro=sem-permissao");
  const { templates, products } = await listTemplates();

  return (
    <PageContainer>
      <PageHeader
        title="Checklists de implantação"
        description="Templates por produto: fases, tarefas com prazo e checklist de controle."
        breadcrumbs={[{ label: "Implantação", href: "/implantacao" }, { label: "Checklists" }]}
      />
      <div role="note" className="mb-5 flex items-start gap-3 rounded-lg border border-info/30 bg-info-soft p-4 text-sm text-info-fg">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          Quando o Financeiro libera um contrato, o projeto é criado combinando os templates ativos de todos os produtos contratados: as fases são unidas na ordem
          padrão, as tarefas de cada produto entram no plano (sem repetir títulos na mesma fase) e os itens de checklist são somados sem duplicar. O prazo do projeto
          é o maior prazo de implantação entre os produtos. Alterar um template não muda projetos já criados.
        </p>
      </div>
      <TemplatesManager templates={templates} products={products} canOperate={canOperateImplementation(user)} />
    </PageContainer>
  );
}
