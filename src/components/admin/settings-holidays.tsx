"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import type { Feriados } from "@/server/admin/schemas";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FormField } from "@/components/ui/form-field";
import { SettingsSection } from "./settings-section";
import { useSaveSetting } from "./use-save-setting";

/** Rótulo do dia (data em AAAA-MM-DD, sem fuso). */
function dayLabel(date: string): string {
  return formatDate(`${date}T12:00:00`, "EEEE, dd 'de' MMMM 'de' yyyy");
}

export function SettingsHolidays({ value, stored }: { value: Feriados; stored: boolean }) {
  const { pending, error, setError, save } = useSaveSetting("feriados");
  const [dates, setDates] = React.useState<string[]>(() => [...value.dates].sort());
  const [draft, setDraft] = React.useState("");
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = today.slice(0, 4);

  const add = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft)) {
      setError("Informe uma data válida");
      return;
    }
    if (dates.includes(draft)) {
      setError(`${formatDate(`${draft}T12:00:00`)} já está na lista`);
      return;
    }
    setError(null);
    setDates((d) => [...d, draft].sort());
    setDraft("");
  };

  const groups = React.useMemo(() => {
    const byYear = new Map<string, string[]>();
    for (const d of dates) {
      const year = d.slice(0, 4);
      byYear.set(year, [...(byYear.get(year) ?? []), d]);
    }
    return Array.from(byYear.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [dates]);

  return (
    <SettingsSection title="Feriados" description="Datas que não contam como horas úteis no SLA. Inclua os feriados nacionais e os locais (Juazeiro do Norte)." stored={stored} pending={pending} error={error} onSubmit={(e) => { e.preventDefault(); save({ dates } satisfies Feriados, "Feriados salvos"); }}>
      <FormField label="Adicionar feriado" htmlFor="fer-date">
        <div className="flex items-center gap-2">
          <DateInput
            id="fer-date"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            className="max-w-[200px]"
          />
          <Button type="button" variant="outline" onClick={add} disabled={!draft}>
            <Plus /> Adicionar
          </Button>
        </div>
      </FormField>

      {dates.length === 0 ? (
        <p className="text-sm text-muted">Nenhum feriado cadastrado: todo dia útil conta para o SLA.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(([year, list]) => (
            <div key={year}>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                {year}
                <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium tabular-nums text-muted">{list.length}</span>
                {year < currentYear ? <span className="text-xs font-normal text-muted">(passado)</span> : null}
              </h4>
              <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((d) => (
                  <li key={d} className={`flex min-h-[40px] items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-sm ${d < today ? "text-muted" : ""}`}>
                    <span className="truncate capitalize">{dayLabel(d)}</span>
                    <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`Remover ${formatDate(`${d}T12:00:00`)}`} onClick={() => setDates((all) => all.filter((x) => x !== d))}>
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
