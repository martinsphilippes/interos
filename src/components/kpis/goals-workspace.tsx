"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Copy, Network, Pencil, Plus, Target, Trash2, User as UserIcon } from "lucide-react";
import type { GoalRow, GoalsBoard } from "@/server/kpis/queries";
import { copyGoalsFromPreviousMonth, deleteGoal, upsertGoal } from "@/server/kpis/actions";
import { formatKpiValue, type KpiScope, type KpiUnit } from "@/server/kpis/schemas";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { AttainmentBar } from "./attainment-bar";
import { KpiStatusBadge } from "./kpi-status-badge";

type Filter = "todas" | KpiScope;
type DrawerState = { mode: "new" } | { mode: "edit"; row: GoalRow } | null;

const SCOPE_ICON: Record<KpiScope, React.ReactNode> = { empresa: <Building2 aria-hidden />, departamento: <Network aria-hidden />, usuario: <UserIcon aria-hidden /> };

function parseNumber(text: string): number | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : Number.NaN;
}

function toInput(value: number | undefined, unit: KpiUnit): string {
  if (value === undefined) return "";
  return String(unit === "percentual" ? Math.round(value * 100 * 1000) / 1000 : value).replace(".", ",");
}

export function GoalsWorkspace({ board }: { board: GoalsBoard }) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<Filter>("todas");
  const [drawer, setDrawer] = React.useState<DrawerState>(null);
  const [toDelete, setToDelete] = React.useState<GoalRow | null>(null);
  const [copyOpen, setCopyOpen] = React.useState(false);

  const counts = { todas: board.rows.length, empresa: 0, departamento: 0, usuario: 0 } as Record<Filter, number>;
  for (const r of board.rows) counts[r.goal.scope] += 1;
  const rows = board.rows.filter((r) => filter === "todas" || r.goal.scope === filter);

  // Agrupa por escopo + sujeito (Empresa, cada departamento, cada colaborador).
  const groups: { key: string; scope: KpiScope; label: string; rows: GoalRow[] }[] = [];
  for (const r of rows) {
    const key = `${r.goal.scope}|${r.goal.scopeId ?? ""}`;
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, scope: r.goal.scope, label: r.scopeLabel, rows: [] };
      groups.push(group);
    }
    group.rows.push(r);
  }

  const onDelete = async () => {
    if (!toDelete) return;
    const result = await deleteGoal({ id: toDelete.goal.id });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Meta removida");
    router.refresh();
  };

  const onCopy = async () => {
    const result = await copyGoalsFromPreviousMonth({ period: board.period.key });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${result.data.copied} meta(s) copiada(s) de ${board.previousLabel.toLowerCase()}`);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SegmentedControl<Filter>
          aria-label="Filtrar metas por escopo"
          value={filter}
          onChange={setFilter}
          className="max-w-full overflow-x-auto"
          options={[
            { value: "todas", label: `Todas (${counts.todas})` },
            { value: "empresa", label: `Empresa (${counts.empresa})` },
            { value: "departamento", label: `Departamentos (${counts.departamento})` },
            { value: "usuario", label: `Colaboradores (${counts.usuario})` },
          ]}
        />
        {board.canManageAny ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-[44px] md:min-h-0" disabled={board.copyableFromPrevious === 0} onClick={() => setCopyOpen(true)} title={board.copyableFromPrevious === 0 ? `Nada a copiar de ${board.previousLabel.toLowerCase()}` : undefined}>
              <Copy /> Copiar metas do mês anterior
            </Button>
            <Button className="min-h-[44px] md:min-h-0" onClick={() => setDrawer({ mode: "new" })}>
              <Plus /> Nova meta
            </Button>
          </div>
        ) : null}
      </div>

      {!board.canManageAny ? <p className="text-sm text-muted">Você vê as suas metas e as do seu departamento. Gestores, diretoria e administradores definem as metas.</p> : null}

      {groups.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={<Target />}
            title={`Nenhuma meta em ${board.period.label.toLowerCase()}`}
            description={board.canManageAny ? "Crie metas por indicador para a empresa, departamentos ou colaboradores, ou copie as do mês anterior." : "Ainda não há metas visíveis para você neste mês."}
            action={
              board.canManageAny ? (
                <>
                  {board.copyableFromPrevious > 0 ? (
                    <Button variant="outline" onClick={() => setCopyOpen(true)}>
                      <Copy /> Copiar {board.copyableFromPrevious} meta(s) de {board.previousLabel.toLowerCase()}
                    </Button>
                  ) : null}
                  <Button onClick={() => setDrawer({ mode: "new" })}>
                    <Plus /> Nova meta
                  </Button>
                </>
              ) : null
            }
          />
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="rounded-lg border border-border bg-surface shadow-card">
            <header className="flex items-center gap-2 border-b border-border px-4 py-3 [&_svg]:size-4 [&_svg]:text-muted">
              {SCOPE_ICON[group.scope]}
              <h2 className="text-sm font-semibold text-foreground">{group.label}</h2>
              <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium tabular-nums text-muted">{group.rows.length}</span>
            </header>
            <ul className="divide-y divide-border">
              {group.rows.map((r) => (
                <li key={r.goal.id} className="flex flex-col gap-2 px-4 py-3 md:grid md:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.6fr)_auto] md:items-center md:gap-4">
                  <div className="min-w-0">
                    <Link href={r.href} className="font-medium text-foreground hover:text-brand">
                      {r.kpiName}
                    </Link>
                    <p className="text-xs text-muted">Peso {r.goal.weight}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-sm md:block">
                    <span className="text-xs text-muted md:block">Meta</span>
                    <span className="font-medium tabular-nums">{formatKpiValue(r.goal.target, r.unit, r.suffix)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-sm md:block">
                    <span className="text-xs text-muted md:block">Atual</span>
                    <span className="font-medium tabular-nums" title={r.note}>
                      {formatKpiValue(r.value, r.unit, r.suffix)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AttainmentBar attainment={r.attainment} status={r.status} size="sm" noData={r.value === null} className="flex-1" />
                    <KpiStatusBadge status={r.status} noData={r.value === null} />
                  </div>
                  <div className="flex justify-end gap-1">
                    {r.canEdit ? (
                      <>
                        <Button variant="ghost" size="icon" className="size-11 md:size-9" aria-label={`Editar meta de ${r.kpiName}`} onClick={() => setDrawer({ mode: "edit", row: r })}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-11 text-danger-fg md:size-9" aria-label={`Remover meta de ${r.kpiName}`} onClick={() => setToDelete(r)}>
                          <Trash2 />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <Drawer open={drawer !== null} onOpenChange={(open) => !open && setDrawer(null)}>
        <DrawerContent size="sm">
          {drawer ? (
            <GoalForm
              key={drawer.mode === "edit" ? drawer.row.goal.id : "new"}
              state={drawer}
              board={board}
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
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="Remover meta?"
        description={toDelete ? `A meta de ${toDelete.kpiName} (${toDelete.scopeLabel}) em ${board.period.label.toLowerCase()} será removida.` : undefined}
        confirmLabel="Remover"
        destructive
        onConfirm={onDelete}
      />

      <ConfirmDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        title="Copiar metas do mês anterior"
        description={`${board.copyableFromPrevious} meta(s) de ${board.previousLabel.toLowerCase()} que você gerencia serão copiadas para ${board.period.label.toLowerCase()}. Metas que já existem no mês não são alteradas.`}
        confirmLabel="Copiar"
        onConfirm={onCopy}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------

function GoalForm({ state, board, onClose, onDone }: { state: NonNullable<DrawerState>; board: GoalsBoard; onClose: () => void; onDone: () => void }) {
  const editing = state.mode === "edit";
  const perms = board.permissions;
  const allowedScopes: KpiScope[] = [...(perms.canCompany ? (["empresa"] as const) : []), ...(perms.departments.length > 0 ? (["departamento"] as const) : []), ...(perms.userIds.length > 0 ? (["usuario"] as const) : [])];
  const initial = editing ? state.row.goal : null;
  const [kpiKey, setKpiKey] = React.useState(initial?.kpiKey ?? "");
  const [scope, setScope] = React.useState<KpiScope>(initial?.scope ?? allowedScopes[0] ?? "usuario");
  const [scopeId, setScopeId] = React.useState(initial?.scopeId ?? "");
  const kpi = board.kpis.find((k) => k.key === kpiKey);
  const unit = kpi?.unit ?? "numero";
  const [target, setTarget] = React.useState(initial ? toInput(initial.target, editing ? state.row.unit : "numero") : "");
  const [weight, setWeight] = React.useState(String(initial?.weight ?? 1));
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const departments = board.departments.filter((d) => perms.departments.includes(d.key));
  const users = board.users.filter((u) => perms.userIds.includes(u.id));
  const groupedKpis = Array.from(new Set(board.kpis.map((k) => k.department))).map((dep) => ({ dep, items: board.kpis.filter((k) => k.department === dep) }));

  const onKpi = (key: string) => {
    setKpiKey(key);
    const next = board.kpis.find((k) => k.key === key);
    // Sugere a meta padrão do indicador quando o campo está vazio.
    if (!target && next?.target !== undefined) setTarget(toInput(next.target, next.unit));
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsedTarget = parseNumber(target);
    const parsedWeight = parseNumber(weight);
    if (parsedTarget === undefined || Number.isNaN(parsedTarget)) return setError("Informe um alvo numérico");
    if (parsedWeight === undefined || Number.isNaN(parsedWeight)) return setError("Informe um peso numérico");
    startTransition(async () => {
      const result = await upsertGoal({
        id: editing ? state.row.goal.id : undefined,
        kpiKey,
        scope,
        scopeId: scope === "empresa" ? undefined : scopeId || undefined,
        period: board.period.key,
        target: unit === "percentual" ? parsedTarget / 100 : parsedTarget,
        weight: parsedWeight,
      });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(editing ? "Meta atualizada" : "Meta criada");
      onDone();
    });
  };

  const hint = unit === "percentual" ? "em %" : unit === "moeda" ? "em R$" : unit === "dias" ? "em dias" : unit === "horas" ? "em horas" : kpi?.suffix ? `em ${kpi.suffix}` : undefined;

  return (
    <form onSubmit={onSubmit} className="flex h-full min-h-0 flex-col">
      <DrawerHeader>
        <DrawerTitle>{editing ? "Editar meta" : "Nova meta"}</DrawerTitle>
        <DrawerDescription>{board.period.label}</DrawerDescription>
      </DrawerHeader>
      <DrawerBody className="flex flex-col gap-4">
        <FormField label="Indicador" htmlFor="goal-kpi" required>
          <Select id="goal-kpi" value={kpiKey} onChange={(e) => onKpi(e.target.value)} required placeholder="Selecione">
            {groupedKpis.map((g) => (
              <optgroup key={g.dep} label={g.dep}>
                {g.items.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </FormField>
        <FormField label="Escopo" htmlFor="goal-scope" required>
          <Select
            id="goal-scope"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as KpiScope);
              setScopeId("");
            }}
          >
            {allowedScopes.map((s) => (
              <option key={s} value={s}>
                {board.scopeLabels[s]}
              </option>
            ))}
          </Select>
        </FormField>
        {scope === "departamento" ? (
          <FormField label="Departamento" htmlFor="goal-dep" required>
            <Select id="goal-dep" value={scopeId} onChange={(e) => setScopeId(e.target.value)} required placeholder="Selecione" options={departments.map((d) => ({ value: d.key, label: d.label }))} />
          </FormField>
        ) : null}
        {scope === "usuario" ? (
          <FormField label="Colaborador" htmlFor="goal-user" required>
            <Select id="goal-user" value={scopeId} onChange={(e) => setScopeId(e.target.value)} required placeholder="Selecione" options={users.map((u) => ({ value: u.id, label: u.name }))} />
          </FormField>
        ) : null}
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Alvo" htmlFor="goal-target" required hint={hint}>
            <Input id="goal-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} required />
          </FormField>
          <FormField label="Peso" htmlFor="goal-weight" required>
            <Input id="goal-weight" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} required />
          </FormField>
        </div>
        {kpi ? <p className="text-xs text-muted">{kpi.direction === "menor_melhor" ? "Quanto menor, melhor: a meta é o teto." : kpi.direction === "faixa" ? "Indicador de faixa: a meta é o valor de referência." : "Quanto maior, melhor: a meta é o piso."}</p> : null}
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
        <Button type="submit" className="min-h-[44px] md:min-h-0" loading={pending} disabled={!kpiKey}>
          {editing ? "Salvar" : "Criar meta"}
        </Button>
      </DrawerFooter>
    </form>
  );
}
