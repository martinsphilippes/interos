"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronRight, Circle, ExternalLink, FileText, Mail, MessageCircle, Phone, ShieldCheck } from "lucide-react";
import type { ContractPanel, PanelInteraction } from "@/server/finance/workspace";
import type { IntegrationFlags } from "@/server/integrations/types";
import { sendForSignatureAction } from "@/server/finance/actions";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { CONTRACT_STATUS_LABELS, CONTRACT_STATUS_VARIANT } from "@/components/clients/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChannelCard } from "@/components/ui/channel-card";
import { Progress } from "@/components/ui/progress";
import { RelativeTime } from "@/components/ui/relative-time";
import { cn } from "@/lib/utils";
import { contractDocumentPath, contractEmailHref } from "./contract-links";
import { ManualSignatureButton } from "./manual-signature-dialog";
import { useFinanceAction } from "./use-finance-action";
import { useOrigin } from "@/components/ui/use-origin";

const CHANNEL_LABEL: Record<PanelInteraction["channel"], string> = { whatsapp: "WhatsApp", voip: "Ligação", email: "E-mail", interno: "Interno" };

function interactionTitle(i: PanelInteraction, clientName: string): string {
  const who = i.direction === "entrada" ? `de ${clientName}` : `com ${clientName}`;
  if (i.channel === "voip") return `Ligação ${i.direction === "entrada" ? "recebida de" : "para"} ${clientName}`;
  return `${CHANNEL_LABEL[i.channel]} ${who}`;
}

function InteractionIcon({ channel }: { channel: PanelInteraction["channel"] }) {
  if (channel === "whatsapp") return <MessageCircle className="size-4 text-success-fg" aria-hidden />;
  if (channel === "voip") return <Phone className="size-4 text-info-fg" aria-hidden />;
  return <Mail className="size-4 text-secondary-fg" aria-hidden />;
}

const duration = (s?: number) => (s ? `${Math.floor(s / 60)}min ${String(s % 60).padStart(2, "0")}s` : null);

/** Painel do contrato selecionado (padrão 02): dados, assinatura, comunicação e histórico de interações. */
export function ContractSidePanel({ panel, integrations, canOperate }: { panel: ContractPanel; integrations: IntegrationFlags; canOperate: boolean }) {
  const { pending, run } = useFinanceAction();
  const origin = useOrigin();
  const signed = panel.signers.filter((s) => s.status === "assinado").length;
  const total = panel.signers.length;
  const allSigned = panel.documentGenerated && total > 0 && signed === total;
  const signatureManual = integrations.assinatura !== "conectado" || panel.signatureProvider === "manual";
  const closed = panel.status === "liberado" || panel.status === "cancelado";
  const mailHref = contractEmailHref({
    number: panel.number,
    version: panel.version,
    clientName: panel.clientName,
    documentHash: panel.documentHash,
    documentUrl: `${origin}${contractDocumentPath(panel.id)}`,
    signers: panel.signers,
  });

  const generate = () =>
    run(() => sendForSignatureAction({ contractId: panel.id }), (d) => (signatureManual ? `Documento gerado (${d.envelopeId}): aguardando assinatura — envio manual` : "Contrato enviado para assinatura"));

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/clientes/${panel.clientId}`} className="block truncate text-lg font-semibold leading-tight hover:text-brand-fg">
                {panel.clientName}
              </Link>
              <p className="text-sm text-muted">
                {panel.number} · v{panel.version}
              </p>
            </div>
            <Badge variant={CONTRACT_STATUS_VARIANT[panel.status]}>{CONTRACT_STATUS_LABELS[panel.status]}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-3 border-y border-border py-3">
            <div>
              <p className="text-xs text-muted">Valor do contrato</p>
              <p className="text-xl font-semibold tabular-nums">{formatCurrency(panel.amount)}</p>
              <p className="text-xs text-muted">{panel.amountKind === "mensal" ? `por mês${panel.setupTotal > 0 ? ` · adesão ${formatCurrency(panel.setupTotal)}` : ""}` : "valor único"}</p>
            </div>
            <div className="border-l border-border pl-3">
              <p className="text-xs text-muted">Vencimento</p>
              <p className="text-xl font-semibold tabular-nums">{panel.nextDueDate ? formatDate(panel.nextDueDate) : `Dia ${panel.billingDay}`}</p>
              <p className="text-xs text-muted">{panel.nextDueDate ? "próxima cobrança" : "sem cobrança gerada"}</p>
            </div>
          </div>

          {panel.pendingReason ? (
            <p className="flex items-start gap-2 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-xs text-danger-fg">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {panel.pendingReason}
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">{signatureManual ? "Assinatura" : "Assinatura digital"}</span>
              <span className="text-xs text-muted">
                {signed} de {total} assinatura{total === 1 ? "" : "s"} concluída{total === 1 ? "" : "s"}
              </span>
            </div>
            <Progress value={total > 0 ? (signed / total) * 100 : 0} tone={allSigned ? "success" : "warning"} size="sm" />
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                allSigned ? "border-success/35 bg-success-soft text-success-fg" : panel.documentGenerated ? "border-warning/35 bg-warning-soft text-warning-fg" : "border-border bg-surface-muted text-muted",
              )}
            >
              {allSigned ? <CheckCircle2 className="size-4" /> : <ShieldCheck className="size-4" />}
              {allSigned ? "Contrato assinado" : panel.documentGenerated ? (signatureManual ? "Aguardando assinatura — envio manual" : "Aguardando assinatura") : "Documento ainda não gerado"}
            </div>
            <ul className="flex flex-col gap-2">
              {total === 0 ? <li className="text-xs text-danger-fg">Nenhum signatário cadastrado.</li> : null}
              {panel.signers.map((s) => (
                <li key={s.email} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      {s.status === "assinado" ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden /> : <Circle className="size-4 shrink-0 text-muted-light" aria-hidden />}
                      <span className="truncate">{s.name}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted">{s.signedAt ? formatDateTime(s.signedAt) : "pendente"}</span>
                  </div>
                  {s.status === "assinado" && s.method === "manual" ? <p className="pl-6 text-xs text-muted">Registro manual · {s.evidence}</p> : null}
                  {canOperate && !closed && panel.documentGenerated && s.status !== "assinado" ? (
                    <ManualSignatureButton contractId={panel.id} contractNumber={panel.number} signer={s} label="Registrar assinatura" variant="ghost" className="ml-5 h-10 self-start md:h-8" />
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          {panel.documentHash ? (
            <p className="truncate font-mono text-[11px] text-muted-light" title={panel.documentHash}>
              {panel.documentId} · {panel.documentHash}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <Button asChild variant="outline" className="h-11 md:h-9">
              <Link href={contractDocumentPath(panel.id)}>
                <FileText /> Ver contrato
              </Link>
            </Button>
            {canOperate && panel.editable && !panel.documentGenerated ? (
              <Button onClick={generate} loading={pending} disabled={total === 0 || panel.itemsCount === 0} className="h-11 md:h-9" title={panel.itemsCount === 0 ? "Adicione itens no contrato completo" : undefined}>
                <FileText /> Gerar para assinatura
              </Button>
            ) : panel.documentGenerated && !allSigned && signatureManual ? (
              <Button asChild variant="outline" className="h-11 md:h-9">
                <a href={mailHref}>
                  <Mail /> Enviar por e-mail
                </a>
              </Button>
            ) : (
              <Button asChild variant="outline" className="h-11 md:h-9">
                <Link href={`/financeiro/contratos/${panel.id}`}>
                  <ExternalLink /> Abrir completo
                </Link>
              </Button>
            )}
          </div>
          {canOperate && panel.editable && panel.itemsCount === 0 ? (
            <p className="text-xs text-warning-fg">
              Contrato sem itens: preencha no{" "}
              <Link href={`/financeiro/contratos/${panel.id}`} className="underline">
                contrato completo
              </Link>{" "}
              antes de gerar o documento.
            </p>
          ) : null}
          <Link href={`/financeiro/contratos/${panel.id}`} className="inline-flex items-center gap-1 self-end text-sm font-medium text-brand-fg hover:underline">
            Cobranças, itens e liberação <ChevronRight className="size-4" />
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Comunicação integrada</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 pt-0 sm:grid-cols-2 xl:grid-cols-2">
          <ChannelCard channel="whatsapp" connected={integrations.whatsapp === "conectado"} actionLabel="Conversar" href={panel.whatsappUrl ?? undefined}>
            {panel.lastWhatsapp ? (
              <>
                <p>
                  Última mensagem · <RelativeTime value={panel.lastWhatsapp.at} />
                </p>
                <p className="mt-1 line-clamp-2 text-foreground/80">{panel.lastWhatsapp.body ?? "—"}</p>
              </>
            ) : (
              <p>{panel.whatsappUrl ? "Nenhuma mensagem registrada." : "Cliente sem telefone cadastrado."}</p>
            )}
          </ChannelCard>
          <ChannelCard channel="voip" connected={integrations.voip === "conectado"} actionLabel="Ligar" href={panel.telUrl ?? undefined}>
            {panel.lastCall ? (
              <>
                <p>
                  Última ligação · <RelativeTime value={panel.lastCall.at} />
                </p>
                <p className="mt-1 line-clamp-2 text-foreground/80">{[duration(panel.lastCall.durationSeconds), panel.lastCall.body].filter(Boolean).join(" · ") || "—"}</p>
              </>
            ) : (
              <p>{panel.telUrl ? "Nenhuma ligação registrada." : "Cliente sem telefone cadastrado."}</p>
            )}
          </ChannelCard>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico de interações</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {panel.interactions.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">Nenhuma interação registrada com o cliente.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {panel.interactions.map((i) => (
                <li key={i.id} className="flex gap-3 py-2.5">
                  <span className="mt-0.5">
                    <InteractionIcon channel={i.channel} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-medium">{interactionTitle(i, panel.clientName)}</p>
                      <span className="shrink-0 text-xs text-muted">
                        <RelativeTime value={i.at} />
                      </span>
                    </div>
                    {i.body ? <p className="line-clamp-2 text-xs text-muted">{i.body}</p> : null}
                    <p className="text-[11px] text-muted-light">
                      {[i.userName, duration(i.durationSeconds), i.statusLabel].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link href={`/clientes/${panel.clientId}?aba=timeline`} className="mt-2 flex items-center justify-between border-t border-border pt-3 text-sm font-medium text-brand-fg hover:underline">
            Ver todas as interações <ChevronRight className="size-4" />
          </Link>
        </CardContent>
      </Card>
    </>
  );
}
