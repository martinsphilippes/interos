"use client";

import * as React from "react";
import { CalendarRange } from "lucide-react";
import { planOccurrences, REPEAT_MAX_EVERY, REPEAT_MAX_OCCURRENCES, REPEAT_MIN_OCCURRENCES, REPEAT_UNIT_LABELS, type RepeatInput, type RepeatMode, type RepeatUnit } from "@/domain/title-repeat";
import { formatCompetence, formatCurrency, formatDateKey } from "@/lib/format";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/** Estado dos campos de repetição no formulário (texto: o usuário digita livremente). */
export interface RepeatState {
  count: string;
  every: string;
  unit: RepeatUnit;
}

export const DEFAULT_REPEAT: RepeatState = { count: "2", every: "1", unit: "meses" };

/** Repetição para a action (Único = sem repetição). */
export function repeatInput(mode: RepeatMode, state: RepeatState): RepeatInput | undefined {
  if (mode === "unico") return undefined;
  return { mode, count: Math.floor(Number(state.count)), every: Math.floor(Number(state.every)), unit: state.unit };
}

/**
 * Quantas vezes + "a cada N dias, semanas ou meses" (etapa CP/CR 4). Só aparece nos modos Fixo e Parcelado; padrão a cada
 * 1 mês; N ≥ 1; 2 a 120 ocorrências.
 */
export function RepeatFields({ id, mode, value, onChange }: { id: string; mode: RepeatMode; value: RepeatState; onChange: (next: RepeatState) => void }) {
  if (mode === "unico") return null;
  return (
    <>
      <FormField label={mode === "parcelado" ? "Número de parcelas" : "Quantas vezes"} htmlFor={`${id}-count`} required hint={`${REPEAT_MIN_OCCURRENCES} a ${REPEAT_MAX_OCCURRENCES}`}>
        <Input id={`${id}-count`} type="number" inputMode="numeric" min={REPEAT_MIN_OCCURRENCES} max={REPEAT_MAX_OCCURRENCES} value={value.count} onChange={(e) => onChange({ ...value, count: e.target.value })} />
      </FormField>
      <FormField label="Intervalo" htmlFor={`${id}-every`} required hint="Meses: mesmo dia do 1º vencimento (limitado ao fim do mês)">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-sm text-muted">a cada</span>
          <Input id={`${id}-every`} aria-label="Intervalo (a cada)" className="w-20" type="number" inputMode="numeric" min={1} max={REPEAT_MAX_EVERY} value={value.every} onChange={(e) => onChange({ ...value, every: e.target.value })} />
          <Select id={`${id}-unit`} aria-label="Unidade do intervalo" value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value as RepeatUnit })} options={(Object.keys(REPEAT_UNIT_LABELS) as RepeatUnit[]).map((u) => ({ value: u, label: REPEAT_UNIT_LABELS[u] }))} />
        </div>
      </FormField>
    </>
  );
}

/**
 * Prévia ao vivo das datas e valores (a MESMA função que o servidor usa para gravar: `planOccurrences`). Mostra o erro
 * de validação quando os dados ainda não fecham (ex.: menos de 2 ocorrências).
 */
export function OccurrencePreview({ description, amount, dueDate, competence, repeat, verb, className }: { description: string; amount: number | null; dueDate: string; competence?: string; repeat?: RepeatInput; verb: string; className?: string }) {
  const plan = React.useMemo(() => planOccurrences({ description: description.trim() || "(sem descrição)", amount: amount ?? 0, dueDate, competence: competence || undefined, repeat }), [description, amount, dueDate, competence, repeat]);
  const many = plan.ok && plan.value.length > 1;
  const total = plan.ok ? plan.value.reduce((s, o) => s + Math.round(o.amount * 100), 0) / 100 : 0;
  return (
    <section className={`rounded-lg border border-border bg-surface-muted/60 p-3 ${className ?? ""}`} aria-live="polite" data-testid="occurrence-preview">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
        <CalendarRange className="size-4 text-muted" aria-hidden /> Prévia {many ? `· ${plan.value.length} títulos · total ${formatCurrency(total)}` : ""}
      </h3>
      {!plan.ok ? (
        <p className="text-sm text-muted" data-testid="occurrence-preview-error">
          {plan.error}
        </p>
      ) : (
        <ol className="max-h-56 divide-y divide-border overflow-y-auto text-sm">
          {plan.value.map((o) => (
            <li key={o.index} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 py-1.5" data-testid="occurrence-row">
              <span className="tabular-nums font-medium" data-testid="occurrence-date">
                {formatDateKey(o.dueDate)}
              </span>
              <span className="min-w-0 truncate text-muted" title={o.description}>
                {o.description} · comp. {formatCompetence(o.competence)}
              </span>
              <span className="tabular-nums" data-testid="occurrence-amount">
                {formatCurrency(o.amount)}
              </span>
            </li>
          ))}
        </ol>
      )}
      {plan.ok ? <p className="mt-2 text-xs text-muted">{many ? `Todos na mesma série; ${verb} cada um pela lista.` : "Um título."}</p> : null}
    </section>
  );
}
