"use client";

import * as React from "react";
import Link from "next/link";
import { BellRing, CheckCircle2, FileText } from "lucide-react";
import type { SignatureRow } from "@/server/finance/queries";
import type { IntegrationFlags } from "@/server/integrations/types";
import { sendForSignatureAction, sendSignatureReminderAction } from "@/server/finance/actions";
import { SIGNER_STATUS_LABELS } from "@/server/finance/schemas";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { CONTRACT_STATUS_LABELS, CONTRACT_STATUS_VARIANT } from "@/components/clients/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { contractDocumentPath, reminderEmailHref } from "./contract-links";
import { ManualSignatureButton } from "./manual-signature-dialog";
import { useFinanceAction } from "./use-finance-action";
import { RelativeTime } from "@/components/ui/relative-time";

/** Tom do tempo de espera: até 2 dias ok, até 5 atenção, acima crítico. */
function waitingTone(days: number): string {
  if (days <= 2) return "text-muted";
  if (days <= 5) return "text-warning-fg";
  return "text-danger-fg";
}

/**
 * Contratos aguardando assinatura (ou geração do documento): signatários pendentes, espera, lembretes e
 * ações. Sem provedor de assinatura: lembrete pelo e-mail do usuário e assinatura registrada com evidência.
 */
export function SignaturesList({ rows, mode, canOperate, integrations }: { rows: SignatureRow[]; mode: "waiting" | "toSend"; canOperate: boolean; integrations: IntegrationFlags }) {
  const emailConnected = integrations.email === "conectado";
  const { pending, run } = useFinanceAction();
  const [busy, setBusy] = React.useState<string | null>(null);
  const act = async (key: string, fn: () => Promise<boolean>) => {
    setBusy(key);
    await fn();
    setBusy(null);
  };

  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <Card key={r.contractId} className="p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/financeiro/contratos/${r.contractId}`} className="font-semibold hover:text-brand">
                  {r.clientName}
                </Link>
                <Badge variant={CONTRACT_STATUS_VARIANT[r.status]} size="sm">
                  {CONTRACT_STATUS_LABELS[r.status]}
                </Badge>
              </div>
              <p className="text-xs text-muted">
                {r.number} v{r.version} · {formatCurrency(r.monthlyTotal)}/mês{r.ownerName ? ` · ${r.ownerName}` : ""}
              </p>
            </div>
            <div className="text-sm md:text-right">
              <p className={cn("font-medium tabular-nums", waitingTone(r.daysWaiting))}>
                {r.daysWaiting === 0 ? "Hoje" : `${r.daysWaiting} dia(s)`} {mode === "waiting" ? "aguardando" : "sem documento"}
              </p>
              <p className="text-xs text-muted">
                {mode === "waiting" ? (r.sentAt ? `Documento gerado em ${formatDateTime(r.sentAt)}` : "Geração anterior ao histórico") : `${r.signers.length} signatário(s) cadastrado(s)`}
                {r.remindersSent > 0 ? <> · {r.remindersSent} lembrete(s), último <RelativeTime value={r.lastReminderAt} /></> : mode === "waiting" ? " · nenhum lembrete" : ""}
              </p>
            </div>
          </div>

          {mode === "waiting" ? (
            <ul className="mt-3 flex flex-col divide-y divide-border rounded-lg border border-border">
              {r.signers.map((s) => (
                <li key={s.email} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm">
                      {s.status === "assinado" ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : null}
                      <span className="font-medium">{s.name}</span>
                      <span className="text-xs text-muted">· {s.role}</span>
                    </p>
                    <p className="truncate text-xs text-muted">
                      {s.email} · {SIGNER_STATUS_LABELS[s.status]}
                      {s.signedAt ? ` em ${formatDateTime(s.signedAt)}` : ""}
                    </p>
                  </div>
                  {canOperate && s.status !== "assinado" ? (
                    <div className="flex flex-wrap gap-2">
                      {emailConnected ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-10 sm:h-8"
                          loading={busy === `rem:${r.contractId}:${s.email}`}
                          disabled={pending}
                          onClick={() => act(`rem:${r.contractId}:${s.email}`, () => run(() => sendSignatureReminderAction({ contractId: r.contractId, email: s.email }), (d) => (d.delivered ? `Lembrete enviado para ${s.name}` : `Falha ao enviar o lembrete para ${s.name}`)))}
                        >
                          <BellRing /> Reenviar lembrete
                        </Button>
                      ) : (
                        <Button asChild variant="ghost" size="sm" className="h-10 sm:h-8">
                          <a href={reminderEmailHref(r, s)} onClick={() => void run(() => sendSignatureReminderAction({ contractId: r.contractId, email: s.email }), `Lembrete para ${s.name} registrado (enviado pelo seu e-mail)`)}>
                            <BellRing /> Lembrete por e-mail
                          </a>
                        </Button>
                      )}
                      <ManualSignatureButton contractId={r.contractId} contractNumber={r.number} signer={s} label="Registrar assinatura" className="h-10 sm:h-8" />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : canOperate ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                className="h-10 sm:h-8"
                loading={busy === `send:${r.contractId}`}
                disabled={pending || r.signers.length === 0}
                onClick={() => act(`send:${r.contractId}`, () => run(() => sendForSignatureAction({ contractId: r.contractId }), "Documento gerado: aguardando assinatura (envio manual)"))}
              >
                <FileText /> Gerar documento para assinatura
              </Button>
              <Button asChild variant="outline" size="sm" className="h-10 sm:h-8">
                <Link href={contractDocumentPath(r.contractId)}>Ver contrato</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="h-10 sm:h-8">
                <Link href={`/financeiro/contratos/${r.contractId}`}>Revisar contrato</Link>
              </Button>
              {r.signers.length === 0 ? <p className="self-center text-xs text-danger-fg">Cadastre os signatários no contrato antes de gerar o documento.</p> : null}
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
