"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowUpCircle, ChevronDown, ChevronRight, Eye, Hand, Mail, MessageCircle, MonitorPlay, Send, X } from "lucide-react";
import { escalateConversationAction, monitorConversationAction, superviseAssumeAction, whisperAction } from "@/server/conversations/supervision-actions";
import type { CommandCenter, MonitoredConversation, OperatorRow } from "@/server/conversations/supervision";
import type { OperatorState } from "@/domain/central-ops";
import { formatDurationShort } from "@/domain/conversation-history";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConversationThread } from "@/components/ui/conversation-thread";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { toThreadItems } from "./model";

const REFRESH_MS = 10_000;
const MONITOR_HEARTBEAT_MS = 60_000;
const STATE_TONE: Record<OperatorState, StatusTone> = { disponivel: "success", ocupado: "warning", pausa: "secondary", ausente: "muted", offline: "muted" };

function since(iso: string | undefined, now: number): string {
  if (!iso) return "—";
  return formatDurationShort(Math.max(0, now - new Date(iso).getTime()));
}

function Kpi({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "warning" | "danger" | "success" }) {
  return (
    <div className={cn("rounded-xl border bg-surface p-3 shadow-card", tone === "warning" ? "border-warning/50" : tone === "danger" ? "border-danger/50" : "border-border")}>
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "warning" && "text-warning-fg", tone === "danger" && "text-danger-fg", tone === "success" && "text-success-fg")}>{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}

export interface CommandCenterCaps {
  monitor: boolean;
  whisper: boolean;
  assume: boolean;
  escalate: boolean;
}

/**
 * Central de Comando: indicadores, operadores (estado, pausa, carga, conversas), filas agora com gargalos e a conversa
 * acompanhada ao vivo (sussurro, assumir, escalar). Atualiza sozinha a cada 10 s com a aba visível.
 */
export function CommandCenterView({ data, monitored, caps, queues }: { data: CommandCenter; monitored: MonitoredConversation | null; caps: CommandCenterCaps; queues: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [now, setNow] = React.useState(() => Date.now());
  const [open, setOpen] = React.useState<string | null>(null);

  React.useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
        setNow(Date.now());
      }
    };
    const t = setInterval(tick, REFRESH_MS);
    return () => clearInterval(t);
  }, [router]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`, { scroll: false });
  };

  const k = data.kpis;
  const ops = k.operators;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          Ao vivo · atualiza a cada 10 s · {data.scopeKind === "empresa" ? "toda a empresa" : "as pessoas que você lidera"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Fila" size="sm" value={sp.get("filaId") ?? ""} onChange={(e) => setParam("filaId", e.target.value || null)} options={[{ value: "", label: "Todas as filas" }, ...queues.map((q) => ({ value: q.id, label: q.name }))]} className="w-[200px]" />
          <Button asChild variant="outline" size="sm">
            <Link href="/comunicacao/supervisao/tv" target="_blank">
              <MonitorPlay /> Painel para TV
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Operadores" value={<>{ops.total} <span className="text-sm text-success-fg">{ops.disponivel} livres</span></>} hint={`${ops.ocupado} ocupados · ${ops.pausa} em pausa · ${ops.ausente + ops.offline} fora`} />
        <Kpi label="Atendimentos ativos" value={k.active} hint={`WhatsApp ${k.activeByChannel.whatsapp} · e-mail ${k.activeByChannel.email}`} />
        <Kpi label="Aguardando" value={k.waiting} tone={k.waiting > 0 ? "warning" : undefined} hint={k.oldestWaitingSince ? `mais antiga há ${since(k.oldestWaitingSince, now)}` : "ninguém esperando"} />
        <Kpi label="SLA 1ª resposta (hoje)" value={k.slaFirstResponsePct !== undefined ? `${k.slaFirstResponsePct}%` : "—"} tone={k.slaFirstResponsePct === undefined ? undefined : k.slaFirstResponsePct >= 90 ? "success" : k.slaFirstResponsePct >= 75 ? "warning" : "danger"} hint="conversas abertas hoje com SLA" />
        <Kpi label="Espera média (hoje)" value={formatDurationShort(k.avgWaitMs)} hint="até a 1ª resposta" />
        <Kpi label="Atendimento médio (hoje)" value={formatDurationShort(k.avgHandleMs)} hint="das encerradas hoje" />
      </div>

      {data.bottlenecks.length > 0 ? (
        <div role="alert" className="flex flex-col gap-1 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-fg">
          {data.bottlenecks.map((b) => (
            <p key={b} className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" aria-hidden /> Gargalo · {b}
            </p>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
        <section aria-label="Operadores" className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface shadow-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Operadores</h2>
            <span className="text-xs text-muted">clique para ver o que a pessoa está atendendo</span>
          </div>
          {data.operators.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted">Nenhum operador nas filas do seu escopo.</p> : null}
          {data.operators.length > 0 ? (
            <div className="overflow-x-auto">
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Operador</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>No estado</TableHead>
                    <TableHead>Atend.</TableHead>
                    <TableHead>Filas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.operators.map((o) => (
                    <OperatorLine key={o.id} o={o} expanded={open === o.id} onToggle={() => setOpen(open === o.id ? null : o.id)} now={now} canMonitor={caps.monitor} onMonitor={(id) => setParam("acompanhar", id)} monitoredId={monitored?.id} />
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </section>

        <section aria-label="Filas agora" className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-card">
          <h2 className="text-sm font-semibold">Filas agora</h2>
          {data.queues.length === 0 ? <p className="text-sm text-muted">Nenhuma fila.</p> : null}
          {data.queues.map((q) => (
            <div key={q.id} className="flex items-center justify-between gap-2 border-b border-border pb-2 text-sm last:border-0 last:pb-0">
              <span className="min-w-0 truncate">{q.name}</span>
              <span className="shrink-0 text-right text-xs text-muted">
                <strong className={cn("text-sm", q.waiting > 0 && q.available === 0 ? "text-danger-fg" : q.waiting > 0 ? "text-warning-fg" : "text-foreground")}>{q.waiting}</strong> esperando · {q.available}/{q.members} livres
                {q.oldestWaitingSince ? <span className="block">mais antiga há {since(q.oldestWaitingSince, now)}</span> : null}
              </span>
            </div>
          ))}
        </section>
      </div>

      {monitored ? <MonitorPanel key={monitored.id} c={monitored} caps={caps} onClose={() => setParam("acompanhar", null)} /> : null}
    </div>
  );
}

function OperatorLine({ o, expanded, onToggle, now, canMonitor, onMonitor, monitoredId }: { o: OperatorRow; expanded: boolean; onToggle: () => void; now: number; canMonitor: boolean; onMonitor: (id: string) => void; monitoredId?: string }) {
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell>
          <button type="button" aria-expanded={expanded} aria-label={expanded ? `Fechar ${o.name}` : `Ver o que ${o.name} está atendendo`} className="text-muted">
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        </TableCell>
        <TableCell>
          <span className="font-medium">{o.name}</span>
        </TableCell>
        <TableCell>
          <span className="inline-flex items-center gap-1.5 text-sm">
            <StatusDot tone={STATE_TONE[o.state]} />
            {o.stateLabel}
            {o.pauseLabel ? <span className="text-muted">· {o.pauseLabel.toLowerCase()}</span> : null}
          </span>
        </TableCell>
        <TableCell className={cn("text-sm tabular-nums", o.pauseOverdue && "font-medium text-warning-fg")}>{o.minutes !== undefined ? formatDurationShort(o.minutes * 60_000) : "—"}</TableCell>
        <TableCell className={cn("text-sm tabular-nums", o.load >= o.limit && "text-warning-fg")}>
          {o.load} / {o.limit}
        </TableCell>
        <TableCell className="max-w-[220px] truncate text-sm text-muted" title={o.queues.join(", ")}>
          {o.queues.join(", ")}
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow className="bg-surface-muted/60">
          <TableCell />
          <TableCell colSpan={5}>
            {o.conversations.length === 0 ? (
              <p className="py-1 text-sm text-muted">Nenhum atendimento aberto agora.</p>
            ) : (
              <ul className="flex flex-col gap-1 py-1">
                {o.conversations.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                    {c.channel === "whatsapp" ? <MessageCircle className="size-4 text-success-fg" aria-hidden /> : <Mail className="size-4 text-info-fg" aria-hidden />}
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-muted">{c.number}</span>
                    {c.escalated ? (
                      <Badge size="sm" variant="danger">
                        Prioridade
                      </Badge>
                    ) : null}
                    {c.awaitingReply ? <span className="text-xs text-warning-fg">cliente esperando há {since(c.waitingSince, now)}</span> : null}
                    {canMonitor ? (
                      <Button size="sm" variant={monitoredId === c.id ? "secondary" : "outline"} className="ml-auto h-8" onClick={(e) => (e.stopPropagation(), onMonitor(c.id))}>
                        <Eye /> {monitoredId === c.id ? "Acompanhando" : "Acompanhar"}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function MonitorPanel({ c, caps, onClose }: { c: MonitoredConversation; caps: CommandCenterCaps; onClose: () => void }) {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  // Registro de supervisão: abre a sessão ao abrir e mantém enquanto a tela estiver aberta na conversa.
  React.useEffect(() => {
    if (!caps.monitor) return;
    const beat = () => {
      if (document.visibilityState === "visible") void monitorConversationAction({ conversationId: c.id });
    };
    beat();
    const t = setInterval(beat, MONITOR_HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [c.id, caps.monitor]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, after?: () => void) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error ?? "Falhou");
      toast.success(ok);
      after?.();
      router.refresh();
    });

  return (
    <section aria-label="Conversa acompanhada ao vivo" className="grid gap-4 rounded-xl border border-brand/40 bg-surface p-4 shadow-card lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">
              Acompanhando: {c.assigneeName ?? "sem responsável"} · {c.name}
            </h2>
            <p className="text-xs text-muted">
              {c.number} · {c.channel === "whatsapp" ? "WhatsApp" : "E-mail"} · {c.queueName ? `fila ${c.queueName} · ` : ""}ao vivo · o cliente não vê o supervisor
            </p>
          </div>
          <Button size="icon" variant="ghost" aria-label="Parar de acompanhar" onClick={onClose}>
            <X />
          </Button>
        </div>
        <div className="max-h-[420px] overflow-y-auto rounded-lg bg-surface-muted">
          <ConversationThread items={toThreadItems(c.thread)} autoScroll className="px-3 py-2" emptyText="Nenhuma mensagem ainda." aria-label="Mensagens" />
        </div>
        {caps.whisper && c.open ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim().length < 2) return;
              run(() => whisperAction({ conversationId: c.id, body: text.trim() }), "Sussurro enviado ao operador", () => setText(""));
            }}
          >
            <Input aria-label="Orientação privada ao operador" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Orientação privada para ${c.assigneeName?.split(" ")[0] ?? "o operador"} (o cliente não recebe)`} className="flex-1 border-dashed border-warning/70" />
            <Button type="submit" variant="secondary" loading={pending} disabled={text.trim().length < 2}>
              <Send /> Sussurrar
            </Button>
          </form>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        {caps.assume && c.open ? (
          <Button variant="outline" onClick={() => run(() => superviseAssumeAction({ conversationId: c.id }), "Você assumiu o atendimento")} disabled={pending}>
            <Hand /> Assumir conversa
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link href={`/comunicacao?conversa=${c.id}`}>Abrir na Central (transferir)</Link>
        </Button>
        {caps.escalate && c.open && !c.escalated ? (
          <div className="flex flex-col gap-1.5 rounded-lg border border-border p-2">
            <Input aria-label="Motivo da prioridade" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional)" />
            <Button variant="outline" onClick={() => run(() => escalateConversationAction({ conversationId: c.id, reason }), "Atendimento escalado")} disabled={pending}>
              <ArrowUpCircle /> Marcar prioridade
            </Button>
          </div>
        ) : c.escalated ? (
          <Badge variant="danger" className="justify-center">
            Prioridade
          </Badge>
        ) : null}
        <p className="text-xs text-muted">Acompanhar, sussurrar, assumir e escalar ficam no registro de supervisão.</p>
      </div>
    </section>
  );
}
