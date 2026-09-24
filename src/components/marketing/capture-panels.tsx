"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, List, ListChecks, Zap } from "lucide-react";
import { setAutomationRuleActive } from "@/server/automations/actions";
import { createTask } from "@/server/tasks/actions";
import { formatCurrency, formatDateKey, formatPercent } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardLink, CardTitle } from "@/components/ui/card";
import { DateInput, dateValueToIso } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { IconTile } from "@/components/ui/icon-tile";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { LeadChannelIcon } from "@/components/ui/lead-channel-icon";
import { PROSPECT_LIST_STATUS_LABELS } from "./marketing-model";
import type { CaptureAutomation, ProspectHighlight, SourcePerformance } from "./workspace-model";

// ---------------------------------------------------------------------------
// Desempenho por canal
// ---------------------------------------------------------------------------

export function ChannelPerformance({ sources, reportHref }: { sources: SourcePerformance[]; reportHref: string }) {
  const rows = sources.filter((s) => s.leads > 0);
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="text-[17px]">Desempenho por canal</CardTitle>
        <CardLink href={reportHref}>Ver relatório</CardLink>
      </CardHeader>
      {rows.length === 0 ? (
        <CardContent className="pt-0">
          <p className="rounded-lg bg-surface-muted px-3 py-6 text-center text-sm text-muted">Sem leads captados no período.</p>
        </CardContent>
      ) : (
        <div className="px-5 pb-4">
          <div className="grid grid-cols-[minmax(0,1.5fr)_2rem_minmax(0,1fr)_4.25rem] gap-2.5 border-b border-border pb-2 text-xs text-muted">
            <span>Canal</span>
            <span className="text-right">Leads</span>
            <span>Qualificação</span>
            <span className="text-right">CPL</span>
          </div>
          <ul className="flex flex-col">
            {rows.map((s) => {
              const pct = s.qualificationRate === null ? 0 : Math.round(s.qualificationRate * 100);
              return (
                <li key={s.key}>
                  <Link
                    href={s.href}
                    className="grid grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1.1fr)_4.5rem] items-center gap-3 border-b border-border/60 py-2 text-sm last:border-0 hover:bg-surface-hover/50"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <LeadChannelIcon channel={s.channel} size="xs" />
                      <span className="truncate" title={s.name}>
                        {s.name}
                      </span>
                    </span>
                    <span className="text-right tabular-nums">{s.leads}</span>
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-track">
                        <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="w-9 text-right text-xs tabular-nums text-muted">{pct}%</span>
                    </span>
                    <span className="text-right text-xs tabular-nums">{s.cpl === null ? <span className="text-muted">Orgânico</span> : formatCurrency(s.cpl)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Automação de captação
// ---------------------------------------------------------------------------

export function CaptureAutomations({ rules, canToggle }: { rules: CaptureAutomation[]; canToggle: boolean }) {
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  // Estado otimista: o switch reflete o clique na hora, antes do refresh trazer a regra atualizada.
  const [optimistic, setOptimistic] = React.useState<Record<string, boolean>>({});
  const [, startTransition] = React.useTransition();

  const toggle = (rule: CaptureAutomation, active: boolean) => {
    setPendingId(rule.id);
    setOptimistic((o) => ({ ...o, [rule.id]: active }));
    startTransition(async () => {
      const result = await setAutomationRuleActive({ id: rule.id, active });
      setPendingId(null);
      if (!result.ok) {
        setOptimistic((o) => ({ ...o, [rule.id]: !active }));
        toast.error(result.error);
        return;
      }
      toast.success(`Automação ${active ? "ativada" : "desativada"}`);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="text-[17px]">Automação de captação</CardTitle>
        <CardLink href="/admin/automacoes">Gerenciar</CardLink>
      </CardHeader>
      <CardContent className="pt-0">
        {rules.length === 0 ? (
          <p className="rounded-lg bg-surface-muted px-3 py-6 text-center text-sm text-muted">Nenhuma regra de captação cadastrada. Crie em Administração › Automações.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rules.map((r) => {
              const active = optimistic[r.id] ?? r.active;
              return (
                <li key={r.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface-muted px-3 py-2.5">
                  <IconTile icon={<Zap />} tone={active ? "brand" : "neutral"} size="xs" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={r.name}>
                      {r.name}
                    </p>
                    <p className="truncate text-xs text-muted" title={r.flow}>
                      {r.flow} · {r.runCount} execuç
                      {r.runCount === 1 ? "ão" : "ões"}
                    </p>
                  </div>
                  <Switch
                    checked={active}
                    disabled={!canToggle || pendingId === r.id}
                    onCheckedChange={(v) => toggle(r, v)}
                    aria-label={`${active ? "Desativar" : "Ativar"} ${r.name}`}
                    title={canToggle ? undefined : "Somente administradores alteram automações"}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {!canToggle && rules.length > 0 ? <p className="mt-2 text-xs text-muted">Somente administradores ativam ou desativam regras.</p> : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Prospecção ativa (lista em destaque)
// ---------------------------------------------------------------------------

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted px-3 py-2.5">
      <p className="text-xl font-semibold tabular-nums">{value.toLocaleString("pt-BR")}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

export function ProspectHighlightCard({ list, otherActiveLists }: { list: ProspectHighlight | null; otherActiveLists: number }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="text-[17px]">Prospecção ativa</CardTitle>
        <CardLink href="/marketing/prospeccao">{otherActiveLists > 0 ? `+${otherActiveLists} lista${otherActiveLists === 1 ? "" : "s"}` : "Listas"}</CardLink>
      </CardHeader>
      <CardContent className="pt-0">
        {!list ? (
          <p className="rounded-lg bg-surface-muted px-3 py-6 text-center text-sm text-muted">Nenhuma lista ativa. Crie uma em Prospecção ativa.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <IconTile icon={<List />} tone="info" size="md" />
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{list.name}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <Badge variant={list.status === "ativa" ? "success" : "muted"} size="sm">
                    {PROSPECT_LIST_STATUS_LABELS[list.status]}
                  </Badge>
                  {list.segment ? <span>Segmento: {list.segment}</span> : null}
                  {list.optOut ? (
                    <Badge variant="outline" size="sm">
                      Opt-out ativo
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Metric value={list.contacts} label="Contatos" />
              <Metric value={list.worked} label="Trabalhados" />
              <Metric value={list.interested} label="Interessados" />
              <Metric value={list.meetings} label="Reuniões" />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted">
                  Progresso geral · {list.conversions} conversõ
                  {list.conversions === 1 ? "ão" : "es"}
                </span>
                <span className="tabular-nums text-foreground">{formatPercent(list.progress / 100)} concluído</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-track">
                <div className="h-full rounded-full bg-brand" style={{ width: `${list.progress}%` }} />
              </div>
              <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-xs text-muted">
                <span className="min-w-0">Objetivo: {list.objective ?? "não definido"}</span>
                <span>Término: {list.endDate ? formatDateKey(list.endDate) : "—"}</span>
              </div>
            </div>
            {list.owners.length > 0 ? (
              <div>
                <p className="mb-1.5 text-xs text-muted">Responsáveis</p>
                <ul className="flex flex-wrap gap-3">
                  {list.owners.map((o) => (
                    <li key={o.id} className="flex items-center gap-2">
                      <Avatar name={o.name} src={o.avatarUrl} size="sm" />
                      <span className="leading-tight">
                        <span className="block text-sm">{o.name.split(" ")[0]}</span>
                        {o.jobTitle ? <span className="block text-[11px] text-muted">{o.jobTitle}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="border-brand/50 text-brand-fg" onClick={() => setOpen(true)}>
                <CalendarPlus /> Agendar disparo
              </Button>
              <Button asChild variant="outline">
                <Link href={`/marketing/prospeccao/${list.id}`}>
                  <ListChecks /> Abrir lista
                </Link>
              </Button>
            </div>
            <ScheduleDispatchDialog list={list} open={open} onOpenChange={setOpen} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** "Agendar disparo" só agenda: cria uma tarefa de marketing vinculada à lista. Nada é enviado para fora. */
function ScheduleDispatchDialog({ list, open, onOpenChange }: { list: ProspectHighlight; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [when, setWhen] = React.useState("");
  const [note, setNote] = React.useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await createTask({
        title: `Disparo da lista "${list.name}"`,
        description: [note, `Contatos pendentes: ${list.contacts - list.worked} de ${list.contacts}.`, "Disparo manual: nenhuma integração de envio está conectada."].filter(Boolean).join("\n"),
        departmentId: "marketing",
        priority: "media",
        dueAt: dateValueToIso(when),
        processType: "prospect",
        processId: list.id,
        tags: ["prospeccao", "disparo"],
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Disparo agendado como tarefa", {
        action: {
          label: "Abrir",
          onClick: () => router.push(`/tarefas?tarefa=${result.data.id}`),
        },
      });
      setWhen("");
      setNote("");
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent size="sm">
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Agendar disparo</DialogTitle>
            <DialogDescription>Cria uma tarefa de marketing para trabalhar a lista {list.name} na data escolhida. Nenhuma mensagem é enviada automaticamente.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FormField label="Quando" htmlFor="dispatch-at" required>
              <DateInput id="dispatch-at" mode="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
            </FormField>
            <FormField label="Orientação" htmlFor="dispatch-note">
              <Textarea id="dispatch-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: abordar primeiro os supermercados com mais de 5 caixas." />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} className={cn(!when && "opacity-80")}>
              Agendar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
