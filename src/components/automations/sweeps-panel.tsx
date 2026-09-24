"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Play, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RelativeTime } from "@/components/ui/relative-time";
import { toast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";
import { runSweepsNow } from "@/server/automations/actions";
import type { SweepReport, SweepStatusItem } from "@/server/automations/scheduler";
import { SCHEDULE_LABELS } from "@/server/automations/schemas";
import { SWEEP_STATUS_LABELS, SWEEP_STATUS_VARIANT } from "./model";

function useRunSweeps() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<SweepReport | null>(null);
  const run = (only?: string[]) =>
    startTransition(async () => {
      const result = await runSweepsNow({ only, force: true });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const errors = result.data.items.filter((i) => i.status === "erro").length;
      if (errors > 0) toast.warning(`Varreduras executadas com ${errors} erro(s)`);
      else toast.success("Varreduras executadas");
      setReport(result.data);
      router.refresh();
    });
  return { pending, report, setReport, run };
}

function ReportDialog({ report, onClose }: { report: SweepReport | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(report)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Relatório das varreduras</DialogTitle>
          <DialogDescription>{report ? `Executado em ${formatDateTime(report.ranAt)}${report.forced ? " (forçado)" : ""}` : null}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="flex flex-col divide-y divide-border">
            {report?.items.map((item) => (
              <li key={item.key} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {item.label} {item.kind === "regra" ? <span className="text-xs font-normal text-muted">(regra agendada)</span> : null}
                  </p>
                  <p className="text-xs text-muted">{item.summary}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.durationMs !== undefined ? <span className="text-xs tabular-nums text-muted">{(item.durationMs / 1000).toFixed(1)}s</span> : null}
                  <Badge variant={SWEEP_STATUS_VARIANT[item.status]} size="sm">
                    {SWEEP_STATUS_LABELS[item.status]}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="min-h-[44px] md:min-h-0">
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Botão "Executar varreduras agora" (todas, forçado) com o relatório em diálogo. */
export function RunSweepsButton() {
  const { pending, report, setReport, run } = useRunSweeps();
  return (
    <>
      <Button variant="outline" loading={pending} onClick={() => run()} className="min-h-[44px] md:min-h-0">
        {pending ? null : <RefreshCw />} Executar varreduras agora
      </Button>
      <ReportDialog report={report} onClose={() => setReport(null)} />
    </>
  );
}

/** Situação de cada varredura nativa (frequência, última e próxima execução) com execução individual. */
export function SweepsPanel({ sweeps }: { sweeps: SweepStatusItem[] }) {
  const { pending, report, setReport, run } = useRunSweeps();
  const [running, setRunning] = useState<string | null>(null);
  const now = new Date().toISOString();
  return (
    <>
      <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {sweeps.map((s) => {
          const late = s.nextRunAt ? s.nextRunAt < now : true;
          return (
            <li key={s.key} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-xs text-muted">{s.description}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0 md:size-9"
                  aria-label={`Executar ${s.label} agora`}
                  title={`Executar ${s.label} agora`}
                  loading={pending && running === s.key}
                  disabled={pending}
                  onClick={() => {
                    setRunning(s.key);
                    run([s.key]);
                  }}
                >
                  {pending && running === s.key ? null : <Play />}
                </Button>
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <Badge variant="outline" size="sm">
                  {SCHEDULE_LABELS[s.schedule]}
                  {s.ruleIds.length > 0 ? " · por regra" : ""}
                </Badge>
                <span>
                  Última: {s.lastRunAt ? <RelativeTime value={s.lastRunAt} /> : "nunca"}
                  {s.lastStatus === "erro" ? <span className="text-danger"> (erro)</span> : null}
                </span>
                {s.nextRunAt ? <span className={late ? "text-warning-fg" : undefined}>{late ? "Vencida" : <>Próxima <RelativeTime value={s.nextRunAt} /></>}</span> : null}
              </div>
              {s.lastSummary || s.lastError ? <p className="text-xs text-foreground/80">{s.lastStatus === "erro" ? s.lastError : s.lastSummary}</p> : null}
            </li>
          );
        })}
      </ul>
      <ReportDialog report={report} onClose={() => setReport(null)} />
    </>
  );
}
