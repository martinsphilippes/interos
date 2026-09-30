"use client";

import * as React from "react";
import Link from "next/link";
import { Ban, CheckCircle2, FileDiff, FileText, Plus, Send } from "lucide-react";
import type { Contract, ContractAmendment, ProposalItem } from "@/domain/types";
import type { ProductOption } from "@/server/finance/queries";
import { AMENDMENT_FIELD_LABELS, AMENDMENT_KIND_LABELS, AMENDMENT_OPEN_STATUSES, AMENDMENT_STATUS_LABELS, AMENDMENT_STATUS_VARIANT, describeSnapshotValue } from "@/domain/contract-snapshot";
import { applyAmendmentAction, cancelAmendmentAction, createAmendmentAction, sendAmendmentForSignatureAction } from "@/server/finance/actions";
import { dateKey, formatDate, formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ReasonDialog } from "@/components/commissions/commission-ui";
import { ContractItemsEditor, fromEdit, toEdit, type EditRow } from "./contract-items-card";
import { ConditionsFields, conditionsFormFromContract, conditionsPayload, type ConditionsContract, type ConditionsForm } from "./contract-conditions-card";
import { ManualSignatureButton } from "./manual-signature-dialog";
import { NO_FINANCE_CAPABILITIES } from "./access-model";
import { useFinanceAccess } from "./finance-access";
import { useFinanceAction } from "./use-finance-action";

type Scope = "itens" | "condicoes" | "ambos";

export interface ContractAmendmentsCardProps {
  contract: ConditionsContract & Pick<Contract, "number" | "status" | "items" | "signers">;
  amendments: ContractAmendment[];
  products: ProductOption[];
  /** Contrato cancelado: só leitura. */
  closed?: boolean;
}

/** Linhas "campo: de → para" de um aditivo. */
export function AmendmentChanges({ changes, compact }: { changes: ContractAmendment["changes"]; compact?: boolean }) {
  const entries = Object.entries(changes ?? {}).filter(([field]) => !["version", "documentHash", "signers"].includes(field));
  if (entries.length === 0) return <p className="text-sm text-muted">Sem alterações registradas.</p>;
  return (
    <ul className={compact ? "flex flex-col gap-0.5 text-xs" : "flex flex-col gap-1 text-sm"} data-testid="amendment-changes">
      {entries.map(([field, c]) => (
        <li key={field} className="break-words">
          <span className="font-medium">{AMENDMENT_FIELD_LABELS[field] ?? field}:</span> <span className="text-muted line-through decoration-danger/60">{describeSnapshotValue(field, c.from)}</span> <span aria-hidden>→</span> <span className="font-medium text-foreground">{describeSnapshotValue(field, c.to)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Aditivos do contrato (D25): lista com situação e ações (enviar para assinatura, registrar assinatura, aplicar,
 * cancelar, ver termo) e o diálogo "Criar aditivo", que reutiliza o editor de itens e os campos de condições.
 */
export function ContractAmendmentsCard({ contract, amendments, products, closed }: ContractAmendmentsCardProps) {
  // Capacidades do servidor (uma chave por ação do aditivo); contrato cancelado não recebe operações.
  const access = useFinanceAccess();
  const can = closed ? NO_FINANCE_CAPABILITIES.contracts : access.contracts;
  const { pending, run } = useFinanceAction();
  const [creating, setCreating] = React.useState(false);
  const [cancelling, setCancelling] = React.useState<ContractAmendment | null>(null);
  const open = amendments.find((a) => AMENDMENT_OPEN_STATUSES.includes(a.status));
  const amendable = ["assinado", "aguardando_pagamento", "pago", "liberado", "pendencia"].includes(contract.status);
  const canCreate = can.amendmentCreate && amendable && !open;

  return (
    <Card data-testid="amendments-card">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileDiff className="size-4 text-muted" /> Aditivos
          </CardTitle>
          <CardDescription>
            {amendable ? "Alterações de itens, condições, reajuste e renovação depois da assinatura entram por aditivo no mesmo contrato: antes/depois, assinatura do cliente (quando exigida), comissões e cobranças futuras recalculadas." : "Antes da assinatura, itens e condições são alterados diretamente no contrato."}
          </CardDescription>
        </div>
        {can.amendmentCreate && amendable ? (
          <Button variant="outline" size="sm" className="h-10 md:h-8" onClick={() => setCreating(true)} disabled={!canCreate} title={open ? `Aditivo ${open.number} em andamento` : undefined}>
            <Plus /> Criar aditivo
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="pt-0">
        {amendments.length === 0 ? (
          <EmptyState size="sm" icon={<FileDiff />} title="Nenhum aditivo" description={amendable ? "Crie um aditivo para alterar itens, condições ou renovar o contrato." : "Aditivos aparecem depois da assinatura do contrato."} />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {amendments.map((a) => {
              const signed = (a.signers ?? []).filter((s) => s.status === "assinado").length;
              const total = a.signers?.length ?? 0;
              const applyable = a.status === "assinado" || (a.status === "rascunho" && !a.requiresSignature);
              return (
                <li key={a.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0" data-amendment={a.number}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.number}</span>
                    <Badge variant="muted" size="sm">
                      {AMENDMENT_KIND_LABELS[a.kind]}
                    </Badge>
                    <Badge variant={AMENDMENT_STATUS_VARIANT[a.status]} size="sm">
                      {AMENDMENT_STATUS_LABELS[a.status]}
                    </Badge>
                    {a.requiresSignature ? (
                      <span className="text-xs text-muted">
                        assinaturas {signed}/{total}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">sem assinatura do cliente</span>
                    )}
                    {a.appliedVersion ? <span className="text-xs text-muted">· aplicado na v{a.appliedVersion}</span> : null}
                  </div>
                  <p className="text-xs text-muted">
                    Vigência {formatDate(`${a.effectiveFrom}T12:00:00.000Z`)} · {a.reason}
                    {a.appliedAt ? ` · aplicado em ${formatDateTime(a.appliedAt)}` : a.signedAt ? ` · assinado em ${formatDateTime(a.signedAt)}` : a.sentAt ? ` · enviado em ${formatDateTime(a.sentAt)}` : ` · criado em ${formatDateTime(a.createdAt)}`}
                    {a.cancelReason ? ` · cancelado: ${a.cancelReason}` : ""}
                  </p>
                  <AmendmentChanges changes={a.changes} compact />
                  {!access.contractValues ? <p className="text-xs text-muted">Valores do aditivo: restrito.</p> : null}
                  {a.status === "aguardando_assinatura" && (a.signers ?? []).length > 0 ? (
                    <ul className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2 text-xs">
                      {(a.signers ?? []).map((s) => (
                        <li key={s.email} className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            {s.name} · {s.role} · {s.email}
                            {s.signedAt ? <span className="text-success-fg"> · assinou em {formatDate(s.signedAt)}</span> : null}
                          </span>
                          {can.amendmentSign && s.status !== "assinado" ? <ManualSignatureButton contractId={contract.id} contractNumber={contract.number} amendment={{ id: a.id, number: a.number }} signer={s} className="h-9 md:h-7" /> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {access.contracts.documentsView ? (
                      <Button asChild variant="ghost" size="sm" className="h-9 md:h-8">
                        <Link href={`/financeiro/contratos/${contract.id}/documento?aditivo=${a.id}`}>
                          <FileText /> Ver termo
                        </Link>
                      </Button>
                    ) : null}
                    {can.amendmentSend && a.status === "rascunho" && a.requiresSignature ? (
                      <Button size="sm" className="h-9 md:h-8" loading={pending} onClick={() => run(() => sendAmendmentForSignatureAction({ amendmentId: a.id }), (d) => `Termo aditivo ${d.number} gerado: aguardando assinatura (envio manual)`)}>
                        <Send /> Enviar para assinatura
                      </Button>
                    ) : null}
                    {can.amendmentApply && applyable ? (
                      <Button size="sm" variant="success" className="h-9 md:h-8" loading={pending} onClick={() => run(() => applyAmendmentAction({ amendmentId: a.id }), (d) => `Aditivo aplicado: contrato v${d.version}${d.billingsRebuilt > 0 ? ` · ${d.billingsRebuilt} cobrança(s) refeita(s)` : ""}${d.billingsCreated > 0 ? ` · ${d.billingsCreated} gerada(s)` : ""}`)}>
                        <CheckCircle2 /> Aplicar
                      </Button>
                    ) : null}
                    {can.amendmentCancel && AMENDMENT_OPEN_STATUSES.includes(a.status) ? (
                      <Button size="sm" variant="ghost" className="h-9 text-danger-fg md:h-8" disabled={pending} onClick={() => setCancelling(a)}>
                        <Ban /> Cancelar
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      {creating ? <CreateAmendmentDialog contract={contract} products={products} onClose={() => setCreating(false)} /> : null}
      <ReasonDialog
        open={Boolean(cancelling)}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={`Cancelar o aditivo ${cancelling?.number ?? ""}?`}
        description="O aditivo fica cancelado e o contrato continua como está. Um novo aditivo pode ser criado depois."
        confirmLabel="Cancelar aditivo"
        destructive
        pending={pending}
        onConfirm={async (reason) => {
          const ok = await run(() => cancelAmendmentAction({ amendmentId: cancelling!.id, reason }), "Aditivo cancelado");
          if (ok) setCancelling(null);
          return ok;
        }}
      />
    </Card>
  );
}

function CreateAmendmentDialog({ contract, products, onClose }: { contract: ContractAmendmentsCardProps["contract"]; products: ProductOption[]; onClose: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [scope, setScope] = React.useState<Scope>("itens");
  const [rows, setRows] = React.useState<EditRow[]>(() => contract.items.map(toEdit));
  const [form, setForm] = React.useState<ConditionsForm>(() => conditionsFormFromContract(contract));
  const [effectiveFrom, setEffectiveFrom] = React.useState(() => dateKey(new Date()));
  const [reason, setReason] = React.useState("");
  const [requiresSignature, setRequiresSignature] = React.useState(true);
  const items: ProposalItem[] = rows.map(fromEdit);
  const withItems = scope === "itens" || scope === "ambos";
  const withConditions = scope === "condicoes" || scope === "ambos";
  const valid = reason.trim().length >= 5 && /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) && (!withItems || items.length > 0);

  const submit = async () => {
    const ok = await run(
      () =>
        createAmendmentAction({
          contractId: contract.id,
          effectiveFrom,
          reason,
          requiresSignature,
          items: withItems ? items : undefined,
          conditions: withConditions ? conditionsPayload(form, contract) : undefined,
        }),
      (d) => `Aditivo ${d.number} criado em rascunho${d.requiresSignature ? ": envie para assinatura" : ": aplique quando quiser"}`,
    );
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Criar aditivo — contrato {contract.number}</DialogTitle>
          <DialogDescription>O servidor calcula o antes/depois e registra cada mudança (de → para). O contrato original fica preservado como versão anterior.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <SegmentedControl<Scope>
            value={scope}
            onChange={setScope}
            options={[
              { value: "itens", label: "Itens" },
              { value: "condicoes", label: "Condições" },
              { value: "ambos", label: "Itens e condições" },
            ]}
            aria-label="O que muda"
          />
          {withItems ? (
            <section className="-mx-4 md:-mx-6">
              <h4 className="mb-2 px-4 text-sm font-semibold md:px-6">Itens depois do aditivo</h4>
              <ContractItemsEditor rows={rows} onChange={setRows} products={products} items={contract.items} editing />
            </section>
          ) : null}
          {withConditions ? (
            <section>
              <h4 className="mb-2 text-sm font-semibold">Condições depois do aditivo</h4>
              <ConditionsFields id={`${id}-c`} form={form} onChange={setForm} hasPaymentMethod={Boolean(contract.paymentMethod)} />
            </section>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Vigência do aditivo" htmlFor={`${id}-ef`} required hint="Mensalidades em aberto a partir desta competência são refeitas com os novos valores">
              <DateInput id={`${id}-ef`} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="h-11 md:h-9" />
            </FormField>
            <Switch label="Exige assinatura do cliente" description={requiresSignature ? "Termo aditivo gerado para assinatura; aplicado depois que todos assinarem." : "Só para ajuste interno: o Financeiro aplica direto."} checked={requiresSignature} onCheckedChange={setRequiresSignature} className="w-full rounded-lg border border-border px-3 py-2" />
          </div>
          <FormField label="Motivo" htmlFor={`${id}-r`} required hint="Mínimo de 5 caracteres; entra no termo e na auditoria">
            <Textarea id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: inclusão do módulo de TEF a pedido do cliente" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending} className="h-11 md:h-9">
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={!valid} className="h-11 md:h-9">
            <FileDiff /> Criar aditivo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
