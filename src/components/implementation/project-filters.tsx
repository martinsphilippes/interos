"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, FilterX } from "lucide-react";
import type { ImplementationStatus } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { IMPLEMENTATION_STATUS_LABELS } from "@/components/clients/labels";
import { cn } from "@/lib/utils";

export interface ProjectFilterBarProps {
  owners: { id: string; name: string }[];
  products: { id: string; name: string }[];
  statuses: ImplementationStatus[];
  scope: "todos" | "equipe" | "meus";
  canTeam: boolean;
  /** Filtros de lista (status, responsável, produto, atrasadas). Desligue no kanban. */
  showListFilters?: boolean;
  className?: string;
}

const KPI_LABELS: Record<string, string> = { concluidas_mes: "Concluídas no mês", no_prazo: "Concluídas (no prazo x fora)", ativacao_7d: "Ativação em 7 dias" };

/**
 * Filtros da Implantação na URL (status, responsavel, produto, atrasadas, escopo, kpi). Cada mudança
 * navega com replace e o servidor recalcula, então os links de drill-down dos indicadores funcionam direto.
 */
export function ProjectFilterBar({ owners, products, statuses, scope, canTeam, showListFilters = true, className }: ProjectFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const apply = (patch: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const listKeys = ["status", "responsavel", "produto", "atrasadas", "kpi"];
  const active = listKeys.some((k) => searchParams.get(k));
  const kpi = searchParams.get("kpi");
  const overdue = searchParams.get("atrasadas") === "1";
  const selectClass = "h-11 md:h-auto md:max-w-[200px] [&_select]:h-11 md:[&_select]:h-9";

  const scopeOptions = [
    { value: "todos" as const, label: "Todos" },
    ...(canTeam ? [{ value: "equipe" as const, label: "Minha equipe" }] : []),
    { value: "meus" as const, label: "Meus" },
  ];

  return (
    <div className={cn("flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center", pending && "opacity-70", className)} aria-busy={pending || undefined}>
      <SegmentedControl aria-label="Escopo" options={scopeOptions} value={scope} onChange={(v) => apply({ escopo: v })} className="self-start" />
      {showListFilters ? (
        <>
          <Select aria-label="Status" value={searchParams.get("status") ?? ""} onChange={(e) => apply({ status: e.target.value, kpi: "" })} className={selectClass}>
            <option value="">Todos os status</option>
            <option value="ativos">Em aberto (ativos)</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {IMPLEMENTATION_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select aria-label="Responsável" value={searchParams.get("responsavel") ?? ""} onChange={(e) => apply({ responsavel: e.target.value })} className={selectClass}>
            <option value="">Todos os responsáveis</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Produto" value={searchParams.get("produto") ?? ""} onChange={(e) => apply({ produto: e.target.value })} className={selectClass}>
            <option value="">Todos os produtos</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button variant={overdue ? "destructive" : "outline"} size="sm" className="h-11 md:h-8" aria-pressed={overdue} onClick={() => apply({ atrasadas: overdue ? "" : "1" })}>
            <AlertTriangle /> Atrasadas
          </Button>
          {kpi && KPI_LABELS[kpi] ? <span className="rounded-full bg-info-soft px-2.5 py-1 text-xs font-medium text-info-fg">Indicador: {KPI_LABELS[kpi]}</span> : null}
          {active ? (
            <Button variant="ghost" size="sm" className="h-11 md:h-8" onClick={() => apply(Object.fromEntries(listKeys.map((k) => [k, ""])))}>
              <FilterX /> Limpar filtros
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
