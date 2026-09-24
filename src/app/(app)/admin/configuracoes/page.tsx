import type { Metadata } from "next";
import { Suspense } from "react";
import { PRODUCT_CATEGORIES } from "@/domain/constants";
import { requireRole } from "@/server/auth/session";
import { listLeadSourceKeys, loadSettingsForAdmin } from "@/server/admin/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { parseSettingsTab, SettingsTabs } from "@/components/admin/settings-tabs";

export const metadata: Metadata = { title: "Configurações" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Editor das configurações do sistema (settings por chave) e das regras de SLA. ?aba= escolhe a seção. */
export default async function ConfiguracoesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("admin");
  const sp = await searchParams;
  const tab = parseSettingsTab(first(sp.aba));
  const [settings, originKeys] = await Promise.all([loadSettingsForAdmin(), listLeadSourceKeys()]);
  const missing = settings.stored.length < 6 ? 6 - settings.stored.length : 0;

  return (
    <PageContainer>
      <PageHeader
        title="Configurações"
        description="Parâmetros que os módulos leem em tempo real: SLA, metas, pontuação de leads, saúde do cliente e funil."
        breadcrumbs={[{ label: "Administração", href: "/admin" }, { label: "Configurações" }]}
        badge={missing > 0 ? <Badge variant="warning">{missing} com valor padrão</Badge> : <Badge variant="success">Tudo gravado</Badge>}
      />
      <Suspense fallback={null}>
        <SettingsTabs key={tab} tab={tab} values={settings.values} stored={settings.stored} slaRules={settings.slaRules} originKeys={originKeys} interestKeys={[...PRODUCT_CATEGORIES]} />
      </Suspense>
    </PageContainer>
  );
}
