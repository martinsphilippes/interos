"use client";

import * as React from "react";
import { AlertTriangle, Archive, ArchiveRestore, CornerDownRight, FolderInput, Merge, Pencil, Plus, Tags, Target, X } from "lucide-react";
import type { FinanceCategoryType } from "@/domain/types";
import { FINANCE_CATEGORY_TYPES, FINANCE_CATEGORY_TYPE_LABELS, NO_COST_CENTER_LABEL } from "@/domain/finance-registry";
import type { CategoryRow, CenterRow } from "@/server/finance-registry/queries";
import { applyCostCenterToCategoriesAction, mergeFinanceCategoriesAction, moveSubcategoriesAction, saveFinanceCategoryAction, setFinanceCategoryArchivedAction } from "@/server/finance-registry/actions";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ReasonDialog } from "@/components/commissions/commission-ui";
import { useFinanceAction } from "@/components/finance/use-finance-action";
import { ArchivedBadge } from "./shared";

export interface CategoriesCan {
  create: boolean;
  edit: boolean;
  archive: boolean;
  reorganize: boolean;
  merge: boolean;
}

type TypeFilter = "todas" | FinanceCategoryType;

const usageText = (r: CategoryRow) => {
  const parts = [r.parentId ? `${r.usage} título(s)/lançamento(s)` : `${r.usageTotal} título(s)/lançamento(s)${r.usageTotal !== r.usage ? ` (${r.usage} direto(s))` : ""}`];
  if (r.legacyUsage) parts.push(`${r.legacyUsage} título(s) antigo(s) pela configuração`);
  return parts.join(" · ");
};

/**
 * Categorias de receita/despesa com subcategoria. Categoria (nível 1) tem centro obrigatório; subcategoria herda tipo
 * e centro da mãe. Mostra quantas estão sem centro e o uso de cada uma; manutenção em massa (aplicar centro, mover
 * subcategorias, mesclar) e arquivamento com aviso do que vai junto.
 */
export function CategoriesPanel({ rows, centers, withoutCenter, can, canImport = false }: { rows: CategoryRow[]; centers: CenterRow[]; withoutCenter: number; can: CategoriesCan; canImport?: boolean }) {
  const [filter, setFilter] = React.useState<TypeFilter>("todas");
  const [showArchived, setShowArchived] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = React.useState<
    | { kind: "edit"; row: CategoryRow | null; parentId?: string }
    | { kind: "apply" }
    | { kind: "move" }
    | { kind: "merge"; sourceId?: string }
    | null
  >(null);
  const [archiving, setArchiving] = React.useState<CategoryRow | null>(null);
  const { pending, run } = useFinanceAction();

  const byId = React.useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const visible = (r: CategoryRow) => (showArchived || !r.archived) && (filter === "todas" || r.type === filter);
  const parents = rows.filter((r) => !r.parentId && visible(r)).sort((a, b) => FINANCE_CATEGORY_TYPES.indexOf(a.type) - FINANCE_CATEGORY_TYPES.indexOf(b.type) || Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, "pt-BR"));
  const childrenOf = (id: string) => rows.filter((r) => r.parentId === id && visible(r)).sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, "pt-BR"));
  const archivedCount = rows.filter((r) => r.archived).length;
  const selectedRows = [...selected].map((id) => byId.get(id)).filter((r): r is CategoryRow => Boolean(r));
  const onlyCategories = selectedRows.length > 0 && selectedRows.every((r) => !r.parentId);
  const onlySubcategories = selectedRows.length > 0 && selectedRows.every((r) => r.parentId);
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const clear = () => setSelected(new Set());
  const selectable = can.reorganize;

  const countOf = (t: TypeFilter) => rows.filter((r) => !r.parentId && !r.archived && (t === "todas" || r.type === t)).length;

  return (
    <>
      {withoutCenter > 0 ? (
        <div role="alert" className="mb-4 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-fg" data-testid="without-center">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong>{withoutCenter} categoria(s) sem centro de custo.</strong> Toda categoria precisa estar atrelada a um centro: selecione-as e use “Aplicar centro”.
          </p>
        </div>
      ) : null}
      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>Categorias e subcategorias</CardTitle>
              <p className="mt-0.5 text-sm text-muted" data-testid="categories-summary">
                {countOf("despesa")} de despesa · {countOf("receita")} de receita · {withoutCenter} sem centro de custo
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {can.merge && rows.some((r) => !r.archived) ? (
                <Button variant="outline" className="h-11 md:h-9" onClick={() => setDialog({ kind: "merge" })}>
                  <Merge /> Mesclar
                </Button>
              ) : null}
              {can.create ? (
                <Button className="h-11 md:h-9" onClick={() => setDialog({ kind: "edit", row: null })}>
                  <Plus /> Nova categoria
                </Button>
              ) : null}
            </div>
          </div>
          {rows.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SegmentedControl<TypeFilter>
                aria-label="Tipo"
                size="sm"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "todas", label: "Todas" },
                  { value: "despesa", label: "Despesa" },
                  { value: "receita", label: "Receita" },
                ]}
              />
              {archivedCount > 0 ? <Checkbox label={`Mostrar arquivadas (${archivedCount})`} checked={showArchived} onCheckedChange={(v) => setShowArchived(v === true)} /> : null}
            </div>
          ) : null}
        </CardHeader>

        {selectable && selectedRows.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-y border-border bg-brand-soft/40 px-4 py-2 text-sm" data-testid="bulk-bar">
            <span className="font-medium">{selectedRows.length} selecionada(s)</span>
            {onlyCategories ? (
              <Button size="sm" className="h-10 md:h-8" onClick={() => setDialog({ kind: "apply" })}>
                <Target /> Aplicar centro
              </Button>
            ) : null}
            {onlySubcategories ? (
              <Button size="sm" className="h-10 md:h-8" onClick={() => setDialog({ kind: "move" })}>
                <FolderInput /> Mover para…
              </Button>
            ) : null}
            {!onlyCategories && !onlySubcategories ? <span className="text-xs text-muted">Selecione só categorias (aplicar centro) ou só subcategorias (mover).</span> : null}
            <Button variant="ghost" size="sm" className="h-10 md:h-8" onClick={clear}>
              <X /> Limpar seleção
            </Button>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState icon={<Tags />} title="Nenhuma categoria" description={`Cadastre categorias de receita e despesa (cada uma num centro de custo)${canImport ? " ou use “Importar da configuração” no topo" : ""}.`} />
        ) : parents.length === 0 ? (
          <EmptyState size="sm" icon={<Tags />} title="Nenhuma categoria neste filtro" description="Troque o tipo ou mostre as arquivadas." />
        ) : (
          <ul className="flex flex-col divide-y divide-border" data-testid="categories-list">
            {parents.map((p) => (
              <li key={p.id}>
                <CategoryLine row={p} selectable={selectable} checked={selected.has(p.id)} onCheck={(v) => toggle(p.id, v)} can={can} pending={pending} onEdit={() => setDialog({ kind: "edit", row: p })} onAddSub={() => setDialog({ kind: "edit", row: null, parentId: p.id })} onArchive={() => setArchiving(p)} onReactivate={() => void run(() => setFinanceCategoryArchivedAction({ id: p.id, archived: false }), `Categoria ${p.name} reativada`)} onMerge={() => setDialog({ kind: "merge", sourceId: p.id })} />
                {childrenOf(p.id).length > 0 ? (
                  <ul className="flex flex-col divide-y divide-border/60 border-t border-border/60 bg-surface-muted/40">
                    {childrenOf(p.id).map((s) => (
                      <li key={s.id}>
                        <CategoryLine row={s} selectable={selectable} checked={selected.has(s.id)} onCheck={(v) => toggle(s.id, v)} can={can} pending={pending} onEdit={() => setDialog({ kind: "edit", row: s })} onArchive={() => setArchiving(s)} onReactivate={() => void run(() => setFinanceCategoryArchivedAction({ id: s.id, archived: false }), `Subcategoria ${s.name} reativada`)} onMerge={() => setDialog({ kind: "merge", sourceId: s.id })} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {dialog?.kind === "edit" ? <CategoryDialog row={dialog.row} presetParentId={dialog.parentId} rows={rows} centers={centers} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "apply" ? <ApplyCenterDialog categories={selectedRows} centers={centers} onClose={() => setDialog(null)} onDone={clear} /> : null}
      {dialog?.kind === "move" ? <MoveDialog subcategories={selectedRows} rows={rows} onClose={() => setDialog(null)} onDone={clear} /> : null}
      {dialog?.kind === "merge" ? <MergeDialog rows={rows} presetSourceId={dialog.sourceId} onClose={() => setDialog(null)} /> : null}
      <ReasonDialog
        open={Boolean(archiving)}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={archiving ? `Arquivar ${archiving.parentId ? "a subcategoria" : "a categoria"} ${archiving.name}?` : "Arquivar categoria"}
        description={archiving ? <ArchiveWarning row={archiving} /> : null}
        confirmLabel="Arquivar"
        destructive
        pending={pending}
        onConfirm={(reason) =>
          archiving
            ? run(
                () => setFinanceCategoryArchivedAction({ id: archiving.id, archived: true, reason }),
                (d) => `${archiving.name} arquivada${d.subcategories ? ` com ${d.subcategories} subcategoria(s)` : ""}`,
                () => setArchiving(null),
              )
            : Promise.resolve(false)
        }
      />
    </>
  );
}

function ArchiveWarning({ row }: { row: CategoryRow }) {
  const subs = row.activeSubcategories;
  return (
    <span className="flex flex-col gap-1" data-testid="archive-warning">
      {subs.length > 0 ? (
        <span>
          <strong>{subs.length} subcategoria(s)</strong> serão arquivadas junto: {subs.join(", ")}.
        </span>
      ) : null}
      <span>
        <strong>{row.parentId ? row.usage : row.usageTotal} título(s)/lançamento(s)</strong> usam {row.parentId ? "esta subcategoria" : "esta categoria e as subcategorias"}
        {row.legacyUsage ? ` (e ${row.legacyUsage} título(s) antigo(s) pela configuração)` : ""}; eles continuam com a classificação gravada.
      </span>
      <span>Nada é apagado: a categoria pode ser reativada.</span>
    </span>
  );
}

function CategoryLine({
  row,
  selectable,
  checked,
  onCheck,
  can,
  pending,
  onEdit,
  onAddSub,
  onArchive,
  onReactivate,
  onMerge,
}: {
  row: CategoryRow;
  selectable: boolean;
  checked: boolean;
  onCheck: (v: boolean) => void;
  can: CategoriesCan;
  pending: boolean;
  onEdit: () => void;
  onAddSub?: () => void;
  onArchive: () => void;
  onReactivate: () => void;
  onMerge: () => void;
}) {
  const sub = Boolean(row.parentId);
  return (
    <div className={cn("flex flex-col gap-2 py-3 pr-4 md:flex-row md:items-center md:gap-4", sub ? "pl-6 md:pl-10" : "pl-4", row.archived && "opacity-70")} data-category={row.name} data-level={sub ? 2 : 1}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {selectable && !row.archived ? <Checkbox className="mt-1" checked={checked} onCheckedChange={(v) => onCheck(v === true)} aria-label={`Selecionar ${row.name}`} /> : null}
        {sub ? <CornerDownRight className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> : null}
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="min-w-0 break-words">{row.name}</span>
            {!sub ? (
              <Badge variant={row.type === "receita" ? "success" : "warning"} size="sm">
                {FINANCE_CATEGORY_TYPE_LABELS[row.type]}
              </Badge>
            ) : null}
            {row.legacyKey ? (
              <Badge variant="info" size="sm" title={`Chave na configuração: ${row.legacyKey}`}>
                da configuração
              </Badge>
            ) : null}
            {row.archived ? <ArchivedBadge label={row.mergedIntoName ? `Mesclada em ${row.mergedIntoName}` : "Arquivada"} reason={row.archiveReason} /> : null}
          </p>
          <p className="mt-0.5 break-words text-xs text-muted" data-testid="category-center">
            {sub ? "Herda da mãe · " : ""}Centro: {row.centerName ?? <span className="font-medium text-warning-fg">{NO_COST_CENTER_LABEL}</span>}
            {row.centerArchived ? " (arquivado)" : ""}
          </p>
        </div>
      </div>
      <p className="text-xs text-muted md:w-[260px] md:shrink-0" data-testid="category-usage">
        {usageText(row)}
      </p>
      <div className="flex flex-wrap gap-2 md:w-[300px] md:shrink-0 md:justify-end xl:w-[430px] xl:flex-nowrap">
        {!row.archived && can.edit ? (
          <Button variant="outline" size="sm" className="h-10 md:h-8" onClick={onEdit} aria-label={`Editar ${row.name}`}>
            <Pencil /> Editar
          </Button>
        ) : null}
        {!row.archived && !sub && can.create ? (
          <Button variant="outline" size="sm" className="h-10 md:h-8" onClick={onAddSub} aria-label={`Nova subcategoria em ${row.name}`}>
            <Plus /> Subcategoria
          </Button>
        ) : null}
        {!row.archived && can.merge ? (
          <Button variant="ghost" size="sm" className="h-10 md:h-8" onClick={onMerge} aria-label={`Mesclar ${row.name} em outra`}>
            <Merge /> Mesclar
          </Button>
        ) : null}
        {can.archive && !row.mergedIntoName ? (
          row.archived ? (
            <Button variant="outline" size="sm" className="h-10 md:h-8" disabled={pending} onClick={onReactivate} aria-label={`Reativar ${row.name}`}>
              <ArchiveRestore /> Reativar
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="h-10 md:h-8" onClick={onArchive} aria-label={`Arquivar ${row.name}`}>
              <Archive /> Arquivar
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}

const centerOptions = (centers: CenterRow[], keepId?: string) => centers.filter((c) => !c.archived || c.id === keepId).map((c) => ({ value: c.id, label: c.archived ? `${c.name} (arquivado)` : c.name }));

function CategoryDialog({ row, presetParentId, rows, centers, onClose }: { row: CategoryRow | null; presetParentId?: string; rows: CategoryRow[]; centers: CenterRow[]; onClose: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [level, setLevel] = React.useState<"categoria" | "subcategoria">(row ? (row.parentId ? "subcategoria" : "categoria") : presetParentId ? "subcategoria" : "categoria");
  const [name, setName] = React.useState(row?.name ?? "");
  const [type, setType] = React.useState<FinanceCategoryType>(row?.type ?? "despesa");
  const [centerId, setCenterId] = React.useState(row?.costCenterId ?? "");
  const [parentId, setParentId] = React.useState(row?.parentId ?? presetParentId ?? "");
  const parentOptions = rows.filter((r) => !r.parentId && !r.archived && r.id !== row?.id);
  const parent = rows.find((r) => r.id === parentId);
  const hasChildren = row ? rows.some((r) => r.parentId === row.id) : false;
  const valid = name.trim().length >= 2 && (level === "categoria" ? Boolean(centerId) : Boolean(parentId));
  const submit = () =>
    void run(
      () => saveFinanceCategoryAction(level === "categoria" ? { id: row?.id, name, type, parentId: null, costCenterId: centerId || null } : { id: row?.id, name, parentId, costCenterId: null }),
      (d) => (d.created ? (level === "categoria" ? "Categoria cadastrada" : "Subcategoria cadastrada") : "Categoria atualizada"),
      () => onClose(),
    );
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{row ? `Editar ${row.name}` : level === "subcategoria" ? "Nova subcategoria" : "Nova categoria"}</DialogTitle>
          <DialogDescription>Categoria pertence sempre a um centro de custo. Subcategoria herda o tipo e o centro da categoria-mãe e não tem centro próprio.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {!presetParentId && !hasChildren ? (
            <SegmentedControl<"categoria" | "subcategoria">
              aria-label="Nível"
              value={level}
              onChange={setLevel}
              options={[
                { value: "categoria", label: "Categoria" },
                { value: "subcategoria", label: "Subcategoria" },
              ]}
            />
          ) : null}
          <FormField label="Nome" htmlFor={`${id}-n`} required>
            <Input id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value)} placeholder={level === "categoria" ? "Ex.: Motoristas" : "Ex.: Diárias"} />
          </FormField>
          {level === "categoria" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Tipo" htmlFor={`${id}-t`} required>
                <Select id={`${id}-t`} value={type} onChange={(e) => setType(e.target.value as FinanceCategoryType)} options={FINANCE_CATEGORY_TYPES.map((t) => ({ value: t, label: FINANCE_CATEGORY_TYPE_LABELS[t] }))} />
              </FormField>
              <FormField label="Centro de custo" htmlFor={`${id}-c`} required hint={centers.some((c) => !c.archived) ? undefined : "Cadastre um centro de custo antes"}>
                <Select id={`${id}-c`} value={centerId} onChange={(e) => setCenterId(e.target.value)} placeholder="Escolha o centro" options={centerOptions(centers, row?.costCenterId)} />
              </FormField>
            </div>
          ) : (
            <FormField label="Categoria-mãe" htmlFor={`${id}-p`} required hint={parent ? `Herda: ${FINANCE_CATEGORY_TYPE_LABELS[parent.type].toLowerCase()} · centro ${parent.centerName ?? NO_COST_CENTER_LABEL}` : undefined}>
              <Select id={`${id}-p`} value={parentId} onChange={(e) => setParentId(e.target.value)} placeholder="Escolha a categoria" options={parentOptions.map((p) => ({ value: p.id, label: `${p.name} (${FINANCE_CATEGORY_TYPE_LABELS[p.type].toLowerCase()})` }))} />
            </FormField>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={!valid}>
            {row ? "Salvar" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApplyCenterDialog({ categories, centers, onClose, onDone }: { categories: CategoryRow[]; centers: CenterRow[]; onClose: () => void; onDone: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [centerId, setCenterId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const submit = () =>
    void run(
      () => applyCostCenterToCategoriesAction({ categoryIds: categories.map((c) => c.id), costCenterId: centerId, reason }),
      (d) => (d.changed ? `Centro aplicado a ${d.changed} categoria(s)` : "Nada a alterar: as categorias já estavam neste centro"),
      () => {
        onDone();
        onClose();
      },
    );
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Aplicar centro de custo</DialogTitle>
          <DialogDescription>
            {categories.length} categoria(s): {categories.map((c) => c.name).join(", ")}. As subcategorias passam a herdar o novo centro.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <FormField label="Centro de custo" htmlFor={`${id}-c`} required>
            <Select id={`${id}-c`} value={centerId} onChange={(e) => setCenterId(e.target.value)} placeholder="Escolha o centro" options={centerOptions(centers)} />
          </FormField>
          <FormField label="Motivo (opcional)" htmlFor={`${id}-r`}>
            <Textarea id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={!centerId}>
            Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({ subcategories, rows, onClose, onDone }: { subcategories: CategoryRow[]; rows: CategoryRow[]; onClose: () => void; onDone: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const types = new Set(subcategories.map((s) => s.type));
  const sameType = types.size === 1 ? [...types][0] : null;
  const targets = rows.filter((r) => !r.parentId && !r.archived && (!sameType || r.type === sameType));
  const [targetId, setTargetId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const submit = () =>
    void run(
      () => moveSubcategoriesAction({ subcategoryIds: subcategories.map((s) => s.id), targetParentId: targetId, reason }),
      (d) => (d.moved ? `${d.moved} subcategoria(s) movida(s)` : "Nada a mover: já estavam nesta categoria"),
      () => {
        onDone();
        onClose();
      },
    );
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Mover subcategorias</DialogTitle>
          <DialogDescription>
            {subcategories.length} subcategoria(s): {subcategories.map((s) => s.name).join(", ")}. A nova mãe precisa ser do mesmo tipo; o centro passa a ser o dela.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <FormField label="Nova categoria-mãe" htmlFor={`${id}-p`} required>
            <Select id={`${id}-p`} value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="Escolha a categoria" options={targets.map((t) => ({ value: t.id, label: `${t.name} (${t.centerName ?? NO_COST_CENTER_LABEL})` }))} />
          </FormField>
          <FormField label="Motivo (opcional)" htmlFor={`${id}-r`}>
            <Textarea id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={!targetId}>
            Mover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MergeDialog({ rows, presetSourceId, onClose }: { rows: CategoryRow[]; presetSourceId?: string; onClose: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const active = rows.filter((r) => !r.archived);
  const [sourceId, setSourceId] = React.useState(presetSourceId ?? "");
  const [targetId, setTargetId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const source = rows.find((r) => r.id === sourceId);
  const nameOf = (r: CategoryRow) => (r.parentId ? `${rows.find((p) => p.id === r.parentId)?.name ?? "?"} › ${r.name}` : r.name);
  const subs = source ? rows.filter((r) => r.parentId === source.id) : [];
  // Mesmo tipo; origem com subcategorias só vai para categoria de nível 1; nunca para uma filha da própria origem.
  const targets = active.filter((r) => r.id !== sourceId && (!source || (r.type === source.type && r.parentId !== source.id && (subs.length === 0 || !r.parentId))));
  const submit = () =>
    void run(
      () => mergeFinanceCategoriesAction({ sourceId, targetId, reason }),
      (d) => `Mesclada: ${d.subcategories} subcategoria(s) e ${d.records} título(s)/lançamento(s) transferidos`,
      () => onClose(),
    );
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Mesclar categorias</DialogTitle>
          <DialogDescription>Tudo da origem (subcategorias e títulos/lançamentos) passa para a destino, e a origem é arquivada. Só entre categorias do mesmo tipo.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <FormField label="Origem (será arquivada)" htmlFor={`${id}-s`} required>
            <Select
              id={`${id}-s`}
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setTargetId("");
              }}
              placeholder="Escolha a origem"
              options={active.map((r) => ({ value: r.id, label: `${nameOf(r)} (${FINANCE_CATEGORY_TYPE_LABELS[r.type].toLowerCase()})` }))}
            />
          </FormField>
          <FormField label="Destino" htmlFor={`${id}-t`} required hint={source && targets.length === 0 ? "Nenhuma categoria compatível (mesmo tipo e nível)" : undefined}>
            <Select id={`${id}-t`} value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="Escolha a destino" disabled={!source} options={targets.map((r) => ({ value: r.id, label: nameOf(r) }))} />
          </FormField>
          {source ? (
            <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-muted" data-testid="merge-preview">
              Vão para a destino: {subs.length} subcategoria(s){subs.length ? ` (${subs.map((s) => s.name).join(", ")})` : ""} e {source.usage} título(s)/lançamento(s).
              {source.legacyUsage ? ` Os ${source.legacyUsage} título(s) antigo(s) pela configuração continuam como estão.` : ""}
            </p>
          ) : null}
          <FormField label="Motivo" htmlFor={`${id}-r`} required hint="Mínimo de 5 caracteres; fica registrado na auditoria">
            <Textarea id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={submit} loading={pending} disabled={!sourceId || !targetId || reason.trim().length < 5}>
            Mesclar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
