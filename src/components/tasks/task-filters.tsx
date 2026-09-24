"use client";

import * as React from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS, PRIORITIES, PRIORITY_LABELS } from "@/domain/constants";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ClientCombobox } from "./client-combobox";
import {
  DUE_FILTER_OPTIONS,
  FILTER_PARAM,
  SORT_OPTIONS,
  STATUS_FILTER_OPTIONS,
  hasActiveFilters,
  type AssignableUser,
  type ClientOption,
  type StatusFilter,
  type TaskFilters as Filters,
  type TaskSort,
  type TaskView,
} from "./task-model";
import { useTaskUrl } from "./use-task-url";

export interface TaskFiltersProps {
  view: TaskView;
  filters: Filters;
  users: AssignableUser[];
  clients: ClientOption[];
  /** Quantidade após os filtros. */
  count: number;
  total: number;
  defaultStatus: StatusFilter;
  defaultSort: TaskSort;
}

/** Barra de filtros client-side; cada mudança vai para a URL sem recarregar dados do servidor. */
export function TaskFilters({ view, filters, users, clients, count, total, defaultStatus, defaultSort }: TaskFiltersProps) {
  const { setLocal } = useTaskUrl();
  const [expanded, setExpanded] = React.useState(false);
  const active = hasActiveFilters(filters);
  const set = (key: keyof typeof FILTER_PARAM, value: string | undefined) => setLocal({ [FILTER_PARAM[key]]: value || null });
  const clearAll = () => setLocal(Object.fromEntries(Object.values(FILTER_PARAM).map((p) => [p, null])));

  const showSort = view !== "kanban" && view !== "calendario";

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <SearchInput value={filters.q ?? ""} onChange={(v) => set("q", v)} debounceMs={200} placeholder="Buscar por título ou cliente…" className="flex-1" aria-label="Buscar tarefas" />
        <Button variant={expanded || active ? "secondary" : "outline"} size="icon" className="size-9 shrink-0 md:hidden" aria-label="Mostrar filtros" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
          <SlidersHorizontal />
        </Button>
      </div>

      <div className={cn("grid gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6", !expanded && "hidden md:grid")}>
        <Select size="sm" aria-label="Responsável" value={filters.assigneeId ?? ""} onChange={(e) => set("assigneeId", e.target.value)} placeholder="Responsável: todos">
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Select size="sm" aria-label="Departamento" value={filters.departmentId ?? ""} onChange={(e) => set("departmentId", e.target.value)} placeholder="Departamento: todos">
          {DEPARTMENT_KEYS.map((d) => (
            <option key={d} value={d}>
              {DEPARTMENT_LABELS[d]}
            </option>
          ))}
        </Select>
        <Select size="sm" aria-label="Prioridade" value={filters.priority ?? ""} onChange={(e) => set("priority", e.target.value)} placeholder="Prioridade: todas">
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </Select>
        <Select size="sm" aria-label="Status" value={filters.status ?? defaultStatus} onChange={(e) => set("status", e.target.value === defaultStatus ? undefined : e.target.value)}>
          {STATUS_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              Status: {o.label}
            </option>
          ))}
        </Select>
        <Select size="sm" aria-label="Prazo" value={filters.due ?? ""} onChange={(e) => set("due", e.target.value)} placeholder="Prazo: qualquer">
          {DUE_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <ClientCombobox size="sm" clients={clients} value={filters.clientId} onChange={(id) => set("clientId", id)} placeholder="Cliente: todos" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {view !== "minha" ? (
            <Checkbox label="Só minhas" checked={Boolean(filters.mine)} onCheckedChange={(v) => set("mine", v === true ? "1" : undefined)} />
          ) : null}
          <span className="text-xs text-muted tabular-nums" aria-live="polite">
            {count === total ? `${total} ${total === 1 ? "tarefa" : "tarefas"}` : `${count} de ${total} tarefas`}
          </span>
          {active ? (
            <Button variant="ghost" size="sm" onClick={clearAll} className="h-7 px-2 text-xs text-muted">
              <X /> Limpar filtros
            </Button>
          ) : null}
        </div>
        {showSort ? (
          <label className="flex items-center gap-2 text-xs text-muted">
            Ordenar por
            <Select size="sm" aria-label="Ordenação" className="w-auto" value={filters.sort ?? defaultSort} onChange={(e) => set("sort", e.target.value === defaultSort ? undefined : e.target.value)}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </div>
    </div>
  );
}
