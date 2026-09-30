import type { Metadata } from "next";
import { requireScreen } from "@/server/auth/session";
import { getRulesWorkspace } from "@/server/commissions/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { RulesWorkspaceView } from "@/components/commissions/rules-workspace";

export const metadata: Metadata = { title: "Regras de comissão" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Financeiro › Comissões › Regras (D14): padrão, por vendedor e exceções por contrato; criar/editar/desativar com
 * auditoria. Seção "Regras de comissão" (financeiro.comissoes.regras.ver; padrão: equipe financeira e gestores, com o
 * módulo Financeiro); sem ela, volta para Comissões com aviso. Criar/editar, ativar, exceção por contrato e dia de
 * pagamento têm chave própria (botões calculados no servidor e checados de novo nas Server Actions); sem nenhuma, modo
 * leitura.
 */
export default async function CommissionRulesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreen("financeiro.comissoes.regras.ver");
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
