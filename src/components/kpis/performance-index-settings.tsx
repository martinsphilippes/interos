"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Settings2 } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { savePerformanceIndexSettings } from "@/server/kpis/actions";
import { DEFAULT_PERFORMANCE_INDEX, PERFORMANCE_DIMENSIONS, PERFORMANCE_DIMENSION_LABELS, type PerformanceIndexConfig } from "@/server/kpis/health-schemas";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS } from "@/domain/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";

const numberOr = (v: string, fallback = 0) => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Editor do setting "indice_desempenho": meta do índice, pesos de Eficiência/Entrega/Qualidade e os indicadores
 * de cada dimensão por departamento (chaves do registro separadas por vírgula) e faixas. Admin/diretoria.
 * Pronto para ser montado em /admin/configuracoes.
 */
export function PerformanceIndexSettingsForm({ value }: { value: PerformanceIndexConfig }) {
  const router = useRouter();
  const [draft, setDraft] = React.useState<PerformanceIndexConfig>(() => structuredClone(value));
  const [pending, startTransition] = React.useTransition();

  const save = () =>
    startTransition(async () => {
      const result = await savePerformanceIndexSettings(draft);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Índice de desempenho salvo");
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-4">
      <label className="flex max-w-xs flex-col gap-1 text-sm">
        Meta do índice (0–100)
        <Input inputMode="decimal" value={String(draft.meta)} onChange={(e) => setDraft((d) => ({ ...d, meta: numberOr(e.target.value, 80) }))} />
      </label>
      <div className="flex flex-col gap-3">
        {DEPARTMENT_KEYS.map((dep) => {
          const cfg = draft.departamentos[dep];
          return (
            <fieldset key={dep} className="rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-semibold">{DEPARTMENT_LABELS[dep]}</legend>
              <div className="grid gap-2 md:grid-cols-3">
                {PERFORMANCE_DIMENSIONS.map((dim) => (
                  <div key={dim} className="flex flex-col gap-1">
                    <span className="text-xs text-muted">
                      {PERFORMANCE_DIMENSION_LABELS[dim]} · peso e indicadores
                    </span>
                    <div className="flex gap-2">
                      <Input
                        aria-label={`Peso de ${PERFORMANCE_DIMENSION_LABELS[dim]} em ${DEPARTMENT_LABELS[dep]}`}
                        className="w-20"
                        inputMode="decimal"
                        value={String(cfg.pesos[dim])}
                        onChange={(e) => setDraft((d) => ({ ...d, departamentos: { ...d.departamentos, [dep]: { ...cfg, pesos: { ...cfg.pesos, [dim]: numberOr(e.target.value) } } } }))}
                      />
                      <Input
                        aria-label={`Indicadores de ${PERFORMANCE_DIMENSION_LABELS[dim]} em ${DEPARTMENT_LABELS[dep]}`}
                        value={cfg.indicadores[dim].join(", ")}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            departamentos: { ...d.departamentos, [dep]: { ...cfg, indicadores: { ...cfg.indicadores, [dim]: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) } } },
                          }))
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => setDraft(structuredClone(DEFAULT_PERFORMANCE_INDEX))} disabled={pending}>
          <RotateCcw /> Restaurar padrão
        </Button>
        <Button onClick={save} loading={pending}>
          Salvar índice
        </Button>
      </div>
    </div>
  );
}

/** Botão "Configurar" (admin/diretoria) que abre o editor do índice em um diálogo. */
export function PerformanceIndexSettingsButton({ value }: { value: PerformanceIndexConfig }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" className="h-11 md:h-8" onClick={() => setOpen(true)}>
        <Settings2 /> Configurar
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>Configurar Índice de desempenho</DialogTitle>
            <DialogDescription>Pesos e indicadores de Eficiência, Entrega e Qualidade por departamento (setting “indice_desempenho”).</DialogDescription>
          </DialogHeader>
          <DialogBody className="max-h-[70dvh] overflow-y-auto scrollbar-thin">
            <PerformanceIndexSettingsForm value={value} />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
