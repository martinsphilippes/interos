import type { Metadata } from "next";
import { can, requireScreen } from "@/server/auth/session";
import { getBonusRulesAdminData } from "@/server/performance/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { BonusRulesEditor } from "@/components/performance/bonus-rules-editor";

export const metadata: Metadata = { title: "Regras de bônus" };

/**
 * Editor das regras de bônus (seção performance.bonus.regras.ver; padrão: admin): cada alteração publica uma nova
 * versão e não retroage. Sem performance.bonus.regras.editar a tela fica somente leitura.
 */
export default async function BonusRulesPage() {
  const user = await requireScreen("performance.bonus.regras.ver");
  const canEdit = can(user, "performance.bonus.regras.editar");
  const data = await getBonusRulesAdminData();
  return (
    <PageContainer>
      <PageHeader
        title="Regras de bônus"
        description="Departamento, % máximo do salário, pesos individual/coletivo, indicadores com peso e meta, faixas, bloqueadores e extras."
        breadcrumbs={[{ label: "Performance", href: "/performance" }, { label: "Bônus", href: "/performance/bonus" }, { label: "Regras" }]}
      />
      <BonusRulesEditor data={data} readOnly={!canEdit} />
    </PageContainer>
  );
}
