"use client";

import * as React from "react";
import { Archive, ArchiveRestore, Pencil, Plus, Target } from "lucide-react";
import type { CenterRow } from "@/server/finance-registry/queries";
import { saveCostCenterAction, setCostCenterArchivedAction } from "@/server/finance-registry/actions";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ReasonDialog } from "@/components/commissions/commission-ui";
import { useFinanceAction } from "@/components/finance/use-finance-action";
import { ArchivedBadge } from "./shared";

export interface CentersCan {
  create: boolean;
  edit: boolean;
  archive: boolean;
}

/** Centros de custo (negócio, cliente, unidade ou projeto): categorias de nível 1 apontam para eles. */
export function CentersPanel({ rows, can, canImport = false }: { rows: CenterRow[]; can: CentersCan; canImport?: boolean }) {
  const [editing, setEditing] = React.useState<CenterRow | "new" | null>(null);
  const [archiving, setArchiving] = React.useState<CenterRow | null>(null);
  const { pending, run } = useFinanceAction();
  const active = rows.filter((r) => !r.archived).length;

  return (
    <>
      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Centros de custo</CardTitle>
            <p className="mt-0.5 text-sm text-muted">
              {active} ativo(s){rows.length > active ? ` · ${rows.length - active} arquivado(s)` : ""} · toda categoria pertence a um centro; a subcategoria herda o da mãe
            </p>
          </div>
          {can.create ? (
            <Button className="h-11 md:h-9" onClick={() => setEditing("new")}>
              <Plus /> Novo centro
            </Button>
          ) : null}
        </CardHeader>
        {rows.length === 0 ? (
          <EmptyState icon={<Target />} title="Nenhum centro de custo" description={`Cadastre os centros (negócio, cliente, unidade ou projeto)${canImport ? " ou use “Importar da configuração” no topo" : ""}.`} />
        ) : (
          <ul className="flex flex-col divide-y divide-border" data-testid="centers-list">
            {rows.map((r) => (
              <li key={r.id} data-center={r.name} className={cn("flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-4", r.archived && "opacity-70")}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="min-w-0 break-words">{r.name}</span>
                    {r.legacyKey ? (
                      <Badge variant="info" size="sm" title="Criado pela importação da configuração de Contas a Pagar">
                        da configuração
                      </Badge>
                    ) : null}
                    {r.archived ? <ArchivedBadge reason={r.archiveReason} /> : null}
                  </p>
                  {r.description ? <p className="mt-0.5 break-words text-xs text-muted">{r.description}</p> : null}
                </div>
                <p className="text-sm text-muted md:w-[280px] md:shrink-0" data-testid="center-usage">
                  {r.activeCategories} categoria(s) ativa(s) · {r.usage} título(s)
                  {r.legacyUsage ? ` · ${r.legacyUsage} título(s) antigo(s) pela configuração` : ""}
                </p>
                <div className="flex flex-wrap gap-2 md:shrink-0 md:justify-end">
                  {can.edit && !r.archived ? (
                    <Button variant="outline" size="sm" className="h-10 md:h-8" onClick={() => setEditing(r)} aria-label={`Editar ${r.name}`}>
                      <Pencil /> Editar
                    </Button>
                  ) : null}
                  {can.archive ? (
                    r.archived ? (
                      <Button variant="outline" size="sm" className="h-10 md:h-8" disabled={pending} onClick={() => void run(() => setCostCenterArchivedAction({ id: r.id, archived: false }), `Centro ${r.name} reativado`)} aria-label={`Reativar ${r.name}`}>
                        <ArchiveRestore /> Reativar
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 md:h-8"
                        disabled={r.activeCategories > 0}
                        title={r.activeCategories > 0 ? `Em uso por ${r.activeCategories} categoria(s) ativa(s): aplique outro centro a elas antes de arquivar` : undefined}
                        onClick={() => setArchiving(r)}
                        aria-label={`Arquivar ${r.name}`}
                      >
                        <Archive /> Arquivar
                      </Button>
                    )
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing ? <CenterDialog center={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      <ReasonDialog
        open={Boolean(archiving)}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={archiving ? `Arquivar o centro ${archiving.name}?` : "Arquivar centro"}
        description="O centro sai das listas de escolha; nada é apagado e ele pode ser reativado."
        confirmLabel="Arquivar"
        destructive
        pending={pending}
        onConfirm={(reason) => (archiving ? run(() => setCostCenterArchivedAction({ id: archiving.id, archived: true, reason }), `Centro ${archiving.name} arquivado`, () => setArchiving(null)) : Promise.resolve(false))}
      />
    </>
  );
}

function CenterDialog({ center, onClose }: { center: CenterRow | null; onClose: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [name, setName] = React.useState(center?.name ?? "");
  const [description, setDescription] = React.useState(center?.description ?? "");
  const submit = () =>
    void run(
      () => saveCostCenterAction({ id: center?.id, name, description }),
      (d) => (d.created ? "Centro de custo cadastrado" : "Centro de custo atualizado"),
      () => onClose(),
    );
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{center ? `Editar ${center.name}` : "Novo centro de custo"}</DialogTitle>
          <DialogDescription>Negócio, cliente, unidade ou projeto. O nome é único entre os centros ativos.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <FormField label="Nome" htmlFor={`${id}-n`} required>
            <Input id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Comercial" />
          </FormField>
          <FormField label="Descrição" htmlFor={`${id}-d`}>
            <Textarea id={`${id}-d`} value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={name.trim().length < 2}>
            {center ? "Salvar" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
