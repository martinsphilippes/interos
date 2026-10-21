"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Pause, Play, Send, Trash2 } from "lucide-react";
import { deleteReportScheduleAction, runReportScheduleNowAction, saveReportScheduleAction, toggleReportScheduleAction } from "@/server/reports/schedule-actions";
import type { ScheduleRow } from "@/server/reports/schedules";
import type { ReportKey } from "@/server/reports/definitions";
import type { ReportScheduleFrequency, ReportSchedulePeriod } from "@/domain/types";
import { FREQUENCY_LABELS, PERIOD_LABELS, WEEKDAY_LABELS, describeSchedule, periodsFor } from "@/domain/report-schedule";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";

export interface SchedulePerson {
  id: string;
  name: string;
  email: boolean;
}

/** «Agendar envio» do relatório aberto: guarda os filtros atuais (sem o período) e o período relativo escolhido. */
export function ScheduleButton({ reportKey, title, periodKind, filters, people, emailReady }: { reportKey: ReportKey; title: string; periodKind: "dia" | "mes" | "nenhum"; filters: Record<string, string>; people: SchedulePerson[]; emailReady: boolean }) {
  const router = useRouter();
  const periods = periodsFor(periodKind);
  const [open, setOpen] = React.useState(false);
  const [frequency, setFrequency] = React.useState<ReportScheduleFrequency>("semanal");
  const [weekday, setWeekday] = React.useState(1);
  const [monthDay, setMonthDay] = React.useState(1);
  const [hour, setHour] = React.useState(8);
  const [period, setPeriod] = React.useState<ReportSchedulePeriod>(periods[0]);
  const [format, setFormat] = React.useState<"xlsx" | "pdf" | "csv">("xlsx");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [search, setSearch] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const shown = people.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()));
  const fixed = Object.keys(filters).length;

  const save = () =>
    startTransition(async () => {
      const r = await saveReportScheduleAction({ reportKey, recipientIds: selected, filters, period, format, frequency, weekday, monthDay, hour });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Envio agendado");
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button variant="outline" className="h-11 md:h-9" onClick={() => setOpen(true)}>
        <CalendarClock /> Agendar envio
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agendar envio · {title}</DialogTitle>
            <DialogDescription>
              {emailReady ? "Vai por e-mail, com o arquivo anexo." : "E-mail ainda não configurado: por enquanto, quem recebe ganha uma notificação com o link."} Cada pessoa recebe o relatório com o próprio acesso.
              {fixed ? ` Os filtros aplicados agora (${fixed}) continuam valendo.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="Quando" htmlFor="rs-freq">
                <Select id="rs-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as ReportScheduleFrequency)} options={Object.entries(FREQUENCY_LABELS).map(([value, label]) => ({ value, label }))} />
              </FormField>
              {frequency === "semanal" ? (
                <FormField label="Dia da semana" htmlFor="rs-wd">
                  <Select id="rs-wd" value={String(weekday)} onChange={(e) => setWeekday(Number(e.target.value))} options={WEEKDAY_LABELS.map((label, i) => ({ value: String(i), label }))} />
                </FormField>
              ) : frequency === "mensal" ? (
                <FormField label="Dia do mês (1 a 28)" htmlFor="rs-md">
                  <Input id="rs-md" type="number" min={1} max={28} value={monthDay} onChange={(e) => setMonthDay(Number(e.target.value))} />
                </FormField>
              ) : (
                <div className="hidden sm:block" />
              )}
              <FormField label="Hora (Brasília)" htmlFor="rs-hour">
                <Select id="rs-hour" value={String(hour)} onChange={(e) => setHour(Number(e.target.value))} options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${h}h` }))} />
              </FormField>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Período do relatório" htmlFor="rs-period">
                <Select id="rs-period" value={period} onChange={(e) => setPeriod(e.target.value as ReportSchedulePeriod)} options={periods.map((p) => ({ value: p, label: PERIOD_LABELS[p] }))} />
              </FormField>
              <FormField label="Formato" htmlFor="rs-format">
                <Select
                  id="rs-format"
                  value={format}
                  onChange={(e) => setFormat(e.target.value as "xlsx" | "pdf" | "csv")}
                  options={[
                    { value: "xlsx", label: "Planilha (XLSX)" },
                    { value: "pdf", label: "PDF" },
                    { value: "csv", label: "CSV" },
                  ]}
                />
              </FormField>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Quem recebe ({selected.length})</p>
                <Input aria-label="Buscar pessoa" placeholder="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-40" />
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-border p-2">
                {shown.length === 0 ? <p className="py-3 text-center text-sm text-muted">Ninguém encontrado.</p> : null}
                {shown.map((p) => (
                  <Checkbox
                    key={p.id}
                    className="py-1"
                    checked={selected.includes(p.id)}
                    onCheckedChange={(v) => setSelected((s) => (v ? [...s, p.id] : s.filter((x) => x !== p.id)))}
                    label={p.name}
                    description={p.email ? undefined : "sem e-mail cadastrado: não recebe"}
                  />
                ))}
              </div>
              <p className="text-xs text-muted">Aparecem só as pessoas que podem ver este relatório.</p>
            </div>
            <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm">{describeSchedule({ frequency, weekday, monthDay, hour, period })}</p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={save} loading={pending} disabled={!selected.length}>
              <CalendarClock /> Agendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Envios agendados de quem está vendo (admin: todos): pausar, retomar, enviar agora e excluir. */
export function ScheduleList({ rows }: { rows: ScheduleRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [removing, setRemoving] = React.useState<ScheduleRow | null>(null);
  const run = (fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, done: (data: unknown) => string) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(done(r.data));
      router.refresh();
    });
  if (!rows.length) return null;
  return (
    <section aria-label="Envios agendados" className="flex flex-col gap-2">
      {rows.map((s) => (
        <div key={s.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {s.reportTitle} <Badge size="sm" variant="muted">{s.format}</Badge>
              {!s.active ? <Badge size="sm" variant="warning">Pausado</Badge> : null}
              {s.lastOk === false ? <Badge size="sm" variant="danger">Último envio com problema</Badge> : null}
            </p>
            <p className="text-xs text-muted">
              {s.when} · para {s.recipients.join(", ")}
              {!s.mine ? ` · agendado por ${s.ownerName}` : ""}
            </p>
            <p className="text-xs text-muted">
              {s.active ? `Próximo: ${formatDateTime(s.nextRunAt)}` : "Não envia enquanto pausado"}
              {s.lastRunAt ? ` · último: ${formatDateTime(s.lastRunAt)} (${s.lastResult ?? "—"})` : ""}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => runReportScheduleNowAction({ id: s.id }), (d) => `Enviado: ${(d as { summary: string }).summary}`)}>
              <Send /> Enviar agora
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} aria-label={s.active ? "Pausar" : "Retomar"} onClick={() => run(() => toggleReportScheduleAction({ id: s.id, active: !s.active }), () => (s.active ? "Envio pausado" : "Envio retomado"))}>
              {s.active ? <Pause /> : <Play />}
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} aria-label="Excluir" onClick={() => setRemoving(s)}>
              <Trash2 />
            </Button>
          </div>
        </div>
      ))}
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(v) => !v && setRemoving(null)}
        title="Excluir envio agendado?"
        description={removing ? `${removing.reportTitle} · ${removing.when}. Ninguém recebe mais este envio.` : undefined}
        confirmLabel="Excluir"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          const r = await deleteReportScheduleAction({ id: removing.id });
          if (!r.ok) return void toast.error(r.error);
          toast.success("Envio excluído");
          setRemoving(null);
          router.refresh();
        }}
      />
    </section>
  );
}
