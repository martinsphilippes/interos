import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canAccessModule, requireUser } from "@/server/auth/session";
import { canViewCommissionRules } from "@/server/commissions/permissions";
import { getRulesWorkspace } from "@/server/commissions/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { RulesWorkspaceView } from "@/components/commissions/rules-workspace";

export const metadata: Metadata = { title: "Regras de comissão" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Financeiro › Comissões › Regras (D14): padrão, por vendedor e exceções por contrato; criar/editar/desativar com
 * auditoria. Configurar é de admin, diretoria ou gestor do Financeiro (checado de novo nas Server Actions); gestores
 * veem em modo leitura; vendedor não tem acesso (volta para Comissões com aviso).
 */
export default async function CommissionRulesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (!canAccessModule(user, "financeiro") || !canViewCommissionRules(user)) redirect("/financeiro/comissoes?erro=sem-permissao");
  const sp = await searchParams;
  const selected = (Array.isArray(sp.regra) ? sp.regra[0] : sp.regra)?.trim() || undefined;
  const ws = await getRulesWorkspace(user, selected);
  return (
    <PageContainer size="full" className="max-w-[1680px]">
      <PageHeader
        title="Regras de comissão"
        description="Quem ganha quanto, sobre qual base e quando: padrão, por vendedor e exceções por contrato"
        breadcrumbs={[{ label: "Financeiro", href: "/financeiro" }, { label: "Comissões", href: "/financeiro/comissoes" }, { label: "Regras" }]}
      />
      <RulesWorkspaceView ws={ws} />
    </PageContainer>
  );
}
