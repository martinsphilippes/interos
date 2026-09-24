import type { Metadata } from "next";
import { requireRole } from "@/server/auth/session";
import { getBonusRulesAdminData } from "@/server/performance/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { BonusRulesEditor } from "@/components/performance/bonus-rules-editor";

export const metadata: Metadata = { title: "Regras de bônus" };

/** Editor das regras de bônus (admin): cada alteração publica uma nova versão e não retroage. */
export default async function BonusRulesPage() {
  await requireRole("admin");
  const data = await getBonusRulesAdminData();
  return (
    <PageContainer>
      <PageHeader
        title="Regras de bônus"
        description="Departamento, % máximo do salário, pesos individual/coletivo, indicadores com peso e meta, faixas, bloqueadores e extras."
        breadcrumbs={[{ label: "Performance", href: "/performance" }, { label: "Bônus", href: "/performance/bonus" }, { label: "Regras" }]}
      />
      <BonusRulesEditor data={data} />
    </PageContainer>
  );
}
