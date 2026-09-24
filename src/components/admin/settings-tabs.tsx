"use client";

import * as React from "react";
import { CalendarOff, Clock, Gauge, HeartPulse, Target, Timer, TrendingUp } from "lucide-react";
import type { SlaRule } from "@/domain/types";
import type { SettingKey, SettingValues } from "@/server/admin/schemas";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsBusinessHours } from "./settings-business-hours";
import { SettingsGoals } from "./settings-goals";
import { SettingsHealthScore } from "./settings-health-score";
import { SettingsHolidays } from "./settings-holidays";
import { SettingsLeadScoring } from "./settings-lead-scoring";
import { SettingsOpportunity } from "./settings-opportunity";
import { SettingsSlaRules } from "./settings-sla-rules";
import { parseSettingsTab, type SettingsTab } from "./admin-model";
import { useAdminUrl } from "./use-admin-url";

export type { SettingsTab } from "./admin-model";

const TAB_ITEMS: { value: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { value: "horario", label: "Horário comercial", icon: <Clock /> },
  { value: "feriados", label: "Feriados", icon: <CalendarOff /> },
  { value: "metas", label: "Metas de referência", icon: <Target /> },
  { value: "lead-scoring", label: "Lead scoring", icon: <TrendingUp /> },
  { value: "health-score", label: "Health score", icon: <HeartPulse /> },
  { value: "oportunidades", label: "Oportunidades", icon: <Gauge /> },
  { value: "sla", label: "Regras de SLA", icon: <Timer /> },
];

export interface SettingsTabsProps {
  tab: SettingsTab;
  values: SettingValues;
  stored: SettingKey[];
  slaRules: SlaRule[];
  originKeys: string[];
  interestKeys: string[];
}

/** Abas das configurações (?aba=...). Cada aba é um formulário independente que salva a própria chave. */
export function SettingsTabs({ tab, values, stored, slaRules, originKeys, interestKeys }: SettingsTabsProps) {
  const { setLocal } = useAdminUrl();
  const [current, setCurrent] = React.useState<SettingsTab>(tab);
  const has = (key: SettingKey) => stored.includes(key);

  return (
    <Tabs
      value={current}
      onValueChange={(v) => {
        const next = parseSettingsTab(v);
        setCurrent(next);
        setLocal({ aba: next === "horario" ? null : next });
      }}
    >
      <TabsList aria-label="Seções de configuração" className="w-full">
        {TAB_ITEMS.map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
            {t.icon} {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="horario">
        <SettingsBusinessHours key={JSON.stringify(values.horario_comercial)} value={values.horario_comercial} stored={has("horario_comercial")} />
      </TabsContent>
      <TabsContent value="feriados">
        <SettingsHolidays key={JSON.stringify(values.feriados)} value={values.feriados} stored={has("feriados")} />
      </TabsContent>
      <TabsContent value="metas">
        <SettingsGoals key={JSON.stringify(values.metas_referencia)} value={values.metas_referencia} stored={has("metas_referencia")} />
      </TabsContent>
      <TabsContent value="lead-scoring">
        <SettingsLeadScoring key={JSON.stringify(values.lead_scoring)} value={values.lead_scoring} stored={has("lead_scoring")} originKeys={originKeys} interestKeys={interestKeys} />
      </TabsContent>
      <TabsContent value="health-score">
        <SettingsHealthScore key={JSON.stringify(values.health_score)} value={values.health_score} stored={has("health_score")} />
      </TabsContent>
      <TabsContent value="oportunidades">
        <SettingsOpportunity key={JSON.stringify(values.oportunidade)} value={values.oportunidade} stored={has("oportunidade")} />
      </TabsContent>
      <TabsContent value="sla">
        <SettingsSlaRules rules={slaRules} />
      </TabsContent>
    </Tabs>
  );
}
