import { Bot, CheckCircle2, CircleDashed, CreditCard, ExternalLink, KeyRound, Mail, MapPin, MessageCircle, PenLine, Phone, Settings2 } from "lucide-react";
import type { IntegrationKey, IntegrationState, IntegrationStatus } from "@/server/integrations/types";
import { INTEGRATION_CATEGORY_LABELS, INTEGRATION_STATE_LABELS } from "@/server/integrations/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import type { Tone } from "@/components/ui/tone";
import { cn } from "@/lib/utils";

const ICON: Record<IntegrationKey, React.ReactNode> = {
  whatsapp: <MessageCircle />,
  voip: <Phone />,
  email: <Mail />,
  assinatura: <PenLine />,
  cobranca: <CreditCard />,
  mapas: <MapPin />,
  sso: <KeyRound />,
  ia: <Bot />,
};

export const STATE_TONE: Record<IntegrationState, Tone> = { conectado: "success", nao_conectado: "neutral", verificar: "warning" };
const STATE_BADGE: Record<IntegrationState, "success" | "muted" | "warning"> = { conectado: "success", nao_conectado: "muted", verificar: "warning" };

/** Card de uma integração: estado real, o que habilita, variáveis (só nomes), fallback e onde configurar. */
export function IntegrationCard({ integration: i }: { integration: IntegrationStatus }) {
  return (
    <Card className={cn("flex h-full flex-col", i.state === "conectado" && "border-success/30")}>
      <CardContent className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <IconTile icon={ICON[i.key]} tone={i.state === "conectado" ? "success" : i.state === "verificar" ? "warning" : "neutral"} />
          <div className="min-w-0 flex-1">
            <p className="label-caps">{INTEGRATION_CATEGORY_LABELS[i.category]}</p>
            <h2 className="text-base font-semibold leading-tight">{i.name}</h2>
          </div>
          <Badge variant={STATE_BADGE[i.state]}>{INTEGRATION_STATE_LABELS[i.state]}</Badge>
        </div>
        <p className="text-xs text-muted">{i.stateReason}</p>

        <div>
          <p className="mb-1 text-xs font-medium text-foreground">O que habilita</p>
          <p className="text-sm text-muted">{i.enables}</p>
        </div>

        {i.envVars.length > 0 ? (
          <div>
            <p className="mb-1.5 text-xs font-medium text-foreground">
              Variáveis de ambiente{i.requirements.length > 1 ? ` (${i.requirements.map((r) => `${r.label}: ${r.vars.join(" + ")}${r.implemented ? "" : " — adaptador pendente"}`).join(" ou ")})` : ""}
            </p>
            <ul className="flex flex-col gap-1.5">
              {i.envVars.map((v) => (
                <li key={v.name} className="flex items-start gap-2 text-xs">
                  {v.present ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-label="presente" /> : <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-muted-light" aria-label="ausente" />}
                  <span className="min-w-0">
                    <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{v.name}</code>
                    {v.required ? null : <span className="ml-1 text-muted-light">(opcional)</span>}
                    {v.description ? <span className="block text-muted">{v.description}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className={cn("rounded-lg border px-3 py-2", i.state === "conectado" ? "border-border bg-surface-muted" : "border-warning/30 bg-warning-soft/40")}>
          <p className="text-xs font-medium text-foreground">{i.state === "conectado" ? "Fallback (se o provedor falhar)" : "Fallback em uso"}</p>
          <p className="text-xs text-muted">{i.fallback}</p>
        </div>

        <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
          <p className="flex items-start gap-1.5 text-xs text-muted">
            <Settings2 className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {i.whereToConfigure}
          </p>
          <a href={i.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 self-start text-sm font-medium text-brand-fg hover:underline">
            Documentação do provedor <ExternalLink className="size-3.5" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
