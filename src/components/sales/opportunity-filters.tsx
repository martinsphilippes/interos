"use client";

import * as React from "react";
import { FilterX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { OpportunityRow, PipelineStage, ProductOption, UserLite } from "@/server/sales/queries";
import { isOpenStage } from "./model";
import { useSalesUrl } from "./use-sales-url";

/** Filtros das listas de oportunidades (valores vindos da URL, aplicados no cliente). */
export interface OpportunityFilters {
  q: string;
  seller: string;
  temperature: string;
  product: string;
  minValue: number;
  mine: boolean;
  overdue: boolean;
  stage: string;
  situation: "abertas" | "ganhas" | "perdidas" | "todas";
  quick: "" | "atrasadas" | "sem_proxima" | "paradas" | "ganhas_mes";
  sort: "atividade" | "valor" | "proxima_acao" | "etapa" | "cliente";
}

export function readFilters(get: (key: string) => string | null): OpportunityFilters {
  const situation = get("situacao");
  const quick = get("filtro");
  const sort = get("ordenar");
  return {
    q: get("q") ?? "",
    seller: get("vendedor") ?? "",
    temperature: get("temp") ?? "",
    product: get("produto") ?? "",
    minValue: Number(get("min")) || 0,
    mine: get("minhas") === "1",
    overdue: get("atrasadas") === "1",
    stage: get("etapa") ?? "",
    situation: situation === "ganhas" || situation === "perdidas" || situation === "todas" ? situation : "abertas",
    quick: quick === "atrasadas" || quick === "sem_proxima" || quick === "paradas" || quick === "ganhas_mes" ? quick : "",
    sort: sort === "valor" || sort === "proxima_acao" || sort === "etapa" || sort === "cliente" ? sort : "atividade",
  };
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const STAGE_ORDER = ["qualificacao", "diagnostico", "proposta", "negociacao", "fechamento", "ganho", "perdido"];

export function applyFilters(rows: OpportunityRow[], f: OpportunityFilters, ctx: { userId: string; competence: string; ignoreSituation?: boolean }): OpportunityRow[] {
  const term = normalize(f.q.trim());
  const out = rows.filter((r) => {
    if (!ctx.ignoreSituation) {
      if (f.situation === "abertas" && !isOpenStage(r.stage)) return false;
      if (f.situation === "ganhas" && r.stage !== "ganho") return false;
      if (f.situation === "perdidas" && r.stage !== "perdido") return false;
    }
    if (f.seller && r.ownerId !== f.seller) return false;
    if (f.mine && r.ownerId !== ctx.userId) return false;
    if (f.temperature && r.temperature !== f.temperature) return false;
    if (f.product && !r.products.some((p) => p.productId === f.product)) return false;
    if (f.minValue > 0 && r.monthlyTotal < f.minValue) return false;
    if (f.overdue && !r.overdue) return false;
    if (f.stage && r.stage !== f.stage) return false;
    if (f.quick === "atrasadas" && !r.overdue) return false;
    if (f.quick === "sem_proxima" && !r.noNextAction) return false;
    if (f.quick === "paradas" && !r.stalled) return false;
    if (f.quick === "ganhas_mes" && !(r.stage === "ganho" && r.wonAt && r.wonAt.slice(0, 7) >= ctx.competence)) return false;
    if (term && !normalize(`${r.title} ${r.clientName} ${r.contactName ?? ""} ${r.ownerName}`).includes(term)) return false;
    return true;
  });
  const annual = (r: OpportunityRow) => r.monthlyTotal * 12 + r.setupTotal + r.hardwareTotal;
  return out.sort((a, b) => {
    switch (f.sort) {
      case "valor":
        return annual(b) - annual(a);
      case "proxima_acao":
        return (a.nextActionAt ?? "0").localeCompare(b.nextActionAt ?? "0");
      case "etapa":
        return STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) || a.clientName.localeCompare(b.clientName, "pt-BR");
      case "cliente":
        return a.clientName.localeCompare(b.clientName, "pt-BR");
      default:
        return b.lastActivityAt.localeCompare(a.lastActivityAt);
    }
  });
}

export interface OpportunityFilterBarProps {
  filters: OpportunityFilters;
  sellers: UserLite[];
  products: ProductOption[];
  /** "pipeline": sem etapa/situação; "tabela": todos os filtros. */
  variant: "pipeline" | "tabela";
  stages?: PipelineStage[];
  count: number;
  total: number;
}

export function OpportunityFilterBar({ filters, sellers, products, variant, stages = [], count, total }: OpportunityFilterBarProps) {
  const { setLocal } = useSalesUrl();
  const [minDraft, setMinDraft] = React.useState(filters.minValue ? String(filters.minValue) : "");
  const active =
    Boolean(filters.q || filters.seller || filters.temperature || filters.product || filters.minValue || filters.mine || filters.overdue || filters.stage || filters.quick) || (variant === "tabela" && filters.situation !== "abertas");

  const clear = () => {
    setMinDraft("");
    setLocal({ q: null, vendedor: null, temp: null, produto: null, min: null, minhas: null, atrasadas: null, etapa: null, filtro: null, situacao: null });
  };

  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center">
        {variant === "tabela" ? <SearchInput value={filters.q} onChange={(v) => setLocal({ q: v })} debounceMs={200} placeholder="Buscar cliente, título ou contato…" className="col-span-2 md:w-72" size="sm" /> : null}
        <Select size="sm" aria-label="Vendedor" value={filters.seller} onChange={(e) => setLocal({ vendedor: e.target.value })} className="md:w-44">
          <option value="">Todos os vendedores</option>
          {sellers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select size="sm" aria-label="Temperatura" value={filters.temperature} onChange={(e) => setLocal({ temp: e.target.value })} className="md:w-36">
          <option value="">Temperatura</option>
          <option value="quente">Quente</option>
          <option value="morno">Morno</option>
          <option value="frio">Frio</option>
        </Select>
        <Select size="sm" aria-label="Produto" value={filters.product} onChange={(e) => setLocal({ produto: e.target.value })} className="md:w-44">
          <option value="">Todos os produtos</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        {variant === "tabela" ? (
          <>
            <Select size="sm" aria-label="Situação" value={filters.situation} onChange={(e) => setLocal({ situacao: e.target.value === "abertas" ? null : e.target.value })} className="md:w-36">
              <option value="abertas">Abertas</option>
              <option value="ganhas">Ganhas</option>
              <option value="perdidas">Perdidas</option>
              <option value="todas">Todas</option>
            </Select>
            <Select size="sm" aria-label="Etapa" value={filters.stage} onChange={(e) => setLocal({ etapa: e.target.value })} className="md:w-40">
              <option value="">Todas as etapas</option>
              {stages.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
            <Select size="sm" aria-label="Atalho" value={filters.quick} onChange={(e) => setLocal({ filtro: e.target.value })} className="md:w-48">
              <option value="">Sem atalho</option>
              <option value="atrasadas">Follow-up atrasado</option>
              <option value="sem_proxima">Sem próxima ação</option>
              <option value="paradas">Paradas</option>
              <option value="ganhas_mes">Ganhas no mês</option>
            </Select>
            <Select size="sm" aria-label="Ordenar por" value={filters.sort} onChange={(e) => setLocal({ ordenar: e.target.value === "atividade" ? null : e.target.value })} className="md:w-48">
              <option value="atividade">Última atividade</option>
              <option value="valor">Maior valor</option>
              <option value="proxima_acao">Próxima ação</option>
              <option value="etapa">Etapa</option>
              <option value="cliente">Cliente (A–Z)</option>
            </Select>
          </>
        ) : null}
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          aria-label="Mensalidade mínima (R$)"
          placeholder="Mensal mín. (R$)"
          value={minDraft}
          onChange={(e) => setMinDraft(e.target.value)}
          onBlur={() => setLocal({ min: minDraft && Number(minDraft) > 0 ? String(Number(minDraft)) : null })}
          onKeyDown={(e) => e.key === "Enter" && setLocal({ min: minDraft && Number(minDraft) > 0 ? String(Number(minDraft)) : null })}
          className="h-8 text-[13px] md:w-36"
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <Switch size="sm" checked={filters.mine} onCheckedChange={(v) => setLocal({ minhas: v ? "1" : null })} label="Só minhas" />
        <Switch size="sm" checked={filters.overdue} onCheckedChange={(v) => setLocal({ atrasadas: v ? "1" : null })} label="Só atrasadas" />
        <span className="ml-auto text-xs text-muted tabular-nums">
          {count} de {total}
        </span>
        {active ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            <FilterX /> Limpar
          </Button>
        ) : null}
      </div>
    </div>
  );
}
