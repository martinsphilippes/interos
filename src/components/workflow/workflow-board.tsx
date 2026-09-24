"use client";

import * as React from "react";
import Link from "next/link";
import { Info, Kanban, List, X } from "lucide-react";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS, WORKFLOW_STEP_STATUS, WORKFLOW_STEP_STATUS_LABELS, type DepartmentKey, type WorkflowStepStatus } from "@/domain/constants";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { StepCard } from "./step-card";
import { AssigneeLabel, ChecklistIndicator, DaysInStage, DepartmentBadge, SlaCountdown, StepStatusBadge } from "./step-bits";
import { useWorkflowUrl } from "./use-workflow-url";
import { FILTER_PARAM, applyWorkflowFilters, clientHref, filtersFromParams, hasActiveFilters, parseWorkflowView, type AssignableUserOption, type WorkflowBoardData, type WorkflowFilters, type WorkflowView } from "./workflow-model";

export interface WorkflowBoardProps {
  board: WorkflowBoardData;
  users: AssignableUserOption[];
  currentUserId: string;
}

/**
 * Kanban (uma coluna por etapa) ou lista das jornadas ativas. Filtros e view vivem na URL
 * (client-side sobre os dados já carregados). Sem arrastar entre colunas: a passagem só acontece pelo gate.
 */
export function WorkflowBoard({ board, users, currentUserId }: WorkflowBoardProps) {
  const { searchParams, setLocal, navigate } = useWorkflowUrl();
  const view = parseWorkflowView(searchParams.get("view"));
  const filters = React.useMemo(() => filtersFromParams((k) => searchParams.get(k)), [searchParams]);
  const filtered = React.useMemo(() => applyWorkflowFilters(board.items, filters, currentUserId), [board.items, filters, currentUserId]);
  const openStep = (stepId: string) => navigate({ etapa: stepId });
  const setFilter = (patch: Partial<Record<keyof WorkflowFilters, string | boolean | undefined>>) => {
    const urlPatch: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(patch)) {
      const param = FILTER_PARAM[key as keyof WorkflowFilters];
      if (key === "mine") urlPatch[param] = value ? "1" : null;
      else if (key === "slaRisk") urlPatch[param] = value ? "risco" : null;
      else urlPatch[param] = value ? String(value) : null;
    }
    setLocal(urlPatch);
  };
  const clearFilters = () => setLocal({ [FILTER_PARAM.departmentId]: null, [FILTER_PARAM.assigneeId]: null, [FILTER_PARAM.mine]: null, [FILTER_PARAM.slaRisk]: null, [FILTER_PARAM.status]: null, [FILTER_PARAM.stageKey]: null, [FILTER_PARAM.q]: null });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 shadow-card md:flex-row md:flex-wrap md:items-center">
        <SearchInput value={filters.q ?? ""} onChange={(q) => setFilter({ q })} placeholder="Buscar cliente ou responsável…" size="sm" className="md:max-w-xs" aria-label="Buscar" />
        <Select size="sm" aria-label="Departamento" value={filters.departmentId ?? ""} onChange={(e) => setFilter({ departmentId: (e.target.value || undefined) as DepartmentKey | undefined })} className="md:max-w-[190px]">
          <option value="">Todos os departamentos</option>
          {DEPARTMENT_KEYS.map((d) => (
            <option key={d} value={d}>
              {DEPARTMENT_LABELS[d]}
            </option>
          ))}
        </Select>
        <Select size="sm" aria-label="Responsável" value={filters.assigneeId ?? ""} onChange={(e) => setFilter({ assigneeId: e.target.value || undefined })} className="md:max-w-[200px]">
          <option value="">Todos os responsáveis</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Select size="sm" aria-label="Status da etapa" value={filters.status ?? ""} onChange={(e) => setFilter({ status: (e.target.value || undefined) as WorkflowStepStatus | undefined })} className="md:max-w-[190px]">
          <option value="">Todos os status</option>
          {WORKFLOW_STEP_STATUS.filter((s) => s === "em_andamento" || s === "aguardando_cliente" || s === "aguardando_aprovacao").map((s) => (
            <option key={s} value={s}>
              {WORKFLOW_STEP_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Checkbox checked={Boolean(filters.mine)} onCheckedChange={(v) => setFilter({ mine: v === true })} label="Só meus" className="md:min-h-8" />
          <Checkbox checked={Boolean(filters.slaRisk)} onCheckedChange={(v) => setFilter({ slaRisk: v === true })} label="SLA em risco" className="md:min-h-8" />
        </div>
        <div className="flex items-center gap-2 md:ml-auto">
          {hasActiveFilters(filters) ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X /> Limpar
            </Button>
          ) : null}
          <SegmentedControl<WorkflowView>
            size="sm"
            aria-label="Visualização"
            value={view}
            onChange={(v) => setLocal({ view: v === "kanban" ? null : v })}
            options={[
              { value: "kanban", label: "Kanban", icon: <Kanban /> },
              { value: "lista", label: "Lista", icon: <List /> },
            ]}
          />
        </div>
      </div>

      <p className="flex items-start gap-2 text-xs text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Não há arrastar-e-soltar entre colunas: a jornada só avança pelo <strong className="font-medium text-foreground">gate</strong> de cada etapa (campos obrigatórios, checklist e aprovação). Abra a etapa para concluí-la.
          {filtered.length !== board.items.length ? ` Mostrando ${filtered.length} de ${board.items.length} jornadas.` : ` ${board.items.length} jornada${board.items.length === 1 ? "" : "s"} ativa${board.items.length === 1 ? "" : "s"}.`}
        </span>
      </p>

      {board.items.length === 0 ? (
        <EmptyState title="Nenhuma jornada ativa" description="Quando um cliente for cadastrado, sua jornada aparece aqui na etapa inicial." />
      ) : filtered.length === 0 ? (
        <EmptyState
          size="sm"
          title="Nenhuma etapa com esses filtros"
          description="Limpe os filtros para ver todas as jornadas ativas."
          action={
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Limpar filtros
            </Button>
          }
        />
      ) : view === "kanban" ? (
        <KanbanView board={board} filteredIds={new Set(filtered.map((i) => i.id))} currentUserId={currentUserId} onOpen={openStep} />
      ) : (
        <ListView items={filtered} currentUserId={currentUserId} onOpen={openStep} />
      )}
    </div>
  );
}

function KanbanView({ board, filteredIds, currentUserId, onOpen }: { board: WorkflowBoardData; filteredIds: Set<string>; currentUserId: string; onOpen: (id: string) => void }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 scrollbar-thin md:-mx-6 md:px-6 lg:-mx-8 lg:px-8">
      <ol className="flex min-w-max items-start gap-3" aria-label="Etapas da jornada">
        {board.columns.map((column) => {
          const items = column.items.filter((i) => filteredIds.has(i.id));
          const risky = items.filter((i) => i.sla?.state === "em_risco" || i.sla?.state === "violado").length;
          return (
            <li key={column.key} className="flex w-[272px] shrink-0 flex-col rounded-lg bg-surface-hover/70 md:w-[288px]">
              <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-foreground">{column.name}</h3>
                  <p className="truncate text-[11px] text-muted">{DEPARTMENT_LABELS[column.department]}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {risky > 0 ? <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-semibold tabular-nums text-danger-fg" title="SLA em risco ou violado">{risky}</span> : null}
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted">{items.length}</span>
                </div>
              </header>
              <div className="flex max-h-[calc(100dvh-380px)] min-h-[120px] flex-col gap-2 overflow-y-auto px-2 pb-2 scrollbar-thin">
                {items.length === 0 ? <p className="px-2 py-6 text-center text-xs text-muted-light">Nenhuma jornada nesta etapa</p> : items.map((item) => <StepCard key={item.id} item={item} currentUserId={currentUserId} onOpen={onOpen} />)}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ListView({ items, currentUserId, onOpen }: { items: WorkflowBoardData["items"]; currentUserId: string; onOpen: (id: string) => void }) {
  return (
    <>
      {/* Mobile: cards */}
      <ul className="flex flex-col gap-2 md:hidden">
        {items.map((item) => (
          <li key={item.id}>
            <StepCard item={item} currentUserId={currentUserId} onOpen={onOpen} />
          </li>
        ))}
      </ul>
      {/* Desktop: tabela */}
      <div className="hidden rounded-lg border border-border bg-surface shadow-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Etapa</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>SLA</TableHead>
              <TableHead>Na etapa</TableHead>
              <TableHead>Checklist</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} clickable onClick={() => onOpen(item.id)} className={cn(item.assigneeId === currentUserId && "bg-brand-soft/20")}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{item.clientName}</span>
                    <Link href={clientHref(item.clientId)} onClick={(e) => e.stopPropagation()} className="text-xs text-secondary hover:underline">
                      Abrir cliente
                    </Link>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <span>{item.stageName}</span>
                    <DepartmentBadge department={item.department} />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {item.assigneeName ? <Avatar name={item.assigneeName} src={item.assigneeAvatarUrl} size="xs" /> : null}
                    <AssigneeLabel name={item.assigneeName} />
                  </div>
                </TableCell>
                <TableCell>
                  <StepStatusBadge status={item.status} />
                </TableCell>
                <TableCell>{item.sla ? <SlaCountdown state={item.sla.state} dueAt={item.dueAt} remainingMs={item.sla.remainingMs} /> : <span className="text-xs text-muted-light">Sem SLA</span>}</TableCell>
                <TableCell>
                  <DaysInStage days={item.daysInStage} />
                </TableCell>
                <TableCell>
                  <ChecklistIndicator done={item.checklistDone} total={item.checklistTotal} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
