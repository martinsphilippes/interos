"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface KeyValueRow {
  key: string;
  value: string;
}

export interface KeyValueEditorProps {
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  keyLabel?: string;
  valueLabel?: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Sugestões de chave (datalist). */
  suggestions?: string[];
  addLabel?: string;
  disabled?: boolean;
  /** Passo do input numérico (ex.: "1" para inteiros, "0.01" para decimais). */
  step?: string;
  className?: string;
  emptyText?: string;
}

/**
 * Editor de pares chave/valor numérico (metas mensais, pontuação de lead scoring, pesos do health
 * score). O valor fica como texto até o envio; a conversão e a validação acontecem no formulário.
 */
export function KeyValueEditor({
  rows,
  onChange,
  keyLabel = "Chave",
  valueLabel = "Valor",
  keyPlaceholder = "chave",
  valuePlaceholder = "0",
  suggestions,
  addLabel = "Adicionar",
  disabled,
  step = "any",
  className,
  emptyText = "Nenhum item.",
}: KeyValueEditorProps) {
  const listId = React.useId();
  const setRow = (index: number, patch: Partial<KeyValueRow>) => onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const removeRow = (index: number) => onChange(rows.filter((_, i) => i !== index));
  const addRow = () => onChange([...rows, { key: "", value: "" }]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {suggestions && suggestions.length > 0 ? (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
      {rows.length === 0 ? <p className="text-xs text-muted">{emptyText}</p> : null}
      {rows.length > 0 ? (
        <div className="grid grid-cols-[1fr_120px_36px] items-center gap-2 text-xs font-medium text-muted">
          <span>{keyLabel}</span>
          <span>{valueLabel}</span>
          <span className="sr-only">Remover</span>
        </div>
      ) : null}
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[1fr_120px_36px] items-center gap-2">
          <Input
            value={row.key}
            onChange={(e) => setRow(index, { key: e.target.value })}
            placeholder={keyPlaceholder}
            list={suggestions && suggestions.length > 0 ? listId : undefined}
            aria-label={`${keyLabel} ${index + 1}`}
            disabled={disabled}
            autoComplete="off"
          />
          <Input
            type="number"
            inputMode="decimal"
            step={step}
            value={row.value}
            onChange={(e) => setRow(index, { value: e.target.value })}
            placeholder={valuePlaceholder}
            aria-label={`${valueLabel} ${index + 1}`}
            disabled={disabled}
            className="tabular-nums"
          />
          <Button type="button" variant="ghost" size="icon" className="size-9" aria-label={`Remover ${row.key || "item"}`} onClick={() => removeRow(index)} disabled={disabled}>
            <X />
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={disabled}>
          <Plus /> {addLabel}
        </Button>
      </div>
    </div>
  );
}

/** Record<string, number> -> linhas do editor. */
export function recordToRows(record: Record<string, number> | undefined | null): KeyValueRow[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value: String(value) }));
}

/**
 * Linhas do editor -> Record<string, number>. Linhas totalmente vazias são ignoradas;
 * chave sem valor (ou valor inválido) e chave duplicada geram erro em português.
 */
export function rowsToRecord(rows: KeyValueRow[], label = "item"): { ok: true; value: Record<string, number> } | { ok: false; error: string } {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = row.key.trim();
    const text = row.value.trim().replace(",", ".");
    if (!key && !text) continue;
    if (!key) return { ok: false, error: `Informe a chave do ${label} com valor ${row.value}` };
    if (!text) return { ok: false, error: `Informe o valor de "${key}"` };
    const value = Number(text);
    if (Number.isNaN(value)) return { ok: false, error: `Valor inválido em "${key}"` };
    if (key in out) return { ok: false, error: `Chave "${key}" repetida` };
    out[key] = value;
  }
  return { ok: true, value: out };
}
