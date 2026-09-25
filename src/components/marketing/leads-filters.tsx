"use client";

import * as React from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, PERIOD_OPTIONS, TEMPERATURES, TEMPERATURE_LABELS, type LeadFilters, type MarketingOptions } from "./marketing-model";
import { useMarketingUrl } from "./use-marketing-url";

export interface LeadsFiltersProps {
  filters: LeadFilters;
  options: MarketingOptions;
  total: number;
}

/** Filtros da lista de leads. Todo estado vive na URL (compartilhável e usado pelos drill-downs). */
export function LeadsFilters({ filters, options, total }: LeadsFiltersProps) {
  const { navigate, pending } = useMarketingUrl();
  const [expanded, setExpanded] = React.useState(Boolean(filters.origin || filters.campaignId || filters.ownerId || filters.period || filters.noContact || filters.possibleDuplicate || filters.needsAction));
  const set = (patch: Record<string, string | undefined>) => navigate({ ...patch, lead: null }, { replace: true });
  const activeCount = [filters.q, filters.status, filters.temperature, filters.origin, filters.campaignId, filters.ownerId, filters.period, filters.noContact, filters.possibleDuplicate, filters.needsAction].filter(Boolean).length;
  const statusValue = filters.status?.join(",") ?? "";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <SearchInput value={filters.q ?? ""} onChange={(q) => set({ q: q || undefined })} debounceMs={350} placeholder="Buscar por nome, empresa, telefone, e-mail ou cidade…" className="md:max-w-md" aria-label="Buscar leads" />
        <div className="flex flex-wrap items-center gap-2">
          <Select size="sm" aria-label="Status" value={statusValue} onChange={(e) => set({ status: e.target.value || undefined })} className="w-auto min-w-[150px]">
            <option value="">Todos os status</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABELS[s]}
              </option>
            ))}
            <option value="novo,em_contato">Abertos (novo + em contato)</option>
            <option value="qualificado,convertido">MQLs (qualificado + convertido)</option>
            {statusValue && !LEAD_STATUSES.includes(statusValue as never) && !["novo,em_contato", "qualificado,convertido"].includes(statusValue) ? <option value={statusValue}>Seleção atual</option> : null}
          </Select>
          <Select size="sm" aria-label="Temperatura" value={filters.temperature ?? ""} onChange={(e) => set({ temperatura: e.target.value || undefined })} className="w-auto min-w-[140px]">
            <option value="">Toda temperatura</option>
            {TEMPERATURES.map((t) => (
              <option key={t} value={t}>
                {TEMPERATURE_LABELS[t]}
              </option>
            ))}
          </Select>
          <Select size="sm" aria-label="Ordenar" value={filters.sort ?? "score"} onChange={(e) => set({ ordenar: e.target.value === "data" ? "data" : undefined })} className="w-auto min-w-[160px]">
            <option value="score">Maior score</option>
            <option value="data">Mais recentes</option>
          </Select>
          <Button variant={expanded ? "secondary" : "outline"} size="sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            <SlidersHorizontal /> Mais filtros
          </Button>
          {activeCount > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => navigate({ q: null, status: null, temperatura: null, origem: null, campanha: null, responsavel: null, periodo: null, data: null, semContato: null, duplicidade: null, acao: null, lead: null }, { replace: true })}>
              <X /> Limpar ({activeCount})
            </Button>
          ) : null}
          <span className="flex items-center gap-2 text-sm text-muted tabular-nums">
            {pending ? <Spinner size="sm" /> : null}
            {total} {total === 1 ? "lead" : "leads"}
          </span>
        </div>
      </div>

      <div className={cn("grid gap-2 rounded-lg border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4", !expanded && "hidden")}>
        <Select size="sm" aria-label="Origem" value={filters.origin ?? ""} onChange={(e) => set({ origem: e.target.value || undefined })}>
          <option value="">Todas as origens</option>
          {options.sources.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select size="sm" aria-label="Campanha" value={filters.campaignId ?? ""} onChange={(e) => set({ campanha: e.target.value || undefined })}>
          <option value="">Todas as campanhas</option>
          {options.campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select size="sm" aria-label="Responsável" value={filters.ownerId ?? ""} onChange={(e) => set({ responsavel: e.target.value || undefined })}>
          <option value="">Todos os responsáveis</option>
          <option value="nenhum">Sem responsável</option>
          {options.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Select size="sm" aria-label="Período" value={filters.period ?? ""} onChange={(e) => set({ periodo: e.target.value || undefined, data: e.target.value && filters.dateField === "qualificacao" ? "qualificacao" : undefined })}>
          <option value="">Qualquer data</option>
          {PERIOD_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {filters.dateField === "qualificacao" ? `Qualificados: ${p.label.toLowerCase()}` : `Captados: ${p.label.toLowerCase()}`}
            </option>
          ))}
        </Select>
        <div className="flex flex-wrap items-center gap-x-5 sm:col-span-2 lg:col-span-4">
          <Checkbox label="Sem contato há mais de 24h" checked={Boolean(filters.noContact)} onCheckedChange={(c) => set({ semContato: c === true ? "1" : undefined })} />
          <Checkbox label="Possível duplicidade" checked={Boolean(filters.possibleDuplicate)} onCheckedChange={(c) => set({ duplicidade: c === true ? "1" : undefined })} />
          <Checkbox label="Precisa de ação (sem responsável ou ação vencida)" checked={Boolean(filters.needsAction)} onCheckedChange={(c) => set({ acao: c === true ? "1" : undefined })} />
        </div>
      </div>
    </div>
  );
}
