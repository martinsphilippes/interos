"use client";

import * as React from "react";
import { Activity, Award, BadgeCheck, BellRing, CalendarOff, Clock, Gauge, HandCoins, HeartPulse, ShieldCheck, Target, Timer, TrendingUp } from "lucide-react";
import type { SlaRule } from "@/domain/types";
import type { SettingKey, SettingValues } from "@/server/admin/schemas";
import type { ReguaPreview } from "@/server/finance/regua";
import type { OperationHealthConfig, PerformanceIndexConfig } from "@/server/kpis/health-schemas";
import { OperationHealthSettingsForm, type KpiOption } from "@/components/kpis/operation-health-settings";
import { PerformanceIndexSettingsForm } from "@/components/kpis/performance-index-settings";
import { ScreenLink } from "@/components/auth/access-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsBusinessHours } from "./settings-business-hours";
import { SettingsGoals } from "./settings-goals";
import { SettingsHealthScore } from "./settings-health-score";
import { SettingsHolidays } from "./settings-holidays";
import { SettingsLeadScoring } from "./settings-lead-scoring";
import { SettingsOpportunity } from "./settings-opportunity";
import { SettingsFinanceAlerts, SettingsFinanceGate } from "./settings-finance-gate";
import { SettingsCobrancaCanais, SettingsFinanceiroBaixa, SettingsRegua } from "./settings-cobranca";
import { SettingsContasAPagar } from "./settings-contas-a-pagar";
import { SettingsDeliveryGates } from "./settings-delivery-gates";
import { SettingsSlaRules } from "./settings-sla-rules";
import { SettingsGamification, SettingsSalesPrizes, SettingsStreak } from "./settings-performance";
import { SettingsReadOnlyContext } from "./settings-section";
import { parseSettingsTab, visibleSettingsTabs, type SettingsAccess, type SettingsTab } from "./admin-model";
import { useAdminUrl } from "./use-admin-url";

export type { SettingsAccess, SettingsTab } from "./admin-model";

const TAB_ITEMS: { value: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { value: "horario", label: "Horário comercial", icon: <Clock /> },
  { value: "feriados", label: "Feriados", icon: <CalendarOff /> },
  { value: "metas", label: "Metas de referência", icon: <Target /> },
  { value: "lead-scoring", label: "Lead scoring", icon: <TrendingUp /> },
  { value: "health-score", label: "Health score", icon: <HeartPulse /> },
  { value: "oportunidades", label: "Oportunidades", icon: <Gauge /> },
  { value: "gate-financeiro", label: "Gate financeiro", icon: <ShieldCheck /> },
  { value: "cobranca", label: "Cobrança", icon: <BellRing /> },
  { value: "contas-a-pagar", label: "Contas a pagar", icon: <HandCoins /> },
  { value: "entrega", label: "Go-live e ativação", icon: <BadgeCheck /> },
  { value: "performance", label: "Gamificação e prêmios", icon: <Award /> },
  { value: "saude-indice", label: "Saúde e índice", icon: <Activity /> },
  { value: "sla", label: "Regras de SLA", icon: <Timer /> },
];

export interface SettingsTabsProps {
  tab: SettingsTab;
  /** Só as configurações visíveis para o perfil chegam do servidor. */
  values: Partial<SettingValues>;
  stored: SettingKey[];
  slaRules: SlaRule[];
  originKeys: string[];
  interestKeys: string[];
  /** Saúde da operação (Cockpit/Gestor) e Índice de desempenho (Meu Desempenho/Gestor), do motor de KPIs. */
  operationHealth: OperationHealthConfig | null;
  performanceIndex: PerformanceIndexConfig | null;
  kpiOptions: KpiOption[];
  /** Prévia honesta da régua de cobrança (o que a varredura faria hoje, sem enviar). */
  reguaPreview: ReguaPreview | null;
  /** O que o perfil vê e edita (A12), calculado no servidor. */
  access: SettingsAccess;
}

/** Seção somente leitura quando o perfil não tem a chave de edição daquela configuração. */
function Guard({ editable, children }: { editable: boolean; children: React.ReactNode }) {
  return <SettingsReadOnlyContext.Provider value={!editable}>{children}</SettingsReadOnlyContext.Provider>;
}

function ReadOnlyBlock({ readOnly, children }: { readOnly: boolean; children: React.ReactNode }) {
  if (!readOnly) return <>{children}</>;
  return (
    <fieldset disabled className="flex flex-col gap-2">
      <p className="text-xs text-muted">Somente leitura: seu perfil não tem permissão para alterar este índice.</p>
      {children}
    </fieldset>
  );
}

/**
 * Abas das configurações (?aba=...). Cada aba é um formulário independente que salva a própria chave. Só aparecem
 * as abas e seções que o perfil pode ver; sem a chave de edição a seção fica somente leitura.
 */
export function SettingsTabs({ tab, values, stored, slaRules, originKeys, interestKeys, operationHealth, performanceIndex, kpiOptions, reguaPreview, access }: SettingsTabsProps) {
  const { setLocal } = useAdminUrl();
  const tabs = visibleSettingsTabs(access);
  const initial = tabs.includes(tab) ? tab : (tabs[0] ?? tab);
  const [current, setCurrent] = React.useState<SettingsTab>(initial);
  const has = (key: SettingKey) => stored.includes(key);
  const sees = (key: SettingKey) => access.visible.includes(key) && values[key] !== undefined;
  const edits = (key: SettingKey) => access.editable.includes(key);
  const firstTab = tabs[0];

  return (
    <Tabs
      value={current}
      onValueChange={(v) => {
        const next = parseSettingsTab(v);
        setCurrent(next);
        setLocal({ aba: next === firstTab ? null : next });
      }}
    >
      <TabsList aria-label="Seções de configuração" className="w-full">
        {TAB_ITEMS.filter((t) => tabs.includes(t.value)).map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
            {t.icon} {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {sees("horario_comercial") ? (
        <TabsContent value="horario">
          <Guard editable={edits("horario_comercial")}>
            <SettingsBusinessHours key={JSON.stringify(values.horario_comercial)} value={values.horario_comercial!} stored={has("horario_comercial")} />
          </Guard>
        </TabsContent>
      ) : null}
      {sees("feriados") ? (
        <TabsContent value="feriados">
          <Guard editable={edits("feriados")}>
            <SettingsHolidays key={JSON.stringify(values.feriados)} value={values.feriados!} stored={has("feriados")} />
          </Guard>
        </TabsContent>
      ) : null}
      {sees("metas_referencia") ? (
        <TabsContent value="metas">
          <Guard editable={edits("metas_referencia")}>
            <SettingsGoals key={JSON.stringify(values.metas_referencia)} value={values.metas_referencia!} stored={has("metas_referencia")} />
          </Guard>
        </TabsContent>
      ) : null}
      {sees("lead_scoring") ? (
        <TabsContent value="lead-scoring">
          <Guard editable={edits("lead_scoring")}>
            <SettingsLeadScoring key={JSON.stringify(values.lead_scoring)} value={values.lead_scoring!} stored={has("lead_scoring")} originKeys={originKeys} interestKeys={interestKeys} />
          </Guard>
        </TabsContent>
      ) : null}
      {sees("health_score") ? (
        <TabsContent value="health-score">
          <Guard editable={edits("health_score")}>
            <SettingsHealthScore key={JSON.stringify(values.health_score)} value={values.health_score!} stored={has("health_score")} />
          </Guard>
        </TabsContent>
      ) : null}
      {sees("oportunidade") ? (
        <TabsContent value="oportunidades">
          <Guard editable={edits("oportunidade")}>
            <SettingsOpportunity key={JSON.stringify(values.oportunidade)} value={values.oportunidade!} stored={has("oportunidade")} />
          </Guard>
        </TabsContent>
      ) : null}
      {tabs.includes("gate-financeiro") ? (
        <TabsContent value="gate-financeiro">
          <div className="flex flex-col gap-4">
            {sees("gate_financeiro") ? (
              <Guard editable={edits("gate_financeiro")}>
                <SettingsFinanceGate key={JSON.stringify(values.gate_financeiro)} value={values.gate_financeiro!} stored={has("gate_financeiro")} />
              </Guard>
            ) : null}
            {sees("financeiro_alertas") ? (
              <Guard editable={edits("financeiro_alertas")}>
                <SettingsFinanceAlerts key={JSON.stringify(values.financeiro_alertas)} value={values.financeiro_alertas!} stored={has("financeiro_alertas")} />
              </Guard>
            ) : null}
          </div>
        </TabsContent>
      ) : null}
      {tabs.includes("cobranca") ? (
        <TabsContent value="cobranca">
          <div className="flex flex-col gap-4">
            {sees("regua_cobranca") && reguaPreview ? (
              <Guard editable={edits("regua_cobranca")}>
                <SettingsRegua key={JSON.stringify(values.regua_cobranca)} value={values.regua_cobranca!} stored={has("regua_cobranca")} preview={reguaPreview} />
              </Guard>
            ) : null}
            {sees("cobranca_canais") ? (
              <Guard editable={edits("cobranca_canais")}>
                <SettingsCobrancaCanais key={JSON.stringify(values.cobranca_canais)} value={values.cobranca_canais!} stored={has("cobranca_canais")} />
              </Guard>
            ) : null}
            {sees("financeiro_baixa") ? (
              <Guard editable={edits("financeiro_baixa")}>
                <SettingsFinanceiroBaixa key={JSON.stringify(values.financeiro_baixa)} value={values.financeiro_baixa!} stored={has("financeiro_baixa")} />
              </Guard>
            ) : null}
          </div>
        </TabsContent>
      ) : null}
      {sees("contas_a_pagar") ? (
        <TabsContent value="contas-a-pagar">
          <ScreenLink href="/financeiro/cadastros?aba=categorias" className="mb-3 inline-flex min-h-[44px] items-center gap-1.5 text-sm text-brand-fg hover:underline md:min-h-0" data-testid="link-cadastros-financeiros">
            Centros de custo e categorias com subcategoria: Financeiro › Cadastros financeiros →
          </ScreenLink>
          <Guard editable={edits("contas_a_pagar")}>
            <SettingsContasAPagar key={JSON.stringify(values.contas_a_pagar)} value={values.contas_a_pagar!} stored={has("contas_a_pagar")} />
          </Guard>
        </TabsContent>
      ) : null}
      {sees("go_live") && sees("cs_ativacao") ? (
        <TabsContent value="entrega">
          <Guard editable={edits("go_live") && edits("cs_ativacao")}>
            <SettingsDeliveryGates key={JSON.stringify([values.go_live, values.cs_ativacao])} goLive={values.go_live!} activation={values.cs_ativacao!} storedGoLive={has("go_live")} storedActivation={has("cs_ativacao")} />
          </Guard>
        </TabsContent>
      ) : null}
      {tabs.includes("performance") ? (
        <TabsContent value="performance">
          <div className="flex flex-col gap-4">
            {sees("gamificacao") ? (
              <Guard editable={edits("gamificacao")}>
                <SettingsGamification key={JSON.stringify(values.gamificacao)} value={values.gamificacao!} stored={has("gamificacao")} />
              </Guard>
            ) : null}
            {sees("premios_vendas") ? (
              <Guard editable={edits("premios_vendas")}>
                <SettingsSalesPrizes key={JSON.stringify(values.premios_vendas)} value={values.premios_vendas!} stored={has("premios_vendas")} />
              </Guard>
            ) : null}
            {sees("gamificacao.sequencia") ? (
              <Guard editable={edits("gamificacao.sequencia")}>
                <SettingsStreak key={JSON.stringify(values["gamificacao.sequencia"])} value={values["gamificacao.sequencia"]!} stored={has("gamificacao.sequencia")} />
              </Guard>
            ) : null}
          </div>
        </TabsContent>
      ) : null}
      {access.saudeIndice.visible && operationHealth && performanceIndex ? (
        <TabsContent value="saude-indice">
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Saúde da operação</CardTitle>
                <CardDescription>Índice consolidado do Cockpit e do Dashboard do Gestor: componentes, pesos, indicadores do motor de KPIs e faixas.</CardDescription>
              </CardHeader>
              <CardContent>
                <ReadOnlyBlock readOnly={!access.saudeIndice.operationHealthEditable}>
                  <OperationHealthSettingsForm key={JSON.stringify(operationHealth)} value={operationHealth} kpis={kpiOptions} />
                </ReadOnlyBlock>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Índice de desempenho</CardTitle>
                <CardDescription>Meta, pesos de Eficiência, Entrega e Qualidade e indicadores por departamento (Meu Desempenho e Gestor).</CardDescription>
              </CardHeader>
              <CardContent>
                <ReadOnlyBlock readOnly={!access.saudeIndice.performanceIndexEditable}>
                  <PerformanceIndexSettingsForm key={JSON.stringify(performanceIndex)} value={performanceIndex} />
                </ReadOnlyBlock>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      ) : null}
      {access.sla.visible ? (
        <TabsContent value="sla">
          <SettingsSlaRules rules={slaRules} canEdit={access.sla.edit} canDelete={access.sla.delete} />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}
