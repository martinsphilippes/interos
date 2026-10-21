"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Maximize } from "lucide-react";
import type { CommandCenter } from "@/server/conversations/supervision";
import { formatDurationShort } from "@/domain/conversation-history";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const REFRESH_MS = 15_000;

/** Painel para TV: filas e SLA em letras grandes, para a parede da equipe. Atualiza sozinho a cada 15 s. */
export function TvBoard({ data }: { data: CommandCenter }) {
  const router = useRouter();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => {
      router.refresh();
      setNow(Date.now());
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [router]);

  const k = data.kpis;
  const oldest = k.oldestWaitingSince ? formatDurationShort(now - new Date(k.oldestWaitingSince).getTime()) : null;
  const sla = k.slaFirstResponsePct;
  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Central de Atendimento · agora</h1>
        <div className="flex items-center gap-3">
          <span className="text-lg tabular-nums text-muted" suppressHydrationWarning>
            {new Date(now).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}
          </span>
          <Button variant="outline" size="sm" onClick={() => void document.documentElement.requestFullscreen?.()}>
            <Maximize /> Tela cheia
          </Button>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Big label="Aguardando" value={k.waiting} tone={k.waiting > 0 ? (oldest && now - new Date(k.oldestWaitingSince!).getTime() > 10 * 60_000 ? "danger" : "warning") : "ok"} hint={oldest ? `mais antiga há ${oldest}` : "ninguém esperando"} />
        <Big label="Em atendimento" value={k.active} tone="neutral" hint={`WhatsApp ${k.activeByChannel.whatsapp} · e-mail ${k.activeByChannel.email}`} />
        <Big label="Operadores livres" value={k.operators.disponivel} tone={k.operators.disponivel === 0 && k.waiting > 0 ? "danger" : "ok"} hint={`${k.operators.ocupado} ocupados · ${k.operators.pausa} em pausa`} />
        <Big label="SLA 1ª resposta hoje" value={sla !== undefined ? `${sla}%` : "—"} tone={sla === undefined ? "neutral" : sla >= 90 ? "ok" : sla >= 75 ? "warning" : "danger"} hint={`espera média ${formatDurationShort(k.avgWaitMs)}`} />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.queues.map((q) => (
          <div key={q.id} className={cn("flex items-center justify-between rounded-2xl border-2 px-6 py-5", q.waiting > 0 && q.available === 0 ? "border-danger/70 bg-danger-soft" : q.waiting > 0 ? "border-warning/60 bg-warning-soft" : "border-border bg-surface")}>
            <div>
              <p className="text-2xl font-semibold">{q.name}</p>
              <p className="text-base text-muted">
                {q.available} de {q.members} livres
              </p>
            </div>
            <p className="text-6xl font-bold tabular-nums">{q.waiting}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Big({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone: "ok" | "warning" | "danger" | "neutral" }) {
  return (
    <div className={cn("rounded-2xl border-2 p-6", tone === "danger" ? "border-danger/70" : tone === "warning" ? "border-warning/60" : tone === "ok" ? "border-success/50" : "border-border")}>
      <p className="text-xl text-muted">{label}</p>
      <p className={cn("mt-2 text-7xl font-bold tabular-nums", tone === "danger" && "text-danger-fg", tone === "warning" && "text-warning-fg", tone === "ok" && "text-success-fg")}>{value}</p>
      {hint ? <p className="mt-2 text-lg text-muted">{hint}</p> : null}
    </div>
  );
}
