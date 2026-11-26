"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, CircleAlert, Clock3, Info, Lock, MoreHorizontal, Puzzle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeSearch } from "@/domain/erp/catalog";
import { isOnState, type ErpDraftChange } from "@/domain/erp/license";
import type { ErpLicenseItemState } from "@/domain/erp/types";
import type { ErpCompanyView, ErpItemRow, ErpModuleRow } from "@/server/erp/company-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ROLE_LABELS, TONE_BADGE, fmtDate } from "./erp-format";

export type ErpRowFilter =
  | "todos"
  | "contratados"
  | "ativos"
  | "desativados"
  | "disponiveis"
  | "configuracao"
  | "agendados"
  | "processando"
  | "falhas"
  | "indisponiveis"
  | "plataforma"
  | "preparados";

const FILTER_OPTIONS: { value: ErpRowFilter; label: string }[] = [
  { value: "todos", label: "Todos os itens" },
  { value: "contratados", label: "Contratados" },
  { value: "ativos", label: "Ativos no ERP" },
  { value: "desativados", label: "Desativados" },
  { value: "disponiveis", label: "Disponíveis para contratar" },
  { value: "configuracao", label: "Aguardando configuração" },
  { value: "agendados", label: "Alteração agendada" },
  { value: "processando", label: "Processando ou aguardando aprovação" },
  { value: "falhas", label: "Falha ou divergência" },
  { value: "indisponiveis", label: "Indisponíveis no ERP" },
  { value: "plataforma", label: "Obrigatórios da plataforma" },
  { value: "preparados", label: "Alterações preparadas" },
];

export type DateActionKind = "trial" | "activation_scheduled" | "suspension_scheduled";

export interface ErpModuleTreeProps {
  view: ErpCompanyView;
  canChange: boolean;
  /** Edição travada (há alteração aberta ou o ERP não respondeu). */
  locked: boolean;
  lockedReason: string | null;
  draft: ReadonlyMap<string, ErpDraftChange>;
  onDraft: (code: string, change: ErpDraftChange | null) => void;
  onRequestDate: (code: string, kind: DateActionKind) => void;
  onOpenItem: (code: string) => void;
}

/** Estado contratado vigente de uma unidade (último retrato confirmado, ou o que a empresa usa hoje). */
function useContracted(view: ErpCompanyView) {
  return React.useMemo(() => new Map(view.license.items.map((i) => [i.code, i])), [view.license.items]);
}

export function ErpModuleTree({ view, canChange, locked, lockedReason, draft, onDraft, onRequestDate, onOpenItem }: ErpModuleTreeProps) {
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<ErpRowFilter>("todos");
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const contracted = useContracted(view);
  const itemsByModule = React.useMemo(() => {
    const map = new Map<string, ErpItemRow[]>();
    for (const item of view.items) {
      const list = map.get(item.module) ?? [];
      list.push(item);
      map.set(item.module, list);
    }
    return map;
  }, [view.items]);
  const byCode = React.useMemo(() => new Map(view.items.map((i) => [i.code, i])), [view.items]);
  const query = normalizeSearch(search);

  const desiredState = React.useCallback((code: string): ErpLicenseItemState | null => draft.get(code)?.state ?? contracted.get(code)?.state ?? null, [draft, contracted]);

  const matchesFilter = React.useCallback(
    (row: ErpItemRow): boolean => {
      const s = row.status;
      switch (filter) {
        case "todos":
          return true;
        case "contratados":
          return row.role === "unit" && isOnState(contracted.get(row.code)?.state ?? null);
        case "ativos":
          return s?.operational.state === "ativo" || s?.operational.state === "em_encerramento";
        case "desativados":
          return row.role === "unit" && (s?.primary === "desativado" || s?.primary === "suspenso" || s?.primary === "somente_leitura");
        case "disponiveis":
          return row.role === "unit" && row.sellable && !isOnState(contracted.get(row.code)?.state ?? null);
        case "configuracao":
          return s?.primary === "aguardando_configuracao";
        case "agendados":
          return s?.primary === "agendado" || s?.primary === "em_encerramento";
        case "processando":
          return s?.primary === "processando" || s?.primary === "aguardando_aprovacao";
        case "falhas":
          return s?.primary === "falha" || s?.primary === "divergente";
        case "indisponiveis":
          return (row.role === "unit" && !row.sellable) || row.role === "future" || row.role === "integration";
        case "plataforma":
          return row.role === "core";
        case "preparados":
          return draft.has(row.code);
      }
    },
    [filter, contracted, draft],
  );

  const visibleRows = React.useCallback(
    (module: ErpModuleRow): ErpItemRow[] => {
      const rows = itemsByModule.get(module.code) ?? [];
      return rows.filter((r) => matchesFilter(r) && (!query || normalizeSearch(`${r.code} ${r.name} ${r.description ?? ""} ${r.notes ?? ""} ${r.v1Key ?? ""}`).includes(query) || normalizeSearch(`${module.code} ${module.name}`).includes(query)));
    },
    [itemsByModule, matchesFilter, query],
  );

  const modules = view.modules.map((m) => ({ module: m, rows: visibleRows(m) })).filter((m) => m.rows.length > 0 || (!query && filter === "todos"));
  const autoOpen = Boolean(query) || filter !== "todos";
  const toggle = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={setSearch} debounceMs={150} placeholder="Buscar por código, nome ou descrição (ex.: 07.03, sangria, boleto)" className="sm:max-w-md sm:flex-1" aria-label="Buscar no catálogo de módulos" />
        <Select value={filter} onChange={(e) => setFilter(e.target.value as ErpRowFilter)} options={FILTER_OPTIONS} aria-label="Filtrar por estado" className="sm:w-64" size="md" />
        <div className="flex gap-1 sm:ml-auto">
          <Button variant="ghost" size="sm" onClick={() => setExpanded(new Set(view.modules.map((m) => m.code)))}>
            Expandir tudo
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(new Set())}>
            Recolher
          </Button>
        </div>
      </div>

      {locked && lockedReason ? (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-muted">
          <Lock className="size-4 shrink-0" aria-hidden />
          {lockedReason}
        </p>
      ) : null}

      {modules.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Nada encontrado com este filtro ou busca.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Módulos do ERP Intercert">
          {modules.map(({ module, rows }) => {
            const open = autoOpen || expanded.has(module.code);
            const s = module.summary;
            const pending = rows.filter((r) => draft.has(r.code)).length;
            return (
              <li key={module.code} className="overflow-hidden rounded-xl border border-border bg-surface">
                <button
                  type="button"
                  onClick={() => toggle(module.code)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover sm:px-4"
                >
                  {open ? <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden /> : <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />}
                  <span className="w-7 shrink-0 font-mono text-xs text-muted">{module.code}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{module.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span>{s.submodules} submódulos</span>
                      {s.units > 0 ? (
                        <span>
                          <strong className="font-semibold text-foreground">{s.active}</strong>/{s.units} ativos · {s.contracted} contratados · {s.available} disponíveis
                        </span>
                      ) : (
                        <span>{module.role === "module" && s.core > 0 ? "plataforma" : "sem unidade contratável"}</span>
                      )}
                    </span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                    {s.partial ? (
                      <Badge variant="info" size="sm" title="Parte das unidades vendáveis está ligada (ativação parcial do contrato)">
                        Ativação parcial
                      </Badge>
                    ) : null}
                    {s.attention > 0 ? (
                      <Badge variant="warning" size="sm">
                        <CircleAlert aria-hidden />
                        {s.attention}
                      </Badge>
                    ) : null}
                    {pending > 0 ? (
                      <Badge variant="brand" size="sm">
                        {pending} preparada{pending > 1 ? "s" : ""}
                      </Badge>
                    ) : null}
                    {module.devStatus !== "OP" ? (
                      <Badge variant="muted" size="sm" title="Situação técnica do módulo no ERP (não é a contratação)">
                        ERP: {module.devStatusLabel.toLowerCase()}
                      </Badge>
                    ) : null}
                  </span>
                </button>
                {open ? (
                  <ul className="divide-y divide-border border-t border-border">
                    {rows.map((row) => (
                      <ErpRow
                        key={row.code}
                        row={row}
                        owner={row.owner ? (byCode.get(row.owner) ?? null) : null}
                        desired={desiredState(row.code)}
                        drafted={draft.get(row.code) ?? null}
                        canChange={canChange && !locked}
                        onDraft={onDraft}
                        contractedState={contracted.get(row.code)?.state ?? null}
                        onRequestDate={onRequestDate}
                        onOpenItem={onOpenItem}
                      />
                    ))}
                    {rows.length === 0 ? <li className="px-4 py-3 text-sm text-muted">Nenhum item deste módulo com o filtro atual.</li> : null}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface RowProps {
  row: ErpItemRow;
  owner: ErpItemRow | null;
  desired: ErpLicenseItemState | null;
  contractedState: ErpLicenseItemState | null;
  drafted: ErpDraftChange | null;
  canChange: boolean;
  onDraft: (code: string, change: ErpDraftChange | null) => void;
  onRequestDate: (code: string, kind: DateActionKind) => void;
  onOpenItem: (code: string) => void;
}

const DRAFT_LABELS: Partial<Record<ErpLicenseItemState, string>> = {
  active: "Ativar",
  inactive: "Desligar",
  trial: "Teste",
  activation_scheduled: "Ativação agendada",
  suspension_scheduled: "Desligamento agendado",
  suspended: "Suspender",
  read_only: "Somente leitura",
};

function ErpRow({ row, owner, desired, contractedState, drafted, canChange, onDraft, onRequestDate, onOpenItem }: RowProps) {
  const isUnit = row.role === "unit";
  const status = row.status;
  const on = isOnState(desired);
  const wasOn = isOnState(contractedState);
  const canToggle = isUnit && canChange && (row.sellable || wasOn);
  const setOn = (checked: boolean) => {
    const target: ErpLicenseItemState = checked ? "active" : "inactive";
    // Voltar ao que já está contratado desfaz a alteração (religar um teste não o efetiva: isso é ação do menu).
    if ((checked && wasOn) || (!checked && !wasOn)) onDraft(row.code, null);
    else onDraft(row.code, { code: row.code, state: target });
  };
  const ownerStatus = owner?.status ?? null;

  return (
    <li className={cn("flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3 sm:px-4", drafted && "bg-brand-soft/40", !isUnit && "text-muted")}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 w-12 shrink-0 font-mono text-xs text-muted">{row.code}</span>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => onOpenItem(row.code)} className={cn("text-left text-sm font-medium hover:underline", isUnit ? "text-foreground" : "text-muted")}>
            {row.name}
          </button>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {row.role === "included" && owner ? (
              <span>
                Incluído em <span className="font-mono">{owner.code}</span> {owner.name}
              </span>
            ) : row.role !== "unit" ? (
              <span>{ROLE_LABELS[row.role]}</span>
            ) : null}
            {row.notes ? <span className="hidden truncate sm:inline">{row.notes}</span> : null}
            {status?.configuration && !status.configuration.ready ? <span className="text-warning-fg">Falta: {status.configuration.missing.join("; ")}</span> : null}
            {status?.operational.until ? <span>até {fmtDate(status.operational.until)}</span> : null}
            {status?.notice ? <span className="text-warning-fg">{status.notice}</span> : null}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-15 sm:pl-0">
        {drafted ? (
          <Badge variant="brand" size="sm">
            {DRAFT_LABELS[drafted.state] ?? "Alterado"}
            {drafted.until ? ` até ${fmtDate(drafted.until)}` : drafted.effectiveAt ? ` em ${fmtDate(drafted.effectiveAt)}` : ""}
          </Badge>
        ) : null}
        <RowBadge row={row} ownerStatus={ownerStatus} />
        {isUnit ? (
          <>
            <Switch
              checked={on}
              onCheckedChange={setOn}
              disabled={!canToggle}
              size="sm"
              aria-label={`${on ? "Desligar" : "Ativar"} ${row.code} ${row.name}`}
              title={!row.sellable && !wasOn ? "Ainda não pode ser contratado (o ERP marca como indisponível)" : undefined}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label={`Mais ações para ${row.code}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem onSelect={() => onOpenItem(row.code)}>
                  <Info /> Detalhes e dependências
                </DropdownMenuItem>
                {canChange ? (
                  <>
                    <DropdownMenuSeparator />
                    {row.sellable && !wasOn ? (
                      <>
                        <DropdownMenuItem onSelect={() => onRequestDate(row.code, "trial")}>
                          <Sparkles /> Liberar teste até…
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onRequestDate(row.code, "activation_scheduled")}>
                          <Clock3 /> Agendar ativação…
                        </DropdownMenuItem>
                      </>
                    ) : null}
                    {contractedState === "trial" ? (
                      <DropdownMenuItem onSelect={() => onDraft(row.code, { code: row.code, state: "active" })}>
                        <Sparkles /> Efetivar contratação (sai do teste)
                      </DropdownMenuItem>
                    ) : null}
                    {contractedState === "suspension_scheduled" ? (
                      <DropdownMenuItem onSelect={() => onDraft(row.code, { code: row.code, state: "active" })}>
                        <Clock3 /> Cancelar desligamento agendado
                      </DropdownMenuItem>
                    ) : null}
                    {contractedState === "activation_scheduled" ? (
                      <DropdownMenuItem onSelect={() => onDraft(row.code, { code: row.code, state: "inactive" })}>
                        <Clock3 /> Cancelar ativação agendada
                      </DropdownMenuItem>
                    ) : null}
                    {wasOn ? (
                      <>
                        <DropdownMenuItem onSelect={() => onRequestDate(row.code, "suspension_scheduled")}>
                          <Clock3 /> Agendar desligamento…
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onDraft(row.code, { code: row.code, state: "suspended" })}>
                          <Lock /> Suspender (reversível)
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onDraft(row.code, { code: row.code, state: "read_only" })}>
                          <Puzzle /> Somente leitura
                        </DropdownMenuItem>
                      </>
                    ) : null}
                    {drafted ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onDraft(row.code, null)}>Desfazer esta alteração</DropdownMenuItem>
                      </>
                    ) : null}
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
      </div>
    </li>
  );
}

function RowBadge({ row, ownerStatus }: { row: ErpItemRow; ownerStatus: ErpItemRow["status"] }) {
  if (row.role === "unit" && row.status) {
    return (
      <Badge variant={TONE_BADGE[row.status.tone]} size="sm" title={`${row.status.commercial.label} · ${row.status.operational.label} · ${row.status.sync.label}`}>
        {row.status.label}
      </Badge>
    );
  }
  if (row.role === "core") {
    return (
      <Badge variant="default" size="sm" title="Obrigatório da plataforma: sempre ativo, não pode ser desligado">
        <Lock aria-hidden /> Plataforma
      </Badge>
    );
  }
  if (row.role === "included") {
    if (!ownerStatus) return <Badge variant="muted" size="sm">Incluído</Badge>;
    const on = ownerStatus.operational.state === "ativo" || ownerStatus.operational.state === "em_encerramento";
    return (
      <Badge variant={on ? "success" : "muted"} size="sm" title={`Acompanha ${row.owner}: ${ownerStatus.label}`}>
        {on ? "Ativo" : "Inativo"} via {row.owner}
      </Badge>
    );
  }
  if (row.role === "future") return <Badge variant="muted" size="sm">Futuro · {row.devStatusLabel.toLowerCase()}</Badge>;
  return (
    <Badge variant="muted" size="sm">
      {ROLE_LABELS[row.role]}
    </Badge>
  );
}
