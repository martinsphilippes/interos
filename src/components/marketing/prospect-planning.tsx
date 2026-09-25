"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, Pencil, ShieldCheck, Target, Users } from "lucide-react";
import { updateProspectListAction } from "@/server/marketing/actions";
import { formatDateKey, formatPercent } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataList } from "@/components/ui/data-list";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import type { ProspectListRow } from "./marketing-model";

/** Planejamento da lista (período, objetivo, opt-out) com progresso, interessados, reuniões, conversões e responsáveis. */
export function ProspectPlanningCard({ list }: { list: ProspectListRow }) {
  const [open, setOpen] = React.useState(false);
  const t = list.computed;
  const progress = t.contacts > 0 ? (t.worked / t.contacts) * 100 : 0;
  const period = list.startDate || list.endDate ? `${list.startDate ? formatDateKey(list.startDate) : "—"} a ${list.endDate ? formatDateKey(list.endDate) : "—"}` : undefined;

  return (
    <Card className="mb-5">
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle>Planejamento e progresso</CardTitle>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Pencil /> Editar planejamento
        </Button>
      </CardHeader>
      <CardContent className="grid gap-5 pt-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <DataList
          labelWidth="8rem"
          items={[
            { key: "obj", icon: <Target />, label: "Objetivo", value: list.objective },
            { key: "periodo", icon: <CalendarRange />, label: "Período", value: period },
            { key: "resp", icon: <Users />, label: "Responsáveis", value: list.responsibleNames.join(", ") || undefined },
            {
              key: "optout",
              icon: <ShieldCheck />,
              label: "Opt-out",
              value: list.optOut ? <Badge variant="success" size="sm">Ativo</Badge> : list.optOut === false ? <Badge variant="warning" size="sm">Desligado</Badge> : undefined,
            },
          ]}
        />
        <div className="flex flex-col gap-3">
          <div>
            <div className="mb-1 flex justify-between text-sm">
              <span className="text-muted">Progresso geral</span>
              <span className="font-medium tabular-nums">{formatPercent(progress / 100)} concluído</span>
            </div>
            <Progress value={progress} tone="brand" />
            <p className="mt-1 text-xs text-muted">
              {t.worked} de {t.contacts} contatos trabalhados
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-2">
            {[
              ["Interessados", t.interested],
              ["Reuniões", t.meetings],
              ["Conversões", t.converted],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-lg border border-border bg-surface-muted px-3 py-2">
                <dd className="text-lg font-semibold tabular-nums">{value as number}</dd>
                <dt className="text-xs text-muted">{label}</dt>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted">Reuniões: interessados com próxima ação agendada ou contatos convertidos em oportunidade. Convertidos seguem para o fluxo comercial (lead ou oportunidade em Vendas).</p>
        </div>
      </CardContent>
      <PlanningDialog key={`${list.id}-${list.updatedAt}-${open}`} list={list} open={open} onOpenChange={setOpen} />
    </Card>
  );
}

function PlanningDialog({ list, open, onOpenChange }: { list: ProspectListRow; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState({ objective: list.objective ?? "", startDate: list.startDate ?? "", endDate: list.endDate ?? "", optOut: list.optOut ?? false, description: list.description ?? "", segment: list.segment ?? "" });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await updateProspectListAction({ listId: list.id, ...form });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Planejamento da lista atualizado");
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Planejamento da lista</DialogTitle>
            <DialogDescription>{list.name}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FormField label="Objetivo" htmlFor="pp-objective">
              <Input id="pp-objective" value={form.objective} onChange={(e) => set({ objective: e.target.value })} placeholder="Ex.: Gerar reuniões qualificadas para apresentar o TEF" />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Início" htmlFor="pp-start">
                <Input id="pp-start" type="date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
              </FormField>
              <FormField label="Término" htmlFor="pp-end">
                <Input id="pp-end" type="date" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} />
              </FormField>
            </div>
            <FormField label="Segmento" htmlFor="pp-segment">
              <Input id="pp-segment" value={form.segment} onChange={(e) => set({ segment: e.target.value })} />
            </FormField>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm">
              <span>
                Respeitar opt-out
                <span className="block text-xs text-muted">Contatos que pediram para não ser abordados ficam fora dos disparos.</span>
              </span>
              <Switch checked={form.optOut} onCheckedChange={(v) => set({ optOut: v })} aria-label="Respeitar opt-out" />
            </label>
            <FormField label="Descrição" htmlFor="pp-desc">
              <Textarea id="pp-desc" value={form.description} onChange={(e) => set({ description: e.target.value })} className="min-h-[64px]" />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
