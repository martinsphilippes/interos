"use client";

import * as React from "react";
import { BellRing, CheckCircle2, FlaskConical, PenLine, Plus, Send, ShieldCheck, Trash2 } from "lucide-react";
import type { Contract } from "@/domain/types";
import { addSignerAction, removeSignerAction, sendForSignatureAction, sendSignatureReminderAction, simulateSignatureAction } from "@/server/finance/actions";
import { SIGNER_STATUS_LABELS } from "@/server/finance/schemas";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { useFinanceAction } from "./use-finance-action";
import { RelativeTime } from "@/components/ui/relative-time";

export interface SignatureCardProps {
  contract: Pick<Contract, "id" | "number" | "version" | "status" | "signers" | "signatureEnvelopeId" | "signatureProvider" | "documentHash" | "signedAt">;
  sentAt?: string;
  reminders: Record<string, { count: number; lastAt: string }>;
  canOperate: boolean;
  /** Itens/condições/signatários ainda podem mudar. */
  editable: boolean;
}

const SIGNER_VARIANT = { pendente: "warning", assinado: "success", recusado: "danger" } as const;

/** Signatários (adicionar/remover) e assinatura digital (envio, lembrete e simulação de assinatura). */
export function SignatureCard({ contract, sentAt, reminders, canOperate, editable }: SignatureCardProps) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [adding, setAdding] = React.useState(false);
  const [signer, setSigner] = React.useState({ name: "", email: "", role: "Contratante" });
  const [removing, setRemoving] = React.useState<{ email: string; name: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const sent = Boolean(contract.signatureEnvelopeId);
  const closed = contract.status === "liberado" || contract.status === "cancelado";
  const signedCount = contract.signers.filter((s) => s.status === "assinado").length;
  const allSigned = sent && contract.signers.length > 0 && signedCount === contract.signers.length;

  const act = async (key: string, fn: () => Promise<boolean>) => {
    setBusy(key);
    await fn();
    setBusy(null);
  };

  const add = async () => {
    const ok = await run(() => addSignerAction({ contractId: contract.id, ...signer }), "Signatário adicionado");
    if (ok) {
      setSigner({ name: "", email: "", role: "Contratante" });
      setAdding(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PenLine className="size-4 text-muted" /> Assinatura
        </CardTitle>
        <CardDescription>
          {allSigned
            ? `Assinado por todos${contract.signedAt ? ` em ${formatDateTime(contract.signedAt)}` : ""}.`
            : sent
              ? <>Enviado {sentAt ? <RelativeTime value={sentAt} /> : ""} · {signedCount}/{contract.signers.length} assinatura(s).</>
              : "Ainda não enviado para assinatura."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        {sent ? (
          <div className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted">
            <p className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-success" /> Provedor: {contract.signatureProvider ?? "—"} · envelope <span className="font-mono">{contract.signatureEnvelopeId}</span> · v{contract.version}
            </p>
            {contract.documentHash ? (
              <p className="mt-1 truncate font-mono" title={contract.documentHash}>
                {contract.documentHash}
              </p>
            ) : null}
          </div>
        ) : null}

        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {contract.signers.length === 0 ? <li className="px-3 py-4 text-center text-sm text-muted">Nenhum signatário. Adicione quem assina pelo cliente.</li> : null}
          {contract.signers.map((s) => {
            const r = reminders[s.email.toLowerCase()];
            return (
              <li key={s.email} className="flex flex-col gap-2 px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <p className="truncate text-xs text-muted">
                      {s.role} · {s.email}
                    </p>
                    {s.signedAt ? <p className="text-xs text-success-fg">Assinou em {formatDateTime(s.signedAt)}</p> : null}
                    {r ? (
                      <p className="text-xs text-muted">
                        {r.count} lembrete(s) · último <RelativeTime value={r.lastAt} />
                      </p>
                    ) : null}
                  </div>
                  <Badge variant={SIGNER_VARIANT[s.status]} size="sm">
                    {s.status === "assinado" ? <CheckCircle2 /> : null}
                    {SIGNER_STATUS_LABELS[s.status]}
                  </Badge>
                </div>
                {canOperate && !closed && s.status !== "assinado" ? (
                  <div className="flex flex-wrap gap-2">
                    {sent ? (
                      <>
                        <Tooltip content="Ação de demonstração: registra a assinatura como se viesse do provedor.">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-10 md:h-8"
                            loading={busy === `sim:${s.email}`}
                            disabled={pending}
                            onClick={() => act(`sim:${s.email}`, () => run(() => simulateSignatureAction({ contractId: contract.id, email: s.email }), (d) => (d.allSigned ? "Contrato assinado por todos" : `Assinatura de ${s.name} registrada`)))}
                          >
                            <FlaskConical /> Simular assinatura de {s.name.split(" ")[0]}
                          </Button>
                        </Tooltip>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-10 md:h-8"
                          loading={busy === `rem:${s.email}`}
                          disabled={pending}
                          onClick={() => act(`rem:${s.email}`, () => run(() => sendSignatureReminderAction({ contractId: contract.id, email: s.email }), `Lembrete enviado para ${s.name}`))}
                        >
                          <BellRing /> Reenviar lembrete
                        </Button>
                      </>
                    ) : null}
                    {editable ? (
                      <Button variant="ghost" size="sm" className="h-10 text-danger md:h-8" disabled={pending} onClick={() => setRemoving({ email: s.email, name: s.name })}>
                        <Trash2 /> Remover
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        {canOperate && editable ? (
          adding ? (
            <div className="grid gap-3 rounded-lg border border-border p-3">
              <FormField label="Nome" htmlFor={`${id}-n`} required>
                <Input id={`${id}-n`} value={signer.name} onChange={(e) => setSigner({ ...signer, name: e.target.value })} className="h-11 md:h-9" />
              </FormField>
              <FormField label="E-mail" htmlFor={`${id}-e`} required>
                <Input id={`${id}-e`} type="email" value={signer.email} onChange={(e) => setSigner({ ...signer, email: e.target.value })} className="h-11 md:h-9" />
              </FormField>
              <FormField label="Papel" htmlFor={`${id}-r`} required hint="Ex.: Contratante, Testemunha, Contratada">
                <Input id={`${id}-r`} value={signer.role} onChange={(e) => setSigner({ ...signer, role: e.target.value })} className="h-11 md:h-9" />
              </FormField>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAdding(false)} disabled={pending} className="h-11 md:h-9">
                  Cancelar
                </Button>
                <Button onClick={add} loading={pending} disabled={!signer.name.trim() || !signer.email.trim()} className="h-11 md:h-9">
                  Adicionar
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setAdding(true)} className="h-11 md:h-9">
              <Plus /> Adicionar signatário
            </Button>
          )
        ) : null}

        {canOperate && editable ? (
          <Button
            onClick={() => act("send", () => run(() => sendForSignatureAction({ contractId: contract.id }), (d) => `Contrato enviado para assinatura (envelope ${d.envelopeId})`))}
            loading={busy === "send"}
            disabled={pending || contract.signers.length === 0}
            className="h-11 md:h-10"
          >
            <Send /> {sent ? "Reenviar para assinatura" : "Enviar para assinatura"}
          </Button>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remover signatário?"
        description={removing ? `${removing.name} (${removing.email}) deixa de assinar o contrato ${contract.number}.` : undefined}
        confirmLabel="Remover"
        destructive
        onConfirm={async () => {
          if (removing) await run(() => removeSignerAction({ contractId: contract.id, email: removing.email }), "Signatário removido");
        }}
      />
    </Card>
  );
}
