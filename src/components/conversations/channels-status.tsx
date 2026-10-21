import * as React from "react";
import { AtSign, Globe, Mail, MessageCircle, MessagesSquare, Phone, Send } from "lucide-react";
import type { ChannelHealth } from "@/server/conversations/queries";
import type { IntegrationStatus } from "@/server/integrations/types";
import { INTEGRATION_STATE_LABELS } from "@/server/integrations/types";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { cn } from "@/lib/utils";

const STATE_VARIANT: Record<IntegrationStatus["state"], "success" | "muted" | "warning"> = { conectado: "success", nao_conectado: "muted", verificar: "warning" };

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2 text-[13px]">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function ChannelCard({ title, icon, tone, status, health, webhook, note }: { title: string; icon: React.ReactNode; tone: "success" | "secondary" | "info"; status: IntegrationStatus; health?: ChannelHealth; webhook?: string; note?: string }) {
  const missing = status.envVars.filter((v) => v.required && !v.present).map((v) => v.name);
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 px-4 pb-2 pt-4">
        <div className="flex items-center gap-2.5">
          <IconTile icon={icon} tone={tone} />
          <div>
            <CardTitle className="text-[15px]">{title}</CardTitle>
            <p className="text-xs text-muted">{status.name}</p>
          </div>
        </div>
        <Badge variant={STATE_VARIANT[status.state]}>{INTEGRATION_STATE_LABELS[status.state]}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-4 pb-4 pt-0">
        <p className="text-[13px] text-muted">{status.stateReason}</p>
        <dl className="flex flex-col gap-1.5">
          {missing.length > 0 ? (
            <Line label="Falta configurar">
              <span className="break-all font-mono text-xs">{missing.join(", ")}</span>
            </Line>
          ) : null}
          {webhook ? <Line label="Webhook">{webhook}</Line> : null}
          {health ? (
            <>
              <Line label="Último aviso">{health.lastEventAt ? formatDateTime(health.lastEventAt) : "nenhum ainda"}</Line>
              <Line label="Últimas 24 h">
                {health.received24h} recebida(s) · {health.duplicates24h} repetida(s) ignorada(s) ·{" "}
                <span className={cn(health.failures24h > 0 && "font-medium text-danger-fg")}>{health.failures24h} falha(s)</span>
                {health.rejected24h > 0 ? <span className="font-medium text-danger-fg"> · {health.rejected24h} recusado(s)</span> : null}
              </Line>
            </>
          ) : null}
        </dl>
        {note ? <p className="text-xs text-muted">{note}</p> : null}
        {status.state !== "conectado" ? <p className="text-xs text-muted">Sem conexão: {status.fallback}</p> : null}
      </CardContent>
    </Card>
  );
}

/**
 * Estado real de cada canal: lido das credenciais do servidor (nunca os valores) e dos registros técnicos. Canal
 * sem conexão real não aparece como ativo; os canais das próximas fases aparecem como indisponíveis.
 */
export function ChannelsStatus({ whatsapp, email, voip, health, webhookSecured }: { whatsapp: IntegrationStatus; email: IntegrationStatus; voip: IntegrationStatus; health: ChannelHealth[]; webhookSecured: boolean }) {
  const h = (c: "whatsapp" | "email") => health.find((x) => x.channel === c);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ChannelCard
          title="WhatsApp Business"
          icon={<MessageCircle />}
          tone="success"
          status={whatsapp}
          health={h("whatsapp")}
          webhook={webhookSecured ? "assinatura da Meta conferida em todo aviso" : "sem App Secret: a assinatura da Meta não é conferida"}
          note="Só texto nesta fase: foto, áudio e documento chegam como aviso para o operador."
        />
        <ChannelCard title="E-mail" icon={<Mail />} tone="secondary" status={email} note="Envio pelo Resend. O recebimento de e-mails na Central chega numa próxima entrega." />
        <ChannelCard title="Telefonia (PABX)" icon={<Phone />} tone="info" status={voip} note="Provedor a definir. Até lá, os botões «Ligar» abrem o discador do aparelho." />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          { title: "Instagram Direct", icon: <AtSign /> },
          { title: "Messenger", icon: <MessagesSquare /> },
          { title: "Telegram", icon: <Send /> },
          { title: "Chat do site", icon: <Globe /> },
        ].map((c) => (
          <div key={c.title} className="flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3">
            <span className="text-muted [&_svg]:size-5">{c.icon}</span>
            <div>
              <p className="text-sm font-medium">{c.title}</p>
              <p className="text-xs text-muted">Integração indisponível · fase 5</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
