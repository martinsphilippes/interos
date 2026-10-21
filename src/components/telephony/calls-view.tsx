"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCheck, Download, Headphones, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing, Voicemail } from "lucide-react";
import { markCallReturnedAction, markVoicemailHandledAction, openRecordingAction } from "@/server/telephony/actions";
import type { CallRow } from "@/server/telephony/queries";
import { formatCallDuration, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

function useParam() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return {
    get: (k: string) => sp.get(k) ?? "",
    set: (k: string, v: string) => {
      const next = new URLSearchParams(sp.toString());
      if (v) next.set(k, v);
      else next.delete(k);
      router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`, { scroll: false });
    },
  };
}

function CallIcon({ row }: { row: CallRow }) {
  if (row.voicemail) return <Voicemail className="size-4 text-secondary-fg" aria-hidden />;
  if (row.status === "perdida") return <PhoneMissed className="size-4 text-danger-fg" aria-hidden />;
  return row.direction === "entrada" ? <PhoneIncoming className="size-4 text-success-fg" aria-hidden /> : <PhoneOutgoing className="size-4 text-info-fg" aria-hidden />;
}

/** Ouvir/baixar gravação: pede o motivo (quando a política exige), registra o acesso e toca o áudio. */
export function RecordingButton({ id, requireReason, compact }: { id: string; requireReason: boolean; compact?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [src, setSrc] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const go = (action: "ouvir" | "baixar") =>
    startTransition(async () => {
      const r = await openRecordingAction({ id, action, reason: reason.trim() || undefined });
      if (!r.ok) return void toast.error(r.error);
      if (action === "baixar") window.location.assign(r.data.url);
      else setSrc(r.data.url);
    });
  return (
    <>
      <Button size={compact ? "sm" : "md"} variant="outline" className={compact ? "h-8" : undefined} onClick={() => setOpen(true)}>
        <Headphones /> Ouvir
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            setSrc(null);
            setReason("");
          }
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Gravação da ligação</DialogTitle>
            <DialogDescription>Quem ouve ou baixa fica registrado, com o motivo.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            {src ? (
              <audio controls autoPlay src={src} className="w-full" />
            ) : (
              <Textarea aria-label="Motivo" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={requireReason ? "Motivo (obrigatório): ex.: conferir o combinado com o cliente" : "Motivo (opcional)"} />
            )}
          </DialogBody>
          <DialogFooter>
            {!src ? (
              <>
                <Button variant="ghost" onClick={() => go("baixar")} loading={pending} disabled={requireReason && reason.trim().length < 5}>
                  <Download /> Baixar
                </Button>
                <Button onClick={() => go("ouvir")} loading={pending} disabled={requireReason && reason.trim().length < 5}>
                  <Headphones /> Ouvir
                </Button>
              </>
            ) : (
              <Button onClick={() => setOpen(false)}>Fechar</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Histórico de ligações: todas, só as minhas, ou perdidas sem retorno; ligar de volta e marcar retorno. */
export function CallsView({ rows, pendingCallbacks, requireReason, days, softphone }: { rows: CallRow[]; pendingCallbacks: number; requireReason: boolean; days: number; softphone: boolean }) {
  const router = useRouter();
  const p = useParam();
  const [pending, startTransition] = React.useTransition();
  const view = (p.get("ver") || "todas") as "todas" | "perdidas" | "minhas";
  const markReturned = (id: string) =>
    startTransition(async () => {
      const r = await markCallReturnedAction({ id });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Marcada como retornada");
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        className="mb-0"
        actions={
          <SegmentedControl
            size="sm"
            aria-label="Quais ligações"
            value={view}
            onChange={(v) => p.set("ver", v === "todas" ? "" : v)}
            options={[
              { value: "todas", label: "Todas" },
              { value: "perdidas", label: `Perdidas sem retorno${pendingCallbacks ? ` (${pendingCallbacks})` : ""}` },
              { value: "minhas", label: "Minhas" },
            ]}
          />
        }
      >
        <FilterField label="Direção" htmlFor="cl-dir">
          <Select
            id="cl-dir"
            value={p.get("direcao")}
            onChange={(e) => p.set("direcao", e.target.value)}
            options={[
              { value: "", label: "Recebidas e feitas" },
              { value: "entrada", label: "Recebidas" },
              { value: "saida", label: "Feitas" },
            ]}
          />
        </FilterField>
        <FilterField label="Período" htmlFor="cl-dias">
          <Select
            id="cl-dias"
            value={String(days)}
            onChange={(e) => p.set("dias", e.target.value === "30" ? "" : e.target.value)}
            options={[
              { value: "1", label: "Hoje e ontem" },
              { value: "7", label: "Últimos 7 dias" },
              { value: "30", label: "Últimos 30 dias" },
              { value: "90", label: "Últimos 90 dias" },
            ]}
          />
        </FilterField>
      </FilterBar>
      {!softphone ? <p className="text-xs text-muted">Telefonia ainda não conectada: «Ligar de volta» abre o discador do aparelho e as ligações são registradas à mão (sem gravação).</p> : null}
      {rows.length === 0 ? (
        <EmptyState icon={<PhoneCall />} title={view === "perdidas" ? "Nenhuma perdida sem retorno" : "Nenhuma ligação no período"} description="Ligações feitas pelo softphone ou registradas à mão aparecem aqui." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
          <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Quem</TableHead>
                <TableHead>Quando</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead>Duração</TableHead>
                <TableHead>Atendente · fila</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className={cn(r.needsCallback && "bg-danger-soft/30")}>
                  <TableCell>
                    <CallIcon row={r} />
                  </TableCell>
                  <TableCell>
                    {r.clientId ? (
                      <Link href={`/clientes/${r.clientId}?aba=suporte`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.name}</span>
                    )}
                    <p className="text-xs text-muted">{r.subtitle}</p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm tabular-nums">{formatDateTime(r.at)}</TableCell>
                  <TableCell>
                    <Badge size="sm" variant={r.status === "atendida" ? "success" : r.status === "perdida" ? "danger" : r.status === "em_andamento" ? "info" : "muted"}>
                      {r.statusLabel}
                    </Badge>
                    {r.manual ? <p className="mt-0.5 text-[11px] text-muted">registro manual</p> : null}
                    {r.returnedByName ? <p className="mt-0.5 text-[11px] text-success-fg">retornada por {r.returnedByName.split(" ")[0]}</p> : null}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">{r.durationSeconds ? formatCallDuration(r.durationSeconds) : "—"}</TableCell>
                  <TableCell className="text-sm">
                    {r.userName ?? <span className="text-muted">—</span>}
                    {r.queueName ? <span className="text-muted"> · {r.queueName}</span> : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1.5">
                      {r.canListen ? <RecordingButton id={r.id} requireReason={requireReason} compact /> : null}
                      {r.number ? (
                        <Button asChild size="sm" variant={r.needsCallback ? "primary" : "outline"} className="h-8">
                          <a href={`tel:${r.number}`}>
                            <PhoneCall /> {r.direction === "entrada" ? "Ligar de volta" : "Ligar"}
                          </a>
                        </Button>
                      ) : null}
                      {r.needsCallback ? (
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => markReturned(r.id)} disabled={pending} title="Já falei com o cliente por outro meio">
                          <CheckCheck /> Retornada
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/** Correio de voz: recados (pendentes primeiro), ouvir, ligar de volta e marcar como tratado. */
export function VoicemailView({ rows, pending: pendingCount, requireReason, showHandled }: { rows: CallRow[]; pending: number; requireReason: boolean; showHandled: boolean }) {
  const router = useRouter();
  const p = useParam();
  const [pending, startTransition] = React.useTransition();
  const toggle = (id: string, handled: boolean) =>
    startTransition(async () => {
      const r = await markVoicemailHandledAction({ id });
      if (!r.ok) return void toast.error(r.error);
      toast.success(handled ? "Recado reaberto" : "Recado tratado");
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">{pendingCount} recado(s) pendente(s) · últimos 30 dias</p>
        <SegmentedControl
          size="sm"
          aria-label="Quais recados"
          value={showHandled ? "todos" : "pendentes"}
          onChange={(v) => p.set("todos", v === "todos" ? "1" : "")}
          options={[
            { value: "pendentes", label: "Pendentes" },
            { value: "todos", label: "Todos" },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<Voicemail />} title={showHandled ? "Nenhum recado" : "Nenhum recado pendente"} description="Recados deixados fora do horário ou quando ninguém atendeu aparecem aqui." />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className={cn("flex flex-wrap items-center gap-3 rounded-xl border bg-surface p-3 shadow-card", r.handled ? "border-border opacity-70" : "border-secondary/40")}>
              <Voicemail className="size-5 text-secondary-fg" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {r.name} <span className="text-xs font-normal text-muted">· {r.subtitle}</span>
                </p>
                <p className="text-xs text-muted">
                  {formatDateTime(r.at)} · {r.durationSeconds ? formatCallDuration(r.durationSeconds) : "sem duração"}
                  {r.queueName ? ` · fila ${r.queueName}` : ""}
                </p>
              </div>
              {r.canListen ? <RecordingButton id={r.id} requireReason={requireReason} compact /> : <span className="text-xs text-muted">{r.recordingDeleted ? "gravação apagada (prazo)" : "sem permissão para ouvir"}</span>}
              {r.number ? (
                <Button asChild size="sm" variant="outline" className="h-8">
                  <a href={`tel:${r.number}`}>
                    <PhoneCall /> Ligar de volta
                  </a>
                </Button>
              ) : null}
              <Button size="sm" variant={r.handled ? "ghost" : "secondary"} className="h-8" onClick={() => toggle(r.id, r.handled)} disabled={pending}>
                <CheckCheck /> {r.handled ? "Reabrir" : "Tratado"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
