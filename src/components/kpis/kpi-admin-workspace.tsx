"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, Plus, Sigma } from "lucide-react";
import type { KpiAdminRow } from "@/server/kpis/queries";
import type { KpiFormulaMeta } from "@/server/kpis/formulas";
import { recordKpiSnapshots, toggleKpi, upsertKpi } from "@/server/kpis/actions";
import { DIRECTION_LABELS, KPI_DEPARTMENTS, KPI_DIRECTIONS, KPI_UNITS, UNIT_LABELS, departmentLabel, formatKpiValue, type KpiInput, type KpiUnit } from "@/server/kpis/schemas";
import type { KpiDirection } from "@/domain/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { KpiStatusBadge } from "./kpi-status-badge";

export interface KpiAdminWorkspaceProps {
  rows: KpiAdminRow[];
  formulas: KpiFormulaMeta[];
  owners: { id: string; name: string }[];
  periodLabel: string;
  /** Competências oferecidas para gravar snapshots (mais recente primeiro). */
  snapshotMonths: { value: string; label: string }[];
}

type DrawerState = { mode: "new"; formula?: KpiFormulaMeta } | { mode: "edit"; row: KpiAdminRow } | null;

/** Converte texto digitado (aceita vírgula decimal) em número; vazio = undefined. */
function parseNumber(text: string): number | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const normalized = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : Number.NaN;
}

function toInput(value: number | undefined, unit: KpiUnit): string {
  if (value === undefined || value === null) return "";
  const v = unit === "percentual" ? Math.round(value * 100 * 1000) / 1000 : value;
  return String(v).replace(".", ",");
}

function targetText(row: KpiAdminRow): string {
  const d = row.definition;
  const suffix = d.formulaMeta?.suffix;
  if (d.direction === "faixa" && d.targetMin !== undefined && d.targetMax !== undefined) return `${formatKpiValue(d.targetMin, d.unit, suffix)} a ${formatKpiValue(d.targetMax, d.unit, suffix)}`;
  return d.target !== undefined ? formatKpiValue(d.target, d.unit, suffix) : "—";
}

export function KpiAdminWorkspace({ rows, formulas, owners, periodLabel, snapshotMonths }: KpiAdminWorkspaceProps) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [department, setDepartment] = React.useState("");
  const [drawer, setDrawer] = React.useState<DrawerState>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();
  const [snapshotOpen, setSnapshotOpen] = React.useState(false);
  const [snapshotMonth, setSnapshotMonth] = React.useState(snapshotMonths[0]?.value ?? "");

  const formulaByKey = React.useMemo(() => new Map(formulas.map((f) => [f.key, f])), [formulas]);
  const registeredFormulas = new Set(rows.map((r) => r.definition.formula));
  const unregistered = formulas.filter((f) => !registeredFormulas.has(f.key) && !rows.some((r) => r.definition.key === f.key));

  const filtered = rows.filter((r) => {
    const d = r.definition;
    if (department && d.department !== department) return false;
    if (!query.trim()) return true;
    const term = query.trim().toLowerCase();
    return [d.name, d.key, d.formula, departmentLabel(d.department)].some((t) => t.toLowerCase().includes(term));
  });

  const onToggle = (row: KpiAdminRow, active: boolean) => {
    setPendingId(row.definition.id);
    startTransition(async () => {
      const result = await toggleKpi({ id: row.definition.id, active });
      setPendingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(active ? "Indicador ativado" : "Indicador desativado");
      router.refresh();
    });
  };

  const onSnapshot = async () => {
    const result = await recordKpiSnapshots({ period: snapshotMonth });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${result.data.written} snapshot(s) gravado(s)${result.data.skipped ? ` · ${result.data.skipped} indisponível(is)` : ""}`);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <SearchInput value={query} onChange={setQuery} placeholder="Buscar por nome, chave ou fórmula" aria-label="Buscar indicadores" className="sm:max-w-xs" />
          <Select value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Filtrar por departamento" className="sm:max-w-[220px]">
            <option value="">Todos os departamentos</option>
            {KPI_DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {departmentLabel(d)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="min-h-[44px] md:min-h-0" onClick={() => setSnapshotOpen(true)}>
            <Camera /> Gravar snapshots
          </Button>
          <Button className="min-h-[44px] md:min-h-0" onClick={() => setDrawer({ mode: "new" })}>
            <Plus /> Novo indicador
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState title="Nenhum indicador encontrado" description={rows.length === 0 ? "Cadastre o primeiro indicador a partir do registro de fórmulas." : "Ajuste a busca ou o filtro de departamento."} />
        </div>
      ) : (
        <>
          {/* Celular: cartões */}
          <ul className="flex flex-col gap-2 md:hidden">
            {filtered.map((row) => {
              const d = row.definition;
              return (
                <li key={d.id} className="rounded-lg border border-border bg-surface p-3 shadow-card">
                  <button type="button" className="flex w-full flex-col items-start gap-1 text-left" onClick={() => setDrawer({ mode: "edit", row })}>
                    <span className="flex w-full items-start justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">{d.name}</span>
                      <KpiStatusBadge status={row.current?.status ?? null} />
                    </span>
                    <span className="font-mono text-xs text-muted">{d.key}</span>
                    <span className="text-xs text-muted">
                      {departmentLabel(d.department)} · meta {targetText(row)} · atual {formatKpiValue(row.current?.value ?? null, d.unit, d.formulaMeta?.suffix)}
                    </span>
                  </button>
                  <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                    {row.current ? (
                      <Link href={row.current.href} className="inline-flex min-h-[44px] items-center text-sm text-brand">
                        Ver drill-down
                      </Link>
                    ) : (
                      <span />
                    )}
                    <Switch size="sm" checked={d.active !== false} disabled={pendingId === d.id} onCheckedChange={(v) => onToggle(row, v)} aria-label={d.active !== false ? "Desativar indicador" : "Ativar indicador"} />
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Desktop: tabela */}
          <div className="hidden rounded-lg border border-border bg-surface shadow-card md:block">
            <Table className="min-w-[1100px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Indicador</TableHead>
                  <TableHead>Departamento</TableHead>
                  <TableHead>Fórmula</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Sentido</TableHead>
                  <TableHead className="text-right">Meta / faixa</TableHead>
                  <TableHead className="text-right">Atenção</TableHead>
                  <TableHead className="text-right">Peso</TableHead>
                  <TableHead className="text-right">Valor atual ({periodLabel.toLowerCase()})</TableHead>
                  <TableHead className="text-center">Ativo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => {
                  const d = row.definition;
                  const formula = formulaByKey.get(d.formula);
                  return (
                    <TableRow key={d.id} clickable onClick={() => setDrawer({ mode: "edit", row })} className={d.active === false ? "opacity-60" : undefined}>
                      <TableCell>
                        <p className="font-medium text-foreground">{d.name}</p>
                        <p className="font-mono text-xs text-muted">{d.key}</p>
                      </TableCell>
                      <TableCell className="text-muted">{departmentLabel(d.department)}</TableCell>
                      <TableCell>
                        {formula ? (
                          <span className="font-mono text-xs text-foreground" title={formula.description}>
                            {d.formula}
                          </span>
                        ) : (
                          <Badge variant="danger" size="sm">
                            {d.formula} (inexistente)
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted">{UNIT_LABELS[d.unit]}</TableCell>
                      <TableCell className="text-muted">{DIRECTION_LABELS[d.direction]}</TableCell>
                      <TableCell className="text-right tabular-nums">{targetText(row)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted">{d.attentionPct}%</TableCell>
                      <TableCell className="text-right tabular-nums text-muted">{d.weight}</TableCell>
                      <TableCell className="text-right">
                        {row.current ? (
                          <Link href={row.current.href} onClick={(e) => e.stopPropagation()} className="inline-flex items-center justify-end gap-2 font-medium tabular-nums text-foreground hover:text-brand">
                            {formatKpiValue(row.current.value, d.unit, d.formulaMeta?.suffix)}
                            <KpiStatusBadge status={row.current.status} />
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <Switch size="sm" checked={d.active !== false} disabled={pendingId === d.id} onCheckedChange={(v) => onToggle(row, v)} aria-label={d.active !== false ? "Desativar indicador" : "Ativar indicador"} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {unregistered.length > 0 ? (
        <section className="rounded-lg border border-border bg-surface p-4 shadow-card md:p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Sigma className="size-4 text-muted" aria-hidden /> Fórmulas do registro sem cadastro
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium tabular-nums text-muted">{unregistered.length}</span>
          </h2>
          <p className="mt-1 text-sm text-muted">Já calculadas pelo motor (drill-down e scorecards), mas sem meta, peso e status configurados. Cadastre para acompanhar.</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {unregistered.map((f) => (
              <li key={f.key} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{f.label}</span>
                  <span className="block truncate font-mono text-xs text-muted">
                    {f.key} · {departmentLabel(f.department)}
                  </span>
                </span>
                <Button variant="ghost" size="sm" className="min-h-[44px] shrink-0 md:min-h-0" onClick={() => setDrawer({ mode: "new", formula: f })}>
                  Cadastrar
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Drawer open={drawer !== null} onOpenChange={(open) => !open && setDrawer(null)}>
        <DrawerContent size="lg">
          {drawer ? (
            <KpiForm
              key={drawer.mode === "edit" ? `${drawer.row.definition.id}-${drawer.row.definition.updatedAt}` : `new-${drawer.formula?.key ?? ""}`}
              state={drawer}
              formulas={formulas}
              owners={owners}
              onClose={() => setDrawer(null)}
              onDone={() => {
                setDrawer(null);
                router.refresh();
              }}
            />
          ) : null}
        </DrawerContent>
      </Drawer>

      <ConfirmDialog
        open={snapshotOpen}
        onOpenChange={setSnapshotOpen}
        title="Gravar snapshots de indicadores"
        description="Calcula e grava o valor de cada indicador para a empresa, os departamentos e os colaboradores ativos na competência escolhida. Snapshots da mesma competência são substituídos."
        confirmLabel="Gravar"
        onConfirm={onSnapshot}
      >
        <FormField label="Competência" htmlFor="snapshot-month">
          <Select id="snapshot-month" value={snapshotMonth} onChange={(e) => setSnapshotMonth(e.target.value)} options={snapshotMonths} />
        </FormField>
      </ConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulário (drawer)
// ---------------------------------------------------------------------------

interface FormState {
  key: string;
  name: string;
  department: string;
  description: string;
  formula: string;
  unit: KpiUnit;
  direction: KpiDirection;
  target: string;
  targetMin: string;
  targetMax: string;
  attentionPct: string;
  weight: string;
  ownerId: string;
  active: boolean;
}

function initialState(state: NonNullable<DrawerState>): FormState {
  if (state.mode === "edit") {
    const d = state.row.definition;
    return {
      key: d.key,
      name: d.name,
      department: d.department,
      description: d.description ?? "",
      formula: d.formula,
      unit: d.unit,
      direction: d.direction,
      target: toInput(d.target, d.unit),
      targetMin: toInput(d.targetMin, d.unit),
      targetMax: toInput(d.targetMax, d.unit),
      attentionPct: String(d.attentionPct ?? 85),
      weight: String(d.weight ?? 1),
      ownerId: d.ownerId ?? "",
      active: d.active !== false,
    };
  }
  const f = state.formula;
  return {
    key: f?.key ?? "",
    name: f?.label ?? "",
    department: f?.department ?? "empresa",
    description: "",
    formula: f?.key ?? "",
    unit: f?.unit ?? "numero",
    direction: f?.direction ?? "maior_melhor",
    target: "",
    targetMin: "",
    targetMax: "",
    attentionPct: "85",
    weight: "1",
    ownerId: "",
    active: true,
  };
}

function KpiForm({ state, formulas, owners, onClose, onDone }: { state: NonNullable<DrawerState>; formulas: KpiFormulaMeta[]; owners: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = React.useState<FormState>(() => initialState(state));
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const editing = state.mode === "edit";
  const formula = formulas.find((f) => f.key === form.formula);
  const pct = form.unit === "percentual";
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const onFormula = (key: string) => {
    const f = formulas.find((x) => x.key === key);
    setForm((cur) => ({
      ...cur,
      formula: key,
      // Novo indicador: herda os padrões da fórmula (o admin pode ajustar depois).
      ...(f && !editing ? { unit: f.unit, direction: f.direction, department: f.department, name: cur.name || f.label, key: cur.key || f.key } : {}),
    }));
  };

  const scale = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? v : pct ? v / 100 : v);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const target = scale(parseNumber(form.target));
    const targetMin = scale(parseNumber(form.targetMin));
    const targetMax = scale(parseNumber(form.targetMax));
    const attentionPct = parseNumber(form.attentionPct);
    const weight = parseNumber(form.weight);
    if ([target, targetMin, targetMax, attentionPct, weight].some((v) => Number.isNaN(v))) {
      setError("Há um número inválido no formulário");
      return;
    }
    const input: KpiInput = {
      id: editing ? state.row.definition.id : undefined,
      key: form.key.trim(),
      name: form.name,
      department: form.department as KpiInput["department"],
      description: form.description.trim() || undefined,
      formula: form.formula,
      unit: form.unit,
      direction: form.direction,
      target,
      targetMin: form.direction === "faixa" ? targetMin : undefined,
      targetMax: form.direction === "faixa" ? targetMax : undefined,
      attentionPct: attentionPct ?? 85,
      weight: weight ?? 1,
      ownerId: form.ownerId || undefined,
      active: form.active,
    };
    startTransition(async () => {
      const result = await upsertKpi(input);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Indicador atualizado" : "Indicador criado");
      onDone();
    });
  };

  const unitHint = pct ? "em %" : form.unit === "moeda" ? "em R$" : form.unit === "dias" ? "em dias" : form.unit === "horas" ? "em horas" : undefined;

  return (
    <form onSubmit={onSubmit} className="flex h-full min-h-0 flex-col">
      <DrawerHeader>
        <DrawerTitle>{editing ? "Editar indicador" : "Novo indicador"}</DrawerTitle>
        <DrawerDescription>A fórmula vem do registro do motor; aqui você define nome, meta, faixa, atenção e peso.</DrawerDescription>
      </DrawerHeader>
      <DrawerBody className="flex flex-col gap-4">
        <FormField label="Fórmula" htmlFor="kpi-formula" required hint={formula ? formula.description : "Escolha como o número é calculado"}>
          <Select id="kpi-formula" value={form.formula} onChange={(e) => onFormula(e.target.value)} required placeholder="Selecione">
            {KPI_DEPARTMENTS.map((dep) => {
              const items = formulas.filter((f) => f.department === dep);
              if (items.length === 0) return null;
              return (
                <optgroup key={dep} label={departmentLabel(dep)}>
                  {items.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label} ({f.key})
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </Select>
        </FormField>
        {formula ? <p className="-mt-2 rounded-md bg-surface-muted p-2.5 text-xs text-muted">Atribuição: {formula.attribution}</p> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Nome" htmlFor="kpi-name" required>
            <Input id="kpi-name" value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={100} />
          </FormField>
          <FormField label="Chave" htmlFor="kpi-key" required hint={editing ? "A chave não muda (metas e snapshots dependem dela)" : "minúsculas, números e _"}>
            <Input id="kpi-key" value={form.key} onChange={(e) => set("key", e.target.value.toLowerCase())} required disabled={editing} className="font-mono" maxLength={60} />
          </FormField>
          <FormField label="Departamento" htmlFor="kpi-dep" required>
            <Select id="kpi-dep" value={form.department} onChange={(e) => set("department", e.target.value)}>
              {KPI_DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {departmentLabel(d)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Responsável" htmlFor="kpi-owner">
            <Select id="kpi-owner" value={form.ownerId} onChange={(e) => set("ownerId", e.target.value)}>
              <option value="">Sem responsável</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Unidade" htmlFor="kpi-unit" required>
            <Select id="kpi-unit" value={form.unit} onChange={(e) => set("unit", e.target.value as KpiUnit)}>
              {KPI_UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABELS[u]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Sentido" htmlFor="kpi-direction" required>
            <Select id="kpi-direction" value={form.direction} onChange={(e) => set("direction", e.target.value as KpiDirection)}>
              {KPI_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {DIRECTION_LABELS[d]}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        {form.direction === "faixa" ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Mínimo da faixa" htmlFor="kpi-min" required hint={unitHint}>
              <Input id="kpi-min" inputMode="decimal" value={form.targetMin} onChange={(e) => set("targetMin", e.target.value)} />
            </FormField>
            <FormField label="Máximo da faixa" htmlFor="kpi-max" required hint={unitHint}>
              <Input id="kpi-max" inputMode="decimal" value={form.targetMax} onChange={(e) => set("targetMax", e.target.value)} />
            </FormField>
            <FormField label="Valor de referência" htmlFor="kpi-target" hint="opcional">
              <Input id="kpi-target" inputMode="decimal" value={form.target} onChange={(e) => set("target", e.target.value)} />
            </FormField>
          </div>
        ) : (
          <FormField label="Meta mensal" htmlFor="kpi-target" hint={[unitHint, form.direction === "menor_melhor" ? "o valor deve ficar abaixo" : "o valor deve chegar a", "vazio = sem meta"].filter(Boolean).join(" · ")}>
            <Input id="kpi-target" inputMode="decimal" value={form.target} onChange={(e) => set("target", e.target.value)} />
          </FormField>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Atenção a partir de (% da meta)" htmlFor="kpi-attention" required hint="Abaixo disso o status vira Crítico">
            <Input id="kpi-attention" inputMode="decimal" value={form.attentionPct} onChange={(e) => set("attentionPct", e.target.value)} />
          </FormField>
          <FormField label="Peso" htmlFor="kpi-weight" required hint="Usado nos scorecards e no bônus">
            <Input id="kpi-weight" inputMode="decimal" value={form.weight} onChange={(e) => set("weight", e.target.value)} />
          </FormField>
        </div>

        <FormField label="Descrição" htmlFor="kpi-description" hint="Opcional; sem descrição vale a da fórmula">
          <Textarea id="kpi-description" value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={600} />
        </FormField>

        <Switch label="Ativo" description="Indicadores inativos saem dos snapshots e do cockpit." checked={form.active} onCheckedChange={(v) => set("active", v)} />

        {error ? (
          <p className="rounded-md bg-danger-soft p-2.5 text-sm text-danger-fg" role="alert">
            {error}
          </p>
        ) : null}
      </DrawerBody>
      <DrawerFooter>
        <Button type="button" variant="outline" className="min-h-[44px] md:min-h-0" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" className="min-h-[44px] md:min-h-0" loading={pending}>
          {editing ? "Salvar alterações" : "Criar indicador"}
        </Button>
      </DrawerFooter>
    </form>
  );
}
