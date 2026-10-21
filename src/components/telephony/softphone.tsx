"use client";

import * as React from "react";
import type { Call, Device } from "@twilio/voice-sdk";
import { ArrowRightLeft, Ear, Eye, Grid3x3, Mic, MicOff, Phone, PhoneIncoming, PhoneOff, Settings2, Users, X } from "lucide-react";
import { claimCallAction, transferCallAction, transferTargetsAction } from "@/server/telephony/actions";
import { callMonitorNoticeAction, setCallMonitorModeAction, stopCallMonitorAction } from "@/server/telephony/monitor-actions";
import type { MonitorNotice } from "@/server/telephony/monitor";
import type { CallMonitorMode } from "@/domain/types";
import { CALL_MONITOR_LABELS } from "@/domain/telephony";
import { MONITOR_CALL_EVENT, type MonitorCallDetail } from "./model";
import { CALL_EVENT, setSoftphoneReady, type CallRequest } from "./softphone-bridge";
import { displayPhone } from "@/domain/phone";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusDot } from "@/components/ui/status-dot";
import { toast } from "@/components/ui/toast";

type Status = "carregando" | "pronto" | "erro";
interface ActiveCall {
  call: Call;
  direction: "entrada" | "saida";
  number: string;
  /** Ligação principal (registro e transferência). */
  parentCallSid?: string;
  startedAt?: number;
  muted: boolean;
  /** Ligação do gerente na supervisão de outra ligação. */
  monitor?: { id: string; label: string; mode: CallMonitorMode };
}

const NOTICE_POLL_MS = 5_000;
const MODE_ICON: Record<CallMonitorMode, React.ComponentType<{ className?: string }>> = { ouvir: Ear, sussurrar: Eye, intervir: Users };

async function fetchToken(): Promise<string> {
  const res = await fetch("/api/voice/token", { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; token?: string; error?: string } | null;
  if (!res.ok || !body?.token) throw new Error(body?.error ?? "Telefonia indisponível");
  return body.token;
}

function useTicker(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Softphone da Central (Twilio Voice no navegador). Aparece só com a telefonia configurada e a permissão de ligar.
 * Recebe as ligações das filas (quem tem ramal e está online), liga pelo discador ou por qualquer link «tel:» do
 * INTEROS, e na ligação: mudo, teclado, transferir e desligar. Primeiro uso: liberar microfone e notificações e
 * testar microfone e fone. Supervisão: o gerente entra pela Central de Comando (ouvir, sussurrar, entrar) e o
 * atendente vê, na própria ligação, quem está acompanhando.
 */
export function Softphone() {
  const deviceRef = React.useRef<Device | null>(null);
  const [status, setStatus] = React.useState<Status>("carregando");
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [dial, setDial] = React.useState("");
  const [incoming, setIncoming] = React.useState<Call | null>(null);
  const [active, setActive] = React.useState<ActiveCall | null>(null);
  const [keypad, setKeypad] = React.useState(false);
  const [testOpen, setTestOpen] = React.useState(false);
  const [transferOpen, setTransferOpen] = React.useState(false);
  const [needsPermission, setNeedsPermission] = React.useState(false);
  const [notice, setNotice] = React.useState<MonitorNotice | null>(null);
  const [modePending, startModeTransition] = React.useTransition();
  const now = useTicker(Boolean(active?.startedAt));

  const attach = React.useCallback((call: Call, base: Omit<ActiveCall, "call" | "muted">) => {
    setActive({ ...base, call, muted: false });
    call.on("accept", () => setActive((a) => (a && a.call === call ? { ...a, startedAt: Date.now(), parentCallSid: a.parentCallSid ?? call.parameters.CallSid } : a)));
    call.on("disconnect", () => setActive((a) => (a?.call === call ? null : a)));
    call.on("cancel", () => setActive((a) => (a?.call === call ? null : a)));
    call.on("reject", () => setActive((a) => (a?.call === call ? null : a)));
    call.on("error", (e: { message?: string }) => toast.error(`Ligação: ${e.message ?? "falha"}`));
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ Device: DeviceClass }, token] = await Promise.all([import("@twilio/voice-sdk"), fetchToken()]);
        if (cancelled) return;
        const device = new DeviceClass(token, { closeProtection: "Há uma ligação em andamento. Sair mesmo assim?" });
        device.on("registered", () => setStatus("pronto"));
        device.on("error", (e: { message?: string }) => {
          setError(e.message ?? "Erro na telefonia");
          setStatus("erro");
        });
        device.on("incoming", (call: Call) => {
          setIncoming(call);
          setOpen(true);
          call.on("cancel", () => setIncoming((c) => (c === call ? null : c)));
          call.on("disconnect", () => setIncoming((c) => (c === call ? null : c)));
          if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
            new Notification("Ligação recebida", { body: displayPhone(call.customParameters.get("from") ?? call.parameters.From) || "Número oculto" });
          }
        });
        device.on("tokenWillExpire", async () => {
          try {
            device.updateToken(await fetchToken());
          } catch {
            setStatus("erro");
          }
        });
        deviceRef.current = device;
        await device.register();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Telefonia indisponível");
          setStatus("erro");
        }
      }
    })();
    // Primeiro uso: microfone e notificações ainda não liberados.
    (async () => {
      const notif = typeof Notification !== "undefined" && Notification.permission === "default";
      let mic = false;
      try {
        mic = (await navigator.permissions.query({ name: "microphone" as PermissionName })).state === "prompt";
      } catch {
        mic = false;
      }
      if (!cancelled) setNeedsPermission(notif || mic);
    })();
    return () => {
      cancelled = true;
      deviceRef.current?.destroy();
      deviceRef.current = null;
    };
  }, []);

  const call = React.useCallback(
    async (raw: string, conversationId?: string) => {
      const device = deviceRef.current;
      const number = raw.trim();
      if (!device || status !== "pronto") return void toast.error("Telefone ainda não está pronto");
      if (active) return void toast.error("Já há uma ligação em andamento");
      if (number.replace(/\D/g, "").length < 8) return void toast.error("Digite o número com DDD");
      try {
        // Ligação a partir de uma conversa da Central: o servidor registra a ligação na conversa.
        const c = await device.connect({ params: { To: number, ...(conversationId ? { conversation: conversationId } : {}) } });
        attach(c, { direction: "saida", number });
        setOpen(true);
        setDial("");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível ligar");
      }
    },
    [active, attach, status],
  );

  // As telas sabem se dá para ligar pelo INTEROS (senão o botão «Ligar» usa o telefone do aparelho).
  React.useEffect(() => {
    setSoftphoneReady(status === "pronto");
    return () => setSoftphoneReady(false);
  }, [status]);

  // Botão «Ligar» da conversa da Central.
  React.useEffect(() => {
    const onCall = (e: Event) => {
      const detail = (e as CustomEvent<CallRequest>).detail;
      if (detail?.number) void call(detail.number, detail.conversationId);
    };
    window.addEventListener(CALL_EVENT, onCall);
    return () => window.removeEventListener(CALL_EVENT, onCall);
  }, [call]);

  // Central de Comando → entrar na supervisão de uma ligação (o servidor já preparou a conferência).
  React.useEffect(() => {
    const onMonitor = (e: Event) => {
      const detail = (e as CustomEvent<MonitorCallDetail>).detail;
      const device = deviceRef.current;
      if (!detail?.id) return;
      if (!device || status !== "pronto") return void toast.error("Telefone ainda não está pronto");
      if (active) return void toast.error("Encerre a ligação atual para acompanhar outra");
      void device
        .connect({ params: { monitor: detail.id } })
        .then((c) => {
          attach(c, { direction: "saida", number: "", monitor: { id: detail.id, label: detail.label, mode: "ouvir" } });
          setOpen(true);
        })
        .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Não foi possível entrar na ligação"));
    };
    window.addEventListener(MONITOR_CALL_EVENT, onMonitor);
    return () => window.removeEventListener(MONITOR_CALL_EVENT, onMonitor);
  }, [active, attach, status]);

  // Atendente: mostra quando um gerente está na ligação (e em que modo).
  const watchSid = active && !active.monitor && active.startedAt ? active.parentCallSid : undefined;
  React.useEffect(() => {
    if (!watchSid) return;
    let alive = true;
    const check = () => void callMonitorNoticeAction({ callSid: watchSid }).then((r) => alive && setNotice(r.ok ? r.data : null));
    check();
    const t = setInterval(check, NOTICE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
      setNotice(null);
    };
  }, [watchSid]);

  const setMode = (mode: CallMonitorMode) => {
    const m = active?.monitor;
    if (!m || m.mode === mode) return;
    startModeTransition(async () => {
      const r = await setCallMonitorModeAction({ id: m.id, mode });
      if (!r.ok) return void toast.error(r.error);
      setActive((a) => (a?.monitor ? { ...a, monitor: { ...a.monitor, mode } } : a));
    });
  };

  const hangUp = () => {
    if (!active) return;
    const m = active.monitor;
    active.call.disconnect();
    if (m) void stopCallMonitorAction({ id: m.id });
  };

  // Qualquer link «tel:» do INTEROS liga pelo softphone quando ele está pronto.
  React.useEffect(() => {
    if (status !== "pronto") return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href^="tel:"]') as HTMLAnchorElement | null;
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      void call(decodeURIComponent(a.getAttribute("href")!.slice(4)));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [call, status]);

  const accept = () => {
    if (!incoming) return;
    const parentCallSid = incoming.customParameters.get("parentCallSid");
    incoming.accept();
    attach(incoming, { direction: "entrada", number: incoming.customParameters.get("from") ?? incoming.parameters.From ?? "", parentCallSid });
    setActive((a) => (a ? { ...a, startedAt: Date.now() } : a));
    setIncoming(null);
    if (parentCallSid) void claimCallAction({ callSid: parentCallSid });
  };

  const requestPermissions = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      toast.error("O navegador bloqueou o microfone. Libere nas configurações do site.");
    }
    if (typeof Notification !== "undefined" && Notification.permission === "default") await Notification.requestPermission();
    setNeedsPermission(false);
  };

  const label = status === "pronto" ? (active ? "Em ligação" : "Telefone") : status === "carregando" ? "Conectando…" : "Telefone indisponível";

  return (
    <>
      <div className="fixed bottom-[calc(var(--spacing-mobile-nav,0px)+env(safe-area-inset-bottom)+12px)] right-4 z-40 flex flex-col items-end gap-2 md:bottom-4">
        {open ? (
          <section aria-label="Telefone" className="w-[320px] rounded-2xl border border-border bg-surface p-3 shadow-pop">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium">
                <StatusDot tone={status === "pronto" ? "success" : status === "erro" ? "danger" : "warning"} /> {label}
              </span>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="size-8" aria-label="Testar microfone e fone" onClick={() => setTestOpen(true)}>
                  <Settings2 />
                </Button>
                <Button size="icon" variant="ghost" className="size-8" aria-label="Fechar telefone" onClick={() => setOpen(false)}>
                  <X />
                </Button>
              </div>
            </div>
            {error && status === "erro" ? <p className="mb-2 text-xs text-danger-fg">{error}</p> : null}
            {needsPermission ? (
              <div className="mb-2 rounded-lg border border-info/40 bg-info-soft p-2 text-xs">
                Para atender pelo navegador, libere o microfone e as notificações.
                <Button size="sm" variant="outline" className="mt-1.5 h-8 w-full" onClick={requestPermissions}>
                  Liberar microfone e notificações
                </Button>
              </div>
            ) : null}

            {incoming ? (
              <div className="flex flex-col gap-2 rounded-xl border border-success/50 bg-success-soft p-3" role="alert">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <PhoneIncoming className="size-4" aria-hidden /> Ligação recebida
                </p>
                <p className="text-lg font-semibold tabular-nums">{displayPhone(incoming.customParameters.get("from") ?? incoming.parameters.From) || "Número oculto"}</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="success" onClick={accept}>
                    <Phone /> Atender
                  </Button>
                  <Button variant="outline" onClick={() => (incoming.reject(), setIncoming(null))}>
                    Recusar
                  </Button>
                </div>
              </div>
            ) : active?.monitor ? (
              <div className="flex flex-col gap-2">
                <div className="rounded-xl bg-surface-muted p-3">
                  <p className="text-xs text-muted">Supervisão da ligação</p>
                  <p className="text-sm font-semibold">{active.monitor.label}</p>
                  <p className="text-sm tabular-nums text-muted">{active.startedAt ? `${CALL_MONITOR_LABELS[active.monitor.mode]} · ${clock(now - active.startedAt)}` : "entrando…"}</p>
                </div>
                <div role="radiogroup" aria-label="Modo da supervisão" className="grid grid-cols-3 gap-1.5">
                  {(["ouvir", "sussurrar", "intervir"] as const).map((mode) => {
                    const Icon = MODE_ICON[mode];
                    return (
                      <Button key={mode} role="radio" aria-checked={active.monitor!.mode === mode} variant={active.monitor!.mode === mode ? "secondary" : "outline"} size="sm" className="h-auto flex-col gap-0.5 py-2 text-xs" disabled={modePending || !active.startedAt} onClick={() => setMode(mode)}>
                        <Icon className="size-4" />
                        {mode === "ouvir" ? "Só ouvir" : mode === "sussurrar" ? "Sussurrar" : "Entrar"}
                      </Button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted">Sussurrar: só o atendente ouve você. Entrar: o cliente também ouve. O atendente vê que você está na ligação.</p>
                <Button variant="destructive" onClick={hangUp}>
                  <PhoneOff /> Sair da ligação
                </Button>
              </div>
            ) : active ? (
              <div className="flex flex-col gap-2">
                {notice ? (
                  <p role="status" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-2.5 py-2 text-xs text-warning-fg">
                    <Eye className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {notice.text}
                  </p>
                ) : null}
                <div className="rounded-xl bg-surface-muted p-3">
                  <p className="text-xs text-muted">{active.direction === "entrada" ? "Recebida" : "Ligando para"}</p>
                  <p className="text-lg font-semibold tabular-nums">{displayPhone(active.number) || active.number}</p>
                  <p className="text-sm tabular-nums text-muted">{active.startedAt ? clock(now - active.startedAt) : "chamando…"}</p>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <Button
                    variant={active.muted ? "secondary" : "outline"}
                    size="icon"
                    className="h-11 w-full"
                    aria-label={active.muted ? "Tirar do mudo" : "Mudo"}
                    onClick={() => {
                      active.call.mute(!active.muted);
                      setActive({ ...active, muted: !active.muted });
                    }}
                  >
                    {active.muted ? <MicOff /> : <Mic />}
                  </Button>
                  <Button variant={keypad ? "secondary" : "outline"} size="icon" className="h-11 w-full" aria-label="Teclado" onClick={() => setKeypad((k) => !k)}>
                    <Grid3x3 />
                  </Button>
                  <Button variant="outline" size="icon" className="h-11 w-full" aria-label="Transferir" disabled={active.direction !== "entrada" || !active.parentCallSid} title={active.direction !== "entrada" ? "Transferência só para ligações recebidas" : undefined} onClick={() => setTransferOpen(true)}>
                    <ArrowRightLeft />
                  </Button>
                  <Button variant="destructive" size="icon" className="h-11 w-full" aria-label="Desligar" onClick={hangUp}>
                    <PhoneOff />
                  </Button>
                </div>
                {keypad ? <Keypad onPress={(d) => active.call.sendDigits(d)} /> : null}
              </div>
            ) : (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void call(dial);
                }}
              >
                <Input aria-label="Número para ligar" inputMode="tel" value={dial} onChange={(e) => setDial(e.target.value)} placeholder="(88) 99999-0000" disabled={status !== "pronto"} />
                <Button type="submit" variant="success" size="icon" aria-label="Ligar" disabled={status !== "pronto"}>
                  <Phone />
                </Button>
              </form>
            )}
          </section>
        ) : null}
        <Button
          variant={incoming ? "success" : active ? "secondary" : "outline"}
          className={cn("h-12 rounded-full px-4 shadow-pop", incoming && "animate-pulse")}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={incoming ? "Ligação recebida: abrir o telefone" : "Telefone"}
        >
          {active?.monitor ? <Ear /> : <Phone />} {incoming ? "Atender" : active?.startedAt ? clock(now - active.startedAt) : "Telefone"}
        </Button>
      </div>
      <AudioTestDialog open={testOpen} onOpenChange={setTestOpen} onInputDevice={(id) => void deviceRef.current?.audio?.setInputDevice(id).catch(() => undefined)} />
      {active?.parentCallSid ? <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} callSid={active.parentCallSid} /> : null}
    </>
  );
}

function Keypad({ onPress }: { onPress: (digit: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((d) => (
        <Button key={d} variant="outline" className="h-10 text-base font-semibold" onClick={() => onPress(d)}>
          {d}
        </Button>
      ))}
    </div>
  );
}

/** Teste de microfone (nível ao vivo) e de fone (bipe), no primeiro uso ou quando algo não funciona. */
function AudioTestDialog({ open, onOpenChange, onInputDevice }: { open: boolean; onOpenChange: (v: boolean) => void; onInputDevice: (deviceId: string) => void }) {
  const [level, setLevel] = React.useState(0);
  const [micError, setMicError] = React.useState<string | null>(null);
  const [inputs, setInputs] = React.useState<MediaDeviceInfo[]>([]);
  const [inputId, setInputId] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: inputId ? { deviceId: { exact: inputId } } : true });
        setMicError(null);
        setInputs((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput"));
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          setLevel(Math.min(100, Math.round((peak / 128) * 160)));
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setMicError("Sem acesso ao microfone: libere nas configurações do site (cadeado ao lado do endereço).");
      }
    })();
    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  }, [open, inputId]);

  const beep = () => {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 660;
    osc.connect(ctx.destination);
    osc.start();
    setTimeout(() => (osc.stop(), void ctx.close()), 600);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Testar microfone e fone</DialogTitle>
          <DialogDescription>Fale algo: a barra deve mexer. Depois toque o bipe para ouvir no fone.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {inputs.length > 1 ? (
            <Select
              aria-label="Microfone"
              value={inputId}
              onChange={(e) => {
                setInputId(e.target.value);
                if (e.target.value) onInputDevice(e.target.value);
              }}
              options={[{ value: "", label: "Microfone padrão" }, ...inputs.map((d) => ({ value: d.deviceId, label: d.label || "Microfone" }))]}
            />
          ) : null}
          {micError ? <p className="text-sm text-danger-fg">{micError}</p> : null}
          <div className="h-3 overflow-hidden rounded-full bg-track" role="meter" aria-label="Nível do microfone" aria-valuenow={level} aria-valuemin={0} aria-valuemax={100}>
            <div className={cn("h-full rounded-full transition-[width] duration-75", level > 15 ? "bg-success" : "bg-muted")} style={{ width: `${level}%` }} />
          </div>
          <Button variant="outline" onClick={beep}>
            Tocar bipe no fone
          </Button>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Pronto</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Transferir ligação recebida: para o ramal de quem está disponível ou um número externo (transferência direta). */
function TransferDialog({ open, onOpenChange, callSid }: { open: boolean; onOpenChange: (v: boolean) => void; callSid: string }) {
  const [targets, setTargets] = React.useState<{ id: string; name: string; extension: string }[]>([]);
  const [userId, setUserId] = React.useState("");
  const [number, setNumber] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  React.useEffect(() => {
    if (!open) return;
    void transferTargetsAction().then((r) => setTargets(r.ok ? r.data : []));
  }, [open]);
  const submit = () =>
    startTransition(async () => {
      const r = await transferCallAction({ callSid, toUserId: userId || undefined, toNumber: userId ? undefined : number || undefined });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Ligação transferida");
      onOpenChange(false);
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Transferir ligação</DialogTitle>
          <DialogDescription>A ligação passa a tocar no destino e sai do seu telefone.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Select
            aria-label="Ramal"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            options={[{ value: "", label: targets.length ? "Escolha quem vai receber…" : "Ninguém disponível com ramal" }, ...targets.map((t) => ({ value: t.id, label: `${t.name} · ramal ${t.extension}` }))]}
          />
          <p className="text-center text-xs text-muted">ou</p>
          <Input aria-label="Número externo" inputMode="tel" value={number} onChange={(e) => (setNumber(e.target.value), setUserId(""))} placeholder="Número externo com DDD" />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={!userId && number.replace(/\D/g, "").length < 8}>
            <ArrowRightLeft /> Transferir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
