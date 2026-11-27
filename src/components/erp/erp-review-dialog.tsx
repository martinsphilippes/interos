"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, CircleSlash, Clock3, Loader2, ShieldQuestion } from "lucide-react";
import { ERP_ITEM_STATE_LABELS, describeDisplayChange, type ErpDisplayDraft, type ErpDisplayMode, type ErpDraftChange } from "@/domain/erp/license";
import type { ErpLicenseItemState } from "@/domain/erp/types";
import { reviewErpChangesAction, submitErpChangesAction, type ChangeOutcome, type ReviewSummary } from "@/server/erp/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fmtDate, fmtDateTime } from "./erp-format";

export interface ErpReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  draft: ErpDraftChange[];
  /** Exibição preparada (padrão da empresa e por unidade). */
  display?: ErpDisplayDraft | null;
  controlMode: "legacy" | "shadow" | "enforced" | null;
  /** Envio concluído (qualquer resultado do ERP): a tela limpa a seleção e recarrega. */
  onDone: (outcome: ChangeOutcome) => void;
  /** Outra pessoa alterou ou há alteração aberta: a tela recarrega e MANTÉM a seleção. */
  onConflict: (message: string) => void;
}

const label = (s: ErpLicenseItemState | string | null) => (s ? ((ERP_ITEM_STATE_LABELS as Record<string, string>)[s] ?? s) : "Não contratado");

/** Monta o conteúdo só quando abre: cada abertura começa do zero (nova revisão no servidor). */
export function ErpReviewDialog(props: ErpReviewDialogProps) {
  return props.open ? <ReviewDialogInner {...props} /> : null;
}

function ReviewDialogInner({ onOpenChange, clientId, draft, display = null, controlMode, onDone, onConflict }: ErpReviewDialogProps) {
  const [review, setReview] = React.useState<ReviewSummary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [contractRef, setContractRef] = React.useState("");
  const [confirmSet, setConfirmSet] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [outcome, setOutcome] = React.useState<ChangeOutcome | null>(null);

  React.useEffect(() => {
    let alive = true;
    reviewErpChangesAction({ clientId, draft, display, controlMode }).then(
      (res) => {
        if (!alive) return;
        setLoading(false);
        if (res.ok) setReview(res.data);
        else setError(res.error);
      },
      () => {
        if (!alive) return;
        setLoading(false);
        setError("Não foi possível revisar agora. Verifique a conexão e tente de novo.");
      },
    );
    return () => {
      alive = false;
    };
  }, [clientId, draft, display, controlMode]);

  const asked = review?.plan.filter((p) => p.origin === "pedido") ?? [];
  const deps = review?.plan.filter((p) => p.origin === "dependencia") ?? [];
  const cascade = review?.plan.filter((p) => p.origin === "cascata") ?? [];
  const needsSetConfirm = deps.length > 0 || cascade.length > 0;
  const blocked = Boolean(review?.errors.length) || (review?.simulation ? !review.simulation.valid : false);
  const willWait = Boolean(review?.requiresApproval && !review.canApprove);
  const canSend = review && !blocked && reason.trim().length >= 3 && (!needsSetConfirm || confirmSet) && !sending && !review.openChangeId;

  async function send() {
    if (!review) return;
    setSending(true);
    setError(null);
    const res = await submitErpChangesAction({ clientId, draft, display, controlMode, baseVersion: review.baseVersion, reason, contractReference: contractRef || null }).catch(() => ({
      ok: false as const,
      error: "A conexão caiu durante o envio. Recarregue a aba: se o ERP recebeu, a alteração aparece em andamento (o reenvio usa a mesma chave, sem duplicar).",
      code: undefined,
    }));
    setSending(false);
    if (res.ok) {
      setOutcome(res.data);
      return;
    }
    if (res.code === "versao_mudou" || res.code === "alteracao_aberta") {
      onOpenChange(false);
      onConflict(res.error);
      return;
    }
    setError(res.error);
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (sending || next) return;
        if (outcome) onDone(outcome);
        onOpenChange(false);
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{outcome ? "Resultado do envio" : "Revisar alterações de módulos"}</DialogTitle>
          <DialogDescription>{outcome ? "O estado abaixo é o que o ERP confirmou." : "Confira o conjunto final enviado ao ERP. Nada é enviado antes de confirmar."}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Montando o lote e simulando no ERP…
            </p>
          ) : null}
          {error ? <p className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger-fg">{error}</p> : null}
          {outcome ? <OutcomeView outcome={outcome} /> : null}

          {review && !outcome ? (
            <>
              {review.initial ? (
                <p className="rounded-lg border border-info/35 bg-info-soft px-3 py-2 text-sm text-info-fg">
                  Primeira licença registrada pelo INTEROS: o retrato parte do que a empresa usa hoje no ERP. Nada que está ligado é desligado sem estar na lista abaixo.
                </p>
              ) : null}
              {review.openChangeId ? <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-fg">Há outra alteração em andamento nesta empresa. Conclua, aprove ou cancele a anterior antes de enviar.</p> : null}
              {review.errors.length ? (
                <ul className="flex flex-col gap-1 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger-fg">
                  {review.errors.map((e) => (
                    <li key={`${e.code}-${e.message}`}>{e.message}</li>
                  ))}
                </ul>
              ) : null}

              <ChangeGroup title="Pedido" items={asked} />
              {deps.length ? <ChangeGroup title="Incluídos por dependência (exigidos pelo que vai ligar)" items={deps} tone="info" /> : null}
              {cascade.length ? <ChangeGroup title="Desligados em cascata (dependem do que vai desligar)" items={cascade} tone="warning" /> : null}
              {review.controlMode ? (
                <p className="text-sm">
                  Modo de controle no ERP: <strong>{review.modeFrom ?? "—"}</strong> → <strong>{review.controlMode}</strong>
                </p>
              ) : null}
              {review.displayChanges.length ? (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Exibição do que está desligado (não precisa de aprovação)</h3>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {review.displayChanges.map((c) => (
                      <li key={c.code ?? "empresa"} className="px-3 py-2 text-sm">
                        {describeDisplayChange({ code: c.code, from: c.from as ErpDisplayMode | null, to: c.to as ErpDisplayMode | null }, c.name)}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {review.warnings.length ? (
                <ul className="flex flex-col gap-1 text-xs text-muted">
                  {review.warnings.map((w) => (
                    <li key={`${w.code}-${w.message}`}>· {w.message}</li>
                  ))}
                </ul>
              ) : null}

              <SimulationView review={review} />

              {review.requiresApproval ? (
                <div className={`rounded-lg border px-3 py-2 text-sm ${willWait ? "border-warning/30 bg-warning-soft text-warning-fg" : "border-border bg-surface-muted text-foreground"}`}>
                  <p className="flex items-center gap-2 font-medium">
                    <ShieldQuestion className="size-4" aria-hidden />
                    {willWait ? "Vai aguardar aprovação de quem tem a permissão de aprovar" : "Exige aprovação: você tem a permissão, o envio fica registrado como aprovado por você"}
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-xs">
                    {review.approvalReasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {needsSetConfirm ? (
                <Checkbox checked={confirmSet} onCheckedChange={(v) => setConfirmSet(v === true)} label="Confirmo o conjunto completo, incluindo as dependências e a cascata acima" />
              ) : null}
              <FormField label="Motivo" htmlFor="erp-reason" required hint="Fica no histórico do cliente, na auditoria e no ERP (ex.: aditivo 2026-118, pedido do cliente).">
                <Textarea id="erp-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} />
              </FormField>
              <FormField label="Referência do contrato" htmlFor="erp-contract" hint="Opcional: número do contrato ou aditivo.">
                <Input id="erp-contract" value={contractRef} onChange={(e) => setContractRef(e.target.value)} maxLength={100} />
              </FormField>
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {outcome ? (
            <Button
              onClick={() => {
                onDone(outcome);
                onOpenChange(false);
              }}
            >
              Fechar
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
                Voltar
              </Button>
              <Button onClick={send} disabled={!canSend} loading={sending}>
                {willWait ? "Enviar para aprovação" : "Confirmar e enviar ao ERP"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangeGroup({ title, items, tone }: { title: string; items: ReviewSummary["plan"]; tone?: "info" | "warning" }) {
  if (!items.length) return null;
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {items.map((c) => (
          <li key={c.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <span className="w-12 font-mono text-xs text-muted">{c.code}</span>
            <span className="min-w-0 flex-1 font-medium">{c.name}</span>
            <span className="text-xs text-muted">
              {label(c.from)} → <strong className="text-foreground">{label(c.to)}</strong>
              {c.until ? ` até ${fmtDate(c.until)}` : c.effectiveAt ? ` em ${fmtDate(c.effectiveAt)}` : ""}
            </span>
            {c.relatedTo ? (
              <Badge variant={tone ?? "default"} size="sm">
                {c.origin === "dependencia" ? "exigido por" : "por causa de"} {c.relatedTo}
              </Badge>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SimulationView({ review }: { review: ReviewSummary }) {
  const sim = review.simulation;
  if (!sim) {
    return review.simulationError ? <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-fg">{review.simulationError} O ERP valida de novo no envio.</p> : null;
  }
  const impacts = sim.impacts.filter((i) => i.blockers.length || i.obligations.length || i.policy || i.cascadedFrom || i.integrationsAffected.length);
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Simulação do ERP</h3>
      {!sim.valid ? (
        <ul className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger-fg">
          {[...sim.rejected.filter((r) => r.reason === "dependency_missing" || r.reason === "kind_not_supported"), ...sim.errors].map((r) => (
            <li key={r.message}>{r.message}</li>
          ))}
        </ul>
      ) : null}
      {impacts.length ? (
        <ul className="flex flex-col gap-2">
          {impacts.map((i) => (
            <li key={i.module} className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm">
              <p className="font-medium">
                {i.unit ? <span className="mr-2 font-mono text-xs text-muted">{i.unit}</span> : null}
                {i.name}
                {i.to ? <span className="ml-2 text-xs text-muted">→ {i.to === "draining" ? "encerramento (só conclui pendências)" : i.to === "scheduled_off" ? "desliga quando as pendências acabarem" : i.to === "disabled" ? "desligado" : i.to}</span> : null}
              </p>
              {i.blockers.length ? (
                <p className="mt-1 flex items-start gap-1.5 text-xs text-warning-fg">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Em andamento: {i.blockers.map((b) => `${b.label} (${b.count})`).join(", ")}
                </p>
              ) : null}
              {i.obligations.map((o) => (
                <p key={o} className="mt-1 text-xs text-muted">
                  · {o}
                </p>
              ))}
              {i.integrationsAffected.length ? <p className="mt-1 text-xs text-muted">Integrações afetadas: {i.integrationsAffected.join(", ")}</p> : null}
              {i.cascadedFrom ? <p className="mt-1 text-xs text-muted">Em cascata a partir de {i.cascadedFrom}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{review.plan.some((p) => p.to === "inactive" || p.to === "suspended" || p.to === "read_only" || p.to === "suspension_scheduled") ? "Sem pendências operacionais no ERP para o que vai desligar." : "O ERP validou o lote."}</p>
      )}
      {sim.rejected.filter((r) => r.reason === "not_homologated").map((r) => (
        <p key={r.message} className="text-xs text-warning-fg">
          {r.message}
        </p>
      ))}
      {sim.companyNotice ? <p className="text-xs text-muted">{sim.companyNotice}</p> : null}
      <p className="text-xs text-muted-light">Testes, agendamentos e encerramentos valem na data: o ERP aplica sozinho, sem esperar a rotina diária.</p>
    </section>
  );
}

function OutcomeView({ outcome }: { outcome: ChangeOutcome }) {
  if (outcome.status === "aplicada") {
    return (
      <div className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-success-fg">
          <CheckCircle2 className="size-4" aria-hidden /> Aplicada pelo ERP (versão {outcome.licenseVersion}).
        </p>
        {outcome.result?.rejectedItems.length ? (
          <ul className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-fg">
            {outcome.result.rejectedItems.map((r) => (
              <li key={r.message}>{r.message}</li>
            ))}
          </ul>
        ) : null}
        {outcome.result?.warnings.length ? (
          <ul className="text-xs text-muted">
            {outcome.result.warnings.map((w) => (
              <li key={w.message}>· {w.message}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  if (outcome.status === "aguardando_aprovacao") {
    return (
      <p className="flex items-center gap-2 text-sm font-medium text-warning-fg">
        <ShieldQuestion className="size-4" aria-hidden /> Aguardando aprovação. Quem tem a permissão foi avisado; nada foi enviado ao ERP ainda.
      </p>
    );
  }
  if (outcome.status === "falhou") {
    return (
      <div className="flex flex-col gap-1 text-sm text-warning-fg">
        <p className="flex items-center gap-2 font-medium">
          <Clock3 className="size-4" aria-hidden /> Aguardando sincronização: o ERP ainda não confirmou.
        </p>
        <p className="text-xs">{outcome.lastError?.message}</p>
        {outcome.nextAttemptAt ? <p className="text-xs">Nova tentativa automática em {fmtDateTime(outcome.nextAttemptAt)}, com a mesma chave (sem duplicar).</p> : <p className="text-xs">Use &quot;Tentar de novo&quot; depois de corrigir a causa.</p>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-sm text-danger-fg">
      <p className="flex items-center gap-2 font-medium">
        <CircleSlash className="size-4" aria-hidden /> {outcome.status === "conflito" ? "Não aplicada: outra versão já estava no ERP." : "Recusada pelo ERP."}
      </p>
      {outcome.result?.rejectedItems.map((r) => (
        <p key={r.message} className="text-xs">
          {r.message}
        </p>
      ))}
    </div>
  );
}
