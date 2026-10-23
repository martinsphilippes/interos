"use client";

import * as React from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, ChevronDown, ChevronUp, Pencil, Plus, RefreshCw, Trash2, TrendingUp } from "lucide-react";
import type { IndexRow } from "@/server/finance-registry/queries";
import { refreshReadjustmentIndicesAction, saveReadjustmentIndexAction, setReadjustmentIndexArchivedAction, setReadjustmentIndexValueAction } from "@/server/finance-registry/actions";
import { competenceLabel, formatPct, INDEX_SOURCE_KIND_LABELS } from "@/domain/readjustment";
import type { ReadjustmentIndexSource } from "@/domain/types";
import { formatDate, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ReasonDialog } from "@/components/commissions/commission-ui";
import { CanSee, ScreenLink } from "@/components/auth/access-provider";
import { useFinanceAction } from "@/components/finance/use-finance-action";
import { ArchivedBadge } from "./shared";

export interface IndicesCan {
  create: boolean;
  edit: boolean;
  archive: boolean;
  refresh: boolean;
}

const NEGATIVE_OPTIONS = [
  { value: "manter", label: "Manter o valor do contrato (sem reduzir)" },
  { value: "reduzir", label: "Reduzir a mensalidade" },
];

const pctText = (v: number) => formatPct(v);
const parsePct = (v: string) => Number(v.trim().replace(",", "."));

/**
 * Índices de reajuste: cada um com a fonte (Banco Central, IPEA ou manual), o último mês, o acumulado de 12 meses e a
 * situação da busca automática. «Ver meses» abre os 24 últimos meses, o lançamento manual e os contratos indexados.
 */
export function IndicesPanel({ rows, can, selected }: { rows: IndexRow[]; can: IndicesCan; selected?: string }) {
  const [editing, setEditing] = React.useState<IndexRow | "new" | null>(null);
  const [archiving, setArchiving] = React.useState<IndexRow | null>(null);
  const { pending, run } = useFinanceAction();
  const active = rows.filter((r) => !r.archived).length;

  const refreshAll = () => void run(() => refreshReadjustmentIndicesAction({}), (d) => (d.errors ? `Busca concluída com ${d.errors} erro(s): ${d.summary}` : `Índices atualizados: ${d.summary}`));

  return (
    <>
      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Índices de reajuste</CardTitle>
            <p className="mt-0.5 text-sm text-muted">
              {active} ativo(s){rows.length > active ? ` · ${rows.length - active} desativado(s)` : ""} · buscados sozinhos todo dia; um mês novo atualiza na hora a prévia de todos os contratos indexados
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {can.refresh ? (
              <Button variant="outline" className="h-11 md:h-9" onClick={refreshAll} loading={pending && !editing && !archiving} disabled={pending}>
                <RefreshCw /> Atualizar agora
              </Button>
            ) : null}
            {can.create ? (
              <Button className="h-11 md:h-9" onClick={() => setEditing("new")}>
                <Plus /> Novo índice
              </Button>
            ) : null}
          </div>
        </CardHeader>
        {rows.length === 0 ? (
          <EmptyState icon={<TrendingUp />} title="Nenhum índice" description="Os índices padrão (IPCA, IGP-M, INPC, IGP-DI e ICTI) aparecem aqui na primeira abertura." />
        ) : (
          <ul className="flex flex-col divide-y divide-border" data-testid="indices-list">
            {rows.map((r) => {
              const open = selected === r.id;
              return (
                <li key={r.id} data-index={r.id} className={cn("flex flex-col gap-3 px-4 py-3", r.archived && "opacity-70")}>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <span className="min-w-0 break-words">{r.name}</span>
                        {r.builtIn ? (
                          <Badge variant="info" size="sm" title="Índice que o INTEROS já traz">
                            padrão
                          </Badge>
                        ) : null}
                        {r.archived ? <ArchivedBadge reason={r.archiveReason} label="Desativado" /> : null}
                      </p>
                      <p className="mt-0.5 break-words text-xs text-muted">
                        {r.sourceLabel}
                        {r.description ? ` · ${r.description}` : ""}
                        {r.negativePolicy === "reduzir" ? " · acumulado negativo reduz a mensalidade" : ""}
                      </p>
                    </div>
                    <div className="text-sm md:w-[300px] md:shrink-0" data-testid="index-summary">
                      {r.latest ? (
                        <p>
                          {competenceLabel(r.latest.competence)}: <span className="font-medium">{pctText(r.latest.pct)}</span>
                          {r.accumulated12m ? (
                            <>
                              {" · "}12 meses: <span className="font-medium">{pctText(r.accumulated12m.pct)}</span>
                            </>
                          ) : null}
                        </p>
                      ) : (
                        <p className="text-muted">Sem meses ainda</p>
                      )}
                      <p className="text-xs text-muted">
                        {r.contractCount} contrato(s) · <FetchStatus row={r} />
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 md:shrink-0 md:justify-end">
                      <Button asChild variant="ghost" size="sm" className="h-10 md:h-8">
                        <Link href={open ? "/financeiro/cadastros?aba=indices" : `/financeiro/cadastros?aba=indices&item=${r.id}`} aria-expanded={open} scroll={false}>
                          {open ? <ChevronUp /> : <ChevronDown />} {open ? "Fechar" : "Ver meses"}
                        </Link>
                      </Button>
                      {can.edit && !r.archived ? (
                        <Button variant="outline" size="sm" className="h-10 md:h-8" onClick={() => setEditing(r)} aria-label={`Editar ${r.name}`}>
                          <Pencil /> Editar
                        </Button>
                      ) : null}
                      {can.archive ? (
                        r.archived ? (
                          <Button variant="outline" size="sm" className="h-10 md:h-8" disabled={pending} onClick={() => void run(() => setReadjustmentIndexArchivedAction({ id: r.id, archived: false }), `Índice ${r.name} reativado`)} aria-label={`Reativar ${r.name}`}>
                            <ArchiveRestore /> Reativar
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" className="h-10 md:h-8" disabled={r.contractCount > 0} title={r.contractCount > 0 ? `Em uso por ${r.contractCount} contrato(s): troque o índice deles antes de desativar` : undefined} onClick={() => setArchiving(r)} aria-label={`Desativar ${r.name}`}>
                            <Archive /> Desativar
                          </Button>
                        )
                      ) : null}
                    </div>
                  </div>
                  {open ? <IndexDetail row={r} canEdit={can.edit && !r.archived} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {editing ? <IndexDialog index={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      <ReasonDialog
        open={Boolean(archiving)}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={archiving ? `Desativar o índice ${archiving.name}?` : "Desativar índice"}
        description="O índice sai das listas de escolha e para de ser buscado; nada é apagado e ele pode ser reativado."
        confirmLabel="Desativar"
        destructive
        pending={pending}
        onConfirm={(reason) => (archiving ? run(() => setReadjustmentIndexArchivedAction({ id: archiving.id, archived: true, reason }), `Índice ${archiving.name} desativado`, () => setArchiving(null)) : Promise.resolve(false))}
      />
    </>
  );
}

function FetchStatus({ row }: { row: IndexRow }) {
  if (row.sourceKind === "manual") return <>lançamento manual</>;
  if (!row.lastFetchAt) return <>ainda não buscado</>;
  if (row.lastFetchOk === false)
    return (
      <span className="text-danger-fg" title={row.lastFetchError}>
        falha na busca{row.failingSince ? ` desde ${formatDate(row.failingSince)}` : ""}: {row.lastFetchError}
      </span>
    );
  return <>buscado {formatRelative(row.lastFetchAt)}</>;
}

function IndexDetail({ row, canEdit }: { row: IndexRow; canEdit: boolean }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [competence, setCompetence] = React.useState("");
  const [pct, setPct] = React.useState("");
  const [reason, setReason] = React.useState("");
  const value = parsePct(pct);
  const valid = /^\d{4}-\d{2}$/.test(competence) && pct.trim() !== "" && Number.isFinite(value) && Math.abs(value) <= 50;
  const save = () =>
    void run(
      () => setReadjustmentIndexValueAction({ indexId: row.id, competence, pct: value, reason: reason || undefined }),
      `${row.name}: ${competenceLabel(competence)} lançado`,
      () => {
        setCompetence("");
        setPct("");
        setReason("");
      },
    );

  return (
    <div className="grid gap-4 rounded-lg border border-border p-3 lg:grid-cols-2" data-testid="index-detail">
      <div className="min-w-0">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Meses (variação e acumulado de 12 meses)</p>
        {row.months.length === 0 ? (
          <p className="text-sm text-muted">Nenhum mês ainda.{row.sourceKind !== "manual" ? " Use «Atualizar agora» para buscar na fonte." : " Lance os meses ao lado."}</p>
        ) : (
          <div className="max-h-[360px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 font-medium">Mês</th>
                  <th className="py-1 text-right font-medium">No mês</th>
                  <th className="py-1 text-right font-medium">12 meses</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {row.months.map((m) => (
                  <tr key={m.competence} className="border-t border-border">
                    <td className="py-1">
                      {competenceLabel(m.competence)}
                      {m.manual ? (
                        <Badge variant="warning" size="sm" className="ml-2" title="Lançado à mão: a fonte oficial substitui quando trouxer o mês">
                          manual
                        </Badge>
                      ) : null}
                    </td>
                    <td className="py-1 text-right tabular-nums">{pctText(m.pct)}</td>
                    <td className="py-1 text-right tabular-nums">{m.accumulated12m === null ? "—" : pctText(m.accumulated12m)}</td>
                    <td className="py-1 text-right">
                      {canEdit && m.manual ? (
                        <Button variant="ghost" size="sm" className="h-8" disabled={pending} onClick={() => void run(() => setReadjustmentIndexValueAction({ indexId: row.id, competence: m.competence, pct: null }), `${competenceLabel(m.competence)} apagado`)} aria-label={`Apagar ${competenceLabel(m.competence)}`}>
                          <Trash2 />
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {canEdit ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">Lançar um mês à mão</p>
            <p className="text-xs text-muted">{row.sourceKind === "manual" ? "Índice manual: lance a variação de cada mês (em %)." : "Só para o mês que a fonte ainda não trouxe (ex.: fonte fora do ar). Quando o valor oficial sair, ele substitui o lançado."}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Mês" htmlFor={`${id}-m`} required>
                <Input id={`${id}-m`} type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} className="h-11 md:h-9" />
              </FormField>
              <FormField label="Variação no mês (%)" htmlFor={`${id}-p`} required>
                <Input id={`${id}-p`} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="Ex.: 0,48" className="h-11 md:h-9" />
              </FormField>
            </div>
            <FormField label="Motivo / fonte" htmlFor={`${id}-r`}>
              <Input id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: IBGE, divulgação de 10/11" className="h-11 md:h-9" />
            </FormField>
            <div className="flex justify-end">
              <Button size="sm" className="h-10 md:h-8" onClick={save} loading={pending} disabled={!valid}>
                Lançar
              </Button>
            </div>
          </div>
        ) : null}
        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Contratos indexados ({row.contractCount})</p>
          {row.contracts.length === 0 ? (
            <p className="text-sm text-muted">{row.contractCount > 0 ? "Nenhum no seu acesso a contratos." : "Nenhum contrato usa este índice."}</p>
          ) : (
            <ul className="flex max-h-[240px] flex-col gap-1 overflow-y-auto text-sm" data-testid="index-contracts">
              {row.contracts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-2">
                  <CanSee href={`/financeiro/contratos/${c.id}`} fallback={<span className="font-medium">{c.number}</span>}>
                    <ScreenLink href={`/financeiro/contratos/${c.id}`} className="font-medium text-brand-fg hover:underline">
                      {c.number}
                    </ScreenLink>
                  </CanSee>
                  <span className="min-w-0 break-words text-muted">{c.clientName}</span>
                  {c.nextAnniversary ? <span className="text-xs text-muted">· data-base {formatDate(`${c.nextAnniversary}T12:00:00.000Z`)}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function IndexDialog({ index, onClose }: { index: IndexRow | null; onClose: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [name, setName] = React.useState(index?.name ?? "");
  const [description, setDescription] = React.useState(index?.description ?? "");
  const [sourceKind, setSourceKind] = React.useState<ReadjustmentIndexSource["kind"]>(index?.sourceKind ?? "bcb_sgs");
  const [seriesCode, setSeriesCode] = React.useState(index?.seriesCode ? String(index.seriesCode) : "");
  const [negativePolicy, setNegativePolicy] = React.useState(index?.negativePolicy ?? "manter");
  const builtIn = Boolean(index?.builtIn);
  const sourceOptions = (builtIn ? [index!.sourceKind] : (["bcb_sgs", "manual"] as const)).map((k) => ({ value: k, label: INDEX_SOURCE_KIND_LABELS[k] }));
  const valid = name.trim().length >= 2 && (sourceKind !== "bcb_sgs" || /^\d+$/.test(seriesCode.trim()));
  const submit = () =>
    void run(
      () => saveReadjustmentIndexAction({ id: index?.id, name, description, sourceKind, seriesCode: sourceKind === "bcb_sgs" ? seriesCode.trim() : undefined, negativePolicy }),
      (d) => `${d.created ? "Índice cadastrado" : "Índice atualizado"}${d.refresh ? ` · ${d.refresh}` : ""}`,
      () => onClose(),
    );
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{index ? `Editar ${index.name}` : "Novo índice de reajuste"}</DialogTitle>
          <DialogDescription>{builtIn ? "Índice padrão: a fonte não muda. Alterar a regra do acumulado negativo vale para os próximos reajustes de todos os contratos que usam o índice." : "Da série do Banco Central (SGS) o INTEROS busca os meses sozinho; o manual é lançado mês a mês pelo Financeiro."}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <FormField label="Nome (sigla)" htmlFor={`${id}-n`} required>
            <Input id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: IPC-Fipe" />
          </FormField>
          <FormField label="Descrição" htmlFor={`${id}-d`}>
            <Textarea id={`${id}-d`} value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[56px]" />
          </FormField>
          <FormField label="De onde vêm os valores" htmlFor={`${id}-s`} required>
            <Select id={`${id}-s`} value={sourceKind} disabled={builtIn} onChange={(e) => setSourceKind(e.target.value as ReadjustmentIndexSource["kind"])} options={sourceOptions} />
          </FormField>
          {sourceKind === "bcb_sgs" ? (
            <FormField label="Código da série no SGS" htmlFor={`${id}-c`} required hint="Variação mensal (%) no Sistema Gerenciador de Séries do Banco Central. Ex.: 433 IPCA, 189 IGP-M, 188 INPC, 190 IGP-DI, 193 IPC-Fipe">
              <Input id={`${id}-c`} inputMode="numeric" value={seriesCode} disabled={builtIn} onChange={(e) => setSeriesCode(e.target.value.replace(/\D/g, ""))} placeholder="Ex.: 193" />
            </FormField>
          ) : null}
          <FormField label="Quando o acumulado de 12 meses for negativo" htmlFor={`${id}-neg`} required>
            <Select id={`${id}-neg`} value={negativePolicy} onChange={(e) => setNegativePolicy(e.target.value as IndexRow["negativePolicy"])} options={NEGATIVE_OPTIONS} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={!valid}>
            {index ? "Salvar" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
