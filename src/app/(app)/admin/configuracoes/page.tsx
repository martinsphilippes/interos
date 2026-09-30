import type { Metadata } from "next";
import { Suspense } from "react";
import { PRODUCT_CATEGORIES } from "@/domain/constants";
import { SETTING_PERMISSION, type PermissionKey } from "@/domain/permissions";
import type { CurrentUser } from "@/domain/types";
import { can, requireScreenAny } from "@/server/auth/session";
import { listLeadSourceKeys, loadSettingsForAdmin } from "@/server/admin/queries";
import { SETTING_KEYS, type SettingKey, type SettingValues } from "@/server/admin/schemas";
import { previewBillingReminders } from "@/server/finance/regua";
import { getOperationHealthConfig, getPerformanceIndexConfig } from "@/server/kpis/operation-health";
import { listFormulas } from "@/server/kpis/queries";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { SettingsTabs } from "@/components/admin/settings-tabs";
import { parseSettingsTab, visibleSettingsTabs, type SettingsAccess } from "@/components/admin/admin-model";

export const metadata: Metadata = { title: "Configurações" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Seção de visualização (`.ver`) de cada configuração gravada (A12): abas gerais em admin.configuracoes, abas
 * financeiras em financeiro.configuracoes (a mesma página). A edição usa SETTING_PERMISSION.
 */
const SETTING_VIEW: Record<SettingKey, PermissionKey> = {
  horario_comercial: "admin.configuracoes.horario.ver",
  feriados: "admin.configuracoes.feriados.ver",
  metas_referencia: "admin.configuracoes.metas.ver",
  lead_scoring: "admin.configuracoes.lead-scoring.ver",
  health_score: "admin.configuracoes.health-score.ver",
  oportunidade: "admin.configuracoes.oportunidades.ver",
  go_live: "admin.configuracoes.entrega.ver",
  cs_ativacao: "admin.configuracoes.entrega.ver",
  gamificacao: "admin.configuracoes.performance.ver",
  premios_vendas: "admin.configuracoes.performance.ver",
  "gamificacao.sequencia": "admin.configuracoes.performance.ver",
  gate_financeiro: "financeiro.configuracoes.gate.ver",
  financeiro_alertas: "financeiro.configuracoes.alertas.ver",
  regua_cobranca: "financeiro.configuracoes.regua.ver",
  cobranca_canais: "financeiro.configuracoes.canais.ver",
  financeiro_baixa: "financeiro.configuracoes.integracao-bancaria.ver",
  contas_a_pagar: "financeiro.configuracoes.contas-a-pagar.ver",
  comissoes_pagamento: "financeiro.configuracoes.comissoes-pagamento.ver",
};

function settingsAccess(user: CurrentUser): SettingsAccess {
  const saude = can(user, "admin.configuracoes.saude-indice.ver");
  const sla = can(user, "admin.configuracoes.sla.ver");
  return {
    visible: SETTING_KEYS.filter((k) => can(user, SETTING_VIEW[k])),
    editable: SETTING_KEYS.filter((k) => can(user, SETTING_VIEW[k]) && can(user, SETTING_PERMISSION[k])),
    saudeIndice: { visible: saude, operationHealthEditable: saude && can(user, "gestao.cockpit.configurar"), performanceIndexEditable: saude && can(user, "performance.meu-desempenho.configurar") },
    sla: { visible: sla, edit: sla && can(user, "admin.configuracoes.sla.editar"), delete: sla && can(user, "admin.configuracoes.sla.excluir") },
  };
}

/**
 * Editor das configurações do sistema (settings por chave) e das regras de SLA. ?aba= escolhe a seção. A página
 * aceita quem vê ao menos uma aba (Configurações gerais OU Configurações Financeiras, A12) e só busca/envia os dados
 * das seções permitidas.
 */
export default async function ConfiguracoesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireScreenAny(["admin.configuracoes", "financeiro.configuracoes"]);
  const sp = await searchParams;
  const access = settingsAccess(user);
  const tabs = visibleSettingsTabs(access);
  const requested = parseSettingsTab(first(sp.aba));
  const tab = tabs.includes(requested) ? requested : (tabs[0] ?? requested);
  const sees = (k: SettingKey) => access.visible.includes(k);

  const [settings, originKeys, operationHealth, performanceIndex, reguaPreview] = await Promise.all([
    loadSettingsForAdmin(),
    sees("lead_scoring") ? listLeadSourceKeys() : Promise.resolve([] as string[]),
    access.saudeIndice.visible ? getOperationHealthConfig() : Promise.resolve(null),
    access.saudeIndice.visible ? getPerformanceIndexConfig() : Promise.resolve(null),
    sees("regua_cobranca") ? previewBillingReminders() : Promise.resolve(null),
  ]);
  const kpiOptions = access.saudeIndice.visible
    ? listFormulas()
        .map((f) => ({ key: f.key, name: f.label }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    : [];
  // Seção negada: o valor nem chega ao cliente.
  const values: Partial<SettingValues> = {};
  for (const k of access.visible as SettingKey[]) (values as Record<string, unknown>)[k] = settings.values[k];
  const stored = settings.stored.filter((k) => sees(k));
  const visibleCount = access.visible.length;
  const missing = settings.stored.length < 6 && visibleCount === SETTING_KEYS.length ? 6 - settings.stored.length : 0;
  const financeOnly = !can(user, "admin.configuracoes.ver");

  return (
    <PageContainer>
      <PageHeader
        title={financeOnly ? "Configurações Financeiras" : "Configurações"}
        description={
          financeOnly
            ? "Parâmetros do Financeiro: gate financeiro, alertas, régua e canais de cobrança, baixa automática e contas a pagar."
            : "Parâmetros que os módulos leem em tempo real: SLA, metas, pontuação de leads, saúde do cliente, funil, gamificação e índices de gestão."
        }
        breadcrumbs={[{ label: "Administração", href: "/admin" }, { label: financeOnly ? "Configurações Financeiras" : "Configurações" }]}
        badge={visibleCount < SETTING_KEYS.length ? null : missing > 0 ? <Badge variant="warning">{missing} com valor padrão</Badge> : <Badge variant="success">Tudo gravado</Badge>}
      />
      <Suspense fallback={null}>
        <SettingsTabs
          key={tab}
          tab={tab}
          values={values}
          stored={stored}
          slaRules={access.sla.visible ? settings.slaRules : []}
          originKeys={originKeys}
          interestKeys={[...PRODUCT_CATEGORIES]}
          operationHealth={operationHealth}
          performanceIndex={performanceIndex}
          kpiOptions={kpiOptions}
          reguaPreview={reguaPreview}
          access={access}
        />
      </Suspense>
    </PageContainer>
  );
}
