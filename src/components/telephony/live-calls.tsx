"use client";

import * as React from "react";
import { Ear, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { startCallMonitorAction } from "@/server/telephony/monitor-actions";
import type { LiveCallRow } from "@/server/telephony/monitor";
import { CALL_MONITOR_LABELS } from "@/domain/telephony";
import { formatDurationShort } from "@/domain/conversation-history";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { MONITOR_CALL_EVENT, type MonitorCallDetail } from "./model";

/**
 * Ligações em andamento da equipe (Central de Comando). «Ouvir» prepara a ligação no servidor e pede ao softphone do
 * gerente para entrar; lá ele troca entre só ouvir, sussurrar ao atendente e entrar na ligação.
 */
export function LiveCallsPanel({ rows, canMonitor, softphone }: { rows: LiveCallRow[]; canMonitor: boolean; softphone: boolean }) {
  const [pending, startTransition] = React.useTransition();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const listen = (r: LiveCallRow) =>
    startTransition(async () => {
      const res = await startCallMonitorAction({ id: r.id });
      if (!res.ok) return void toast.error(res.error);
      window.dispatchEvent(new CustomEvent<MonitorCallDetail>(MONITOR_CALL_EVENT, { detail: { id: r.id, label: `${r.agentName} com ${r.who}` } }));
    });
  return (
    <section aria-label="Ligações em andamento" className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Ligações em andamento</h2>
        <span className="text-xs text-muted">{softphone ? "ouvir abre no seu telefone (canto da tela)" : "para ouvir, é preciso o telefone do INTEROS ativo"}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">Nenhuma ligação em andamento.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead>Atendente</TableHead>
                <TableHead>Com quem</TableHead>
                <TableHead>Fila</TableHead>
                <TableHead>Duração</TableHead>
                <TableHead className="text-right">Supervisão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm font-medium">{r.agentName}</TableCell>
                  <TableCell className="text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      {r.direction === "entrada" ? <PhoneIncoming className="size-3.5 text-muted" aria-label="Recebida" /> : <PhoneOutgoing className="size-3.5 text-muted" aria-label="Feita" />}
                      {r.who}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted">{r.queueName ?? "—"}</TableCell>
                  <TableCell className="text-sm tabular-nums">{formatDurationShort(Math.max(0, now - new Date(r.startedAt).getTime()))}</TableCell>
                  <TableCell className="text-right">
                    {r.monitoredBy ? (
                      <Badge size="sm" variant={r.mine ? "info" : "warning"}>
                        {r.mine ? "Você" : r.monitoredBy} · {CALL_MONITOR_LABELS[r.monitorMode ?? "ouvir"].toLowerCase()}
                      </Badge>
                    ) : canMonitor ? (
                      <Button size="sm" variant="outline" className="h-8" onClick={() => listen(r)} disabled={pending || !softphone}>
                        <Ear /> Ouvir
                      </Button>
                    ) : (
                      <span className="text-sm text-muted">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
