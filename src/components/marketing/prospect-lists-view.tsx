"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Crosshair, Plus, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { formatDateKey, formatNumber, formatPercent } from "@/lib/format";
import { Switch } from "@/components/ui/switch";
import { createProspectListAction, importProspects } from "@/server/marketing/actions";
import type { ImportReport } from "@/server/marketing/service";
import { CsvInput, ImportReportView } from "./csv-import-panel";
import { PROSPECT_CSV_FIELDS, csvToRecords } from "./csv";
import { PROSPECT_LIST_STATUS_LABELS, type MarketingOptions, type ProspectListRow } from "./marketing-model";

/** Listas de prospecção com totais calculados dos contatos. */
export function ProspectListsView({ lists, options }: { lists: ProspectListRow[]; options: MarketingOptions }) {
  const [importFor, setImportFor] = React.useState<ProspectListRow | null>(null);

  if (lists.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Crosshair />} title="Nenhuma lista de prospecção" description="Crie uma lista, importe os contatos e distribua entre os vendedores." action={<NewProspectListDialog options={options} />} />
      </Card>
    );
  }

  return (
    <>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {lists.map((l) => {
          const t = l.computed;
          const worked = t.contacts > 0 ? (t.worked / t.contacts) * 100 : 0;
          return (
            <li key={l.id} className="flex flex-col rounded-lg border border-border bg-surface p-4 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/marketing/prospeccao/${l.id}`} className="block truncate font-semibold hover:underline">
                    {l.name}
                  </Link>
                  <p className="truncate text-xs text-muted">{[l.segment, l.ownerName, l.campaignName].filter(Boolean).join(" · ") || "Sem segmento"}</p>
                </div>
                <Badge variant={l.status === "ativa" ? "success" : l.status === "pausada" ? "warning" : "muted"} size="sm">
                  {PROSPECT_LIST_STATUS_LABELS[l.status]}
                </Badge>
              </div>
              {l.objective || l.startDate || l.endDate ? (
                <p className="mt-2 line-clamp-2 text-xs text-muted">
                  {l.objective ? <span className="text-foreground">Objetivo: {l.objective}</span> : null}
                  {l.startDate || l.endDate ? <span className="block">Período: {l.startDate ? formatDateKey(l.startDate) : "—"} a {l.endDate ? formatDateKey(l.endDate) : "—"}</span> : null}
                </p>
              ) : null}
              <dl className="mt-3 grid grid-cols-5 gap-1 text-center">
                {[
                  ["Contatos", t.contacts],
                  ["Trabalh.", t.worked],
                  ["Interess.", t.interested],
                  ["Reuniões", t.meetings],
                  ["Convers.", t.converted],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <dt className="text-[11px] text-muted">{label}</dt>
                    <dd className="text-lg font-semibold tabular-nums">{formatNumber(value as number)}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-xs text-muted">
                  <span>Progresso</span>
                  <span className="tabular-nums">
                    {t.worked} de {t.contacts} trabalhados · conversão {formatPercent(t.contacts ? t.converted / t.contacts : null)}
                  </span>
                </div>
                <Progress value={worked} size="sm" tone="brand" />
                {l.responsibleNames.length ? <p className="mt-2 truncate text-xs text-muted">Responsáveis: {l.responsibleNames.map((n) => n.split(" ")[0]).join(", ")}</p> : null}
                {l.optOut ? (
                  <Badge variant="outline" size="sm" className="mt-2">
                    Opt-out ativo
                  </Badge>
                ) : null}
              </div>
              <div className="mt-4 flex gap-2">
                <Button variant="outline" size="sm" className="h-11 flex-1 md:h-8" onClick={() => setImportFor(l)}>
                  <Upload /> Importar contatos
                </Button>
                <Button asChild size="sm" className="h-11 flex-1 md:h-8">
                  <Link href={`/marketing/prospeccao/${l.id}`}>
                    Abrir <ChevronRight />
                  </Link>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <ImportProspectsDialog list={importFor} onClose={() => setImportFor(null)} />
    </>
  );
}

export function NewProspectListDialog({ options }: { options: MarketingOptions }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const EMPTY_FORM = { name: "", description: "", segment: "", ownerId: "", campaignId: "", objective: "", startDate: "", endDate: "", optOut: true };
  const [form, setForm] = React.useState(EMPTY_FORM);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await createProspectListAction({ ...form, ownerId: form.ownerId || undefined, campaignId: form.campaignId || undefined });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Lista criada. Agora importe os contatos.");
      setOpen(false);
      setForm(EMPTY_FORM);
      router.push(`/marketing/prospeccao/${result.data.id}?importar=1`);
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> Nova lista
      </Button>
      <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
        <DialogContent>
          <form onSubmit={submit} className="flex min-h-0 flex-col">
            <DialogHeader>
              <DialogTitle>Nova lista de prospecção</DialogTitle>
              <DialogDescription>Os contatos importados herdam o responsável da lista; depois você pode redistribuir.</DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-4">
              <FormField label="Nome" htmlFor="pl-name" required>
                <Input id="pl-name" value={form.name} onChange={(e) => set({ name: e.target.value })} required minLength={3} placeholder="Ex.: Farmácias do Crato sem TEF" />
              </FormField>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Segmento" htmlFor="pl-segment">
                  <Input id="pl-segment" value={form.segment} onChange={(e) => set({ segment: e.target.value })} placeholder="Ex.: farmácia" />
                </FormField>
                <FormField label="Responsável" htmlFor="pl-owner">
                  <Select id="pl-owner" value={form.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
                    <option value="">Eu mesmo</option>
                    {options.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>
              <FormField label="Campanha" htmlFor="pl-campaign">
                <Select id="pl-campaign" value={form.campaignId} onChange={(e) => set({ campaignId: e.target.value })}>
                  <option value="">Sem campanha</option>
                  {options.campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Objetivo" htmlFor="pl-objective">
                <Input id="pl-objective" value={form.objective} onChange={(e) => set({ objective: e.target.value })} placeholder="Ex.: Gerar reuniões qualificadas para apresentar o TEF" />
              </FormField>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Início" htmlFor="pl-start">
                  <Input id="pl-start" type="date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
                </FormField>
                <FormField label="Término" htmlFor="pl-end">
                  <Input id="pl-end" type="date" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} />
                </FormField>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm">
                <span>
                  Respeitar opt-out
                  <span className="block text-xs text-muted">Contatos que pediram para não ser abordados ficam fora dos disparos.</span>
                </span>
                <Switch checked={form.optOut} onCheckedChange={(v) => set({ optOut: v })} aria-label="Respeitar opt-out" />
              </label>
              <FormField label="Descrição" htmlFor="pl-desc">
                <Textarea id="pl-desc" value={form.description} onChange={(e) => set({ description: e.target.value })} className="min-h-[64px]" placeholder="De onde veio a base, critérios, abordagem…" />
              </FormField>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" loading={pending}>
                Criar lista
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

const EXAMPLE = `nome;empresa;telefone;e-mail;cidade
Carlos Pereira;Supermercado São José;(88) 99811-2233;;Juazeiro do Norte
Ana Ribeiro;Mercantil Popular;88997654321;ana@mercantilpopular.com.br;Crato`;

export function ImportProspectsDialog({ list, onClose }: { list: Pick<ProspectListRow, "id" | "name"> | null; onClose: () => void }) {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [report, setReport] = React.useState<ImportReport | null>(null);
  const [pending, startTransition] = React.useTransition();
  const parsed = React.useMemo(() => (text.trim() ? csvToRecords(text, PROSPECT_CSV_FIELDS) : null), [text]);
  const missing = parsed !== null && !parsed.recognized.includes("nome") && !parsed.recognized.includes("empresa");

  const close = () => {
    if (pending) return;
    setText("");
    setReport(null);
    onClose();
  };

  const submit = () => {
    if (!list || !parsed) return;
    startTransition(async () => {
      const result = await importProspects({ listId: list.id, rows: parsed.rows });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setReport(result.data);
      toast.success(`${result.data.created.length} contato(s) importado(s)`);
      router.refresh();
    });
  };

  return (
    <Dialog open={list !== null} onOpenChange={(v) => !v && close()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Importar contatos</DialogTitle>
          <DialogDescription>Lista “{list?.name}”. Colunas: nome, empresa, telefone, e-mail, cidade. Telefones e e-mails repetidos na lista são ignorados.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3 pb-4">
          {report ? (
            <ImportReportView report={report} />
          ) : (
            <>
              <CsvInput value={text} onChange={setText} example={EXAMPLE} />
              {parsed ? (
                <p className={missing ? "text-sm text-danger" : "text-sm text-muted"}>
                  {missing ? "O cabeçalho precisa ter a coluna “nome” ou “empresa”." : `${parsed.rows.length} linha(s) · colunas reconhecidas: ${parsed.recognized.join(", ")}`}
                </p>
              ) : null}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {report ? (
            <Button onClick={close}>Concluir</Button>
          ) : (
            <>
              <Button variant="outline" onClick={close} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={submit} loading={pending} disabled={!parsed || parsed.rows.length === 0 || missing}>
                Importar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
