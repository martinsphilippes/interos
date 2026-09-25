"use client";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { Spinner } from "@/components/ui/spinner";
import type { PeriodKey } from "./marketing-model";
import { useMarketingUrl } from "./use-marketing-url";

const SHORT_LABELS: { value: PeriodKey; label: string }[] = [
  { value: "mes", label: "Mês atual" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
  { value: "ano", label: "Ano" },
];

/** Seletor de período da Visão Geral (?periodo=mes|30d|90d|ano). */
export function PeriodSelect({ value }: { value: PeriodKey }) {
  const { navigate, pending } = useMarketingUrl();
  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
      <SegmentedControl aria-label="Período" options={SHORT_LABELS} value={value} onChange={(next) => navigate({ periodo: next === "mes" ? null : next }, { replace: true })} />
      {pending ? <Spinner size="sm" /> : null}
    </div>
  );
}
