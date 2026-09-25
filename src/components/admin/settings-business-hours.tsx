"use client";

import * as React from "react";
import type { HorarioComercial } from "@/server/admin/schemas";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { WEEKDAYS } from "./admin-model";
import { SettingsSection } from "./settings-section";
import { useSaveSetting } from "./use-save-setting";

const HOURS = Array.from({ length: 25 }, (_, h) => h);
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function SettingsBusinessHours({ value, stored }: { value: HorarioComercial; stored: boolean }) {
  const { pending, error, setError, save } = useSaveSetting("horario_comercial");
  const [inicio, setInicio] = React.useState(value.inicio);
  const [fim, setFim] = React.useState(value.fim);
  const [dias, setDias] = React.useState<number[]>(value.dias);

  const toggleDay = (day: number, checked: boolean) => setDias((d) => (checked ? Array.from(new Set([...d, day])) : d.filter((x) => x !== day)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inicio >= fim) {
      setError("O início do expediente deve ser antes do fim");
      return;
    }
    if (dias.length === 0) {
      setError("Selecione pelo menos um dia da semana");
      return;
    }
    save({ inicio, fim, dias } satisfies HorarioComercial, "Horário comercial salvo");
  };

  const hoursPerDay = Math.max(0, fim - inicio);

  return (
    <SettingsSection title="Horário comercial" description="Expediente usado no cálculo de SLA em horas úteis. Feriados ficam na aba ao lado." stored={stored} pending={pending} error={error} onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Início do expediente" htmlFor="hc-inicio" required>
          <Select id="hc-inicio" value={String(inicio)} onChange={(e) => setInicio(Number(e.target.value))} options={HOURS.slice(0, 24).map((h) => ({ value: String(h), label: hourLabel(h) }))} />
        </FormField>
        <FormField label="Fim do expediente" htmlFor="hc-fim" required hint={`${hoursPerDay} hora${hoursPerDay === 1 ? "" : "s"} úteis por dia.`}>
          <Select id="hc-fim" value={String(fim)} onChange={(e) => setFim(Number(e.target.value))} options={HOURS.slice(1).map((h) => ({ value: String(h), label: hourLabel(h) }))} />
        </FormField>
      </div>
      <FormField label="Dias de trabalho" required>
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
          {WEEKDAYS.map((d) => (
            <Checkbox key={d.value} label={d.label} checked={dias.includes(d.value)} onCheckedChange={(checked) => toggleDay(d.value, checked === true)} />
          ))}
        </div>
      </FormField>
    </SettingsSection>
  );
}
