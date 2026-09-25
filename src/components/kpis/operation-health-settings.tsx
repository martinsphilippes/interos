"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { saveOperationHealthSettings } from "@/server/kpis/actions";
import { DEFAULT_OPERATION_HEALTH, GOALS_ENTRY_KEY, NORMALIZATION_KINDS, NORMALIZATION_LABELS, type NormalizationKind, type OperationHealthConfig } from "@/server/kpis/health-schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";

export interface KpiOption {
  key: string;
  name: string;
}

type Draft = OperationHealthConfig;

const numberOr = (v: string, fallback = 0) => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
};

const fieldClass = "h-11 w-full rounded-lg border border-border-strong bg-surface-muted px-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 md:h-9";

/**
 * Editor do setting "saude_operacao": componentes (nome, peso, descrição), indicadores de cada componente
 * (indicador do motor, peso e normalização para 0–100) e faixas (nome e nota mínima). Admin/diretoria.
 * Pronto para ser montado também em /admin/configuracoes.
 */
export function OperationHealthSettingsForm({ value, kpis, onSaved }: { value: OperationHealthConfig; kpis: KpiOption[]; onSaved?: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = React.useState<Draft>(() => structuredClone(value));
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const setComponent = (i: number, patch: Partial<Draft["componentes"][number]>) => setDraft((d) => ({ ...d, componentes: d.componentes.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const setEntry = (i: number, k: number, patch: Partial<Draft["componentes"][number]["kpis"][number]>) =>
    setComponent(i, { kpis: draft.componentes[i].kpis.map((e, j) => (j === k ? { ...e, ...patch } : e)) });

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveOperationHealthSettings(draft);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Configuração da Saúde da operação salva");
      onSaved?.();
      router.refresh();
    });
  };

  const options = [{ key: GOALS_ENTRY_KEY, name: "Metas do período (atingimento médio)" }, ...kpis];

  return (
    <div className="flex flex-col gap-5">
      {draft.componentes.map((c, i) => (
        <fieldset key={i} className="rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold">{c.label || `Componente ${i + 1}`}</legend>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_110px_auto]">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Nome
              <Input value={c.label} onChange={(e) => setComponent(i, { label: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Chave
              <Input value={c.key} onChange={(e) => setComponent(i, { key: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Peso
              <Input inputMode="decimal" value={String(c.peso)} onChange={(e) => setComponent(i, { peso: numberOr(e.target.value) })} />
            </label>
            <div className="flex items-end">
              <Button variant="ghost" size="icon" className="size-11 md:size-9" aria-label={`Remover ${c.label}`} onClick={() => setDraft((d) => ({ ...d, componentes: d.componentes.filter((_, j) => j !== i) }))}>
                <Trash2 />
              </Button>
            </div>
          </div>
          <label className="mt-2 flex flex-col gap-1 text-xs text-muted">
            O que mede
            <Input value={c.descricao ?? ""} onChange={(e) => setComponent(i, { descricao: e.target.value })} />
          </label>
          <ul className="mt-3 flex flex-col gap-2">
            {c.kpis.map((entry, k) => (
              <li key={k} className="grid gap-2 rounded-md bg-surface-muted/60 p-2 md:grid-cols-[minmax(0,1.4fr)_70px_minmax(0,1.3fr)_minmax(0,1fr)_auto]">
                <select aria-label="Indicador" className={fieldClass} value={entry.kpiKey} onChange={(e) => setEntry(i, k, { kpiKey: e.target.value, normalizacao: e.target.value === GOALS_ENTRY_KEY ? { tipo: "metas_periodo" } : entry.normalizacao })}>
                  {options.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <Input aria-label="Peso do indicador" inputMode="decimal" value={String(entry.peso)} onChange={(e) => setEntry(i, k, { peso: numberOr(e.target.value, 1) })} />
                <select aria-label="Normalização" className={fieldClass} value={entry.normalizacao.tipo} onChange={(e) => setEntry(i, k, { normalizacao: { tipo: e.target.value as NormalizationKind } })}>
                  {NORMALIZATION_KINDS.map((n) => (
                    <option key={n} value={n}>
                      {NORMALIZATION_LABELS[n]}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  {entry.normalizacao.tipo === "escala" ? (
                    <>
                      <Input aria-label="Valor que vale 0" placeholder="0 →" inputMode="decimal" value={entry.normalizacao.min ?? ""} onChange={(e) => setEntry(i, k, { normalizacao: { ...entry.normalizacao, min: numberOr(e.target.value) } })} />
                      <Input aria-label="Valor que vale 100" placeholder="100 →" inputMode="decimal" value={entry.normalizacao.max ?? ""} onChange={(e) => setEntry(i, k, { normalizacao: { ...entry.normalizacao, max: numberOr(e.target.value) } })} />
                    </>
                  ) : entry.normalizacao.tipo === "proporcao_inversa" ? (
                    <select aria-label="Indicador de base" className={fieldClass} value={entry.normalizacao.baseKpi ?? ""} onChange={(e) => setEntry(i, k, { normalizacao: { ...entry.normalizacao, baseKpi: e.target.value } })}>
                      <option value="">Base…</option>
                      {kpis.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
                <Button variant="ghost" size="icon" className="size-11 md:size-9" aria-label="Remover indicador" onClick={() => setComponent(i, { kpis: c.kpis.filter((_, j) => j !== k) })}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setComponent(i, { kpis: [...c.kpis, { kpiKey: kpis[0]?.key ?? "", peso: 1, normalizacao: { tipo: "atingimento" } }] })}>
            <Plus /> Indicador
          </Button>
        </fieldset>
      ))}
      <Button variant="outline" className="self-start" onClick={() => setDraft((d) => ({ ...d, componentes: [...d.componentes, { key: `componente_${d.componentes.length + 1}`, label: "Novo componente", peso: 10, kpis: [{ kpiKey: kpis[0]?.key ?? "", peso: 1, normalizacao: { tipo: "atingimento" } }] }] }))}>
        <Plus /> Componente
      </Button>

      <fieldset className="rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-semibold">Faixas</legend>
        <ul className="grid gap-2 sm:grid-cols-2">
          {draft.faixas.map((b, i) => (
            <li key={i} className="flex items-center gap-2">
              <Input aria-label="Nome da faixa" value={b.label} onChange={(e) => setDraft((d) => ({ ...d, faixas: d.faixas.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))} />
              <span className="shrink-0 text-xs text-muted">a partir de</span>
              <Input aria-label="Nota mínima" className="w-20" inputMode="decimal" value={String(b.min)} onChange={(e) => setDraft((d) => ({ ...d, faixas: d.faixas.map((x, j) => (j === i ? { ...x, min: numberOr(e.target.value) } : x)) }))} />
              <Button variant="ghost" size="icon" className="size-11 shrink-0 md:size-9" aria-label="Remover faixa" onClick={() => setDraft((d) => ({ ...d, faixas: d.faixas.filter((_, j) => j !== i) }))}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setDraft((d) => ({ ...d, faixas: [...d.faixas, { label: "Nova faixa", min: 50 }] }))}>
          <Plus /> Faixa
        </Button>
      </fieldset>

      {error ? <p className="text-sm text-danger-fg">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => setDraft(structuredClone(DEFAULT_OPERATION_HEALTH))} disabled={pending}>
          <RotateCcw /> Restaurar padrão
        </Button>
        <Button onClick={save} loading={pending}>
          Salvar configuração
        </Button>
      </div>
    </div>
  );
}
