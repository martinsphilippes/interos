"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, ChevronRight, Clock3, RotateCw, ShieldQuestion, XCircle } from "lucide-react";
import { ERP_ITEM_STATE_LABELS } from "@/domain/erp/license";
import { ERP_CHANGE_STATUS_LABELS, type ErpChangeRequest } from "@/domain/erp/types";
import { approveErpChangeAction, cancelErpChangeAction, resumeErpProvisioningAction, retryErpChangeAction } from "@/server/erp/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { CHANGE_STATUS_BADGE, fmtDate, fmtDateTime } from "./erp-format";

export interface ErpChangeCaps {
  userId: string;
  change: boolean;
  approve: boolean;
  provision: boolean;
}

const stateLabel = (s: string | null) => (s ? ((ERP_ITEM_STATE_LABELS as Record<string, string>)[s] ?? s) : "Não contratado");
const ORIGIN_LABEL: Record<string, string> = { pedido: "pedido", dependencia: "dependência", cascata: "cascata" };
const RESULT_LABEL: Record<string, string> = { applied: "aplicada", duplicate: "já aplicada (repetição)", stale: "desatualizada (o ERP já tinha versão maior)", rejected: "recusada" };
/** Alteração "enviando" há mais que isso: a resposta se perdeu, dá para tentar de novo (mesma chave). */
const STUCK_MS = 3 * 60 * 1000;

function isStuck(change: ErpChangeRequest, now: number): boolean {
  return change.status === "enviando" && (!change.lastAttemptAt || now - Date.parse(change.lastAttemptAt) > STUCK_MS);
}

/** Cartão da alteração aberta da empresa (uma por vez): o que foi pedido, situação e o que dá para fazer. */
export function ErpOpenChangeCard({ change, caps, nameOf }: { change: ErpChangeRequest; caps: ErpChangeCaps; nameOf: (code: string) => string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<"approve" | "retry" | null>(null);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  // Lido uma vez ao montar (o cartão remonta a cada atualização da aba).
  const [mountedAt] = React.useState(() => Date.now());
  const isProvisioning = change.kind === "provisionamento";
  const mine = change.requestedBy.id === caps.userId;
  const canApprove = caps.approve && change.status === "aguardando_aprovacao" && !mine;
  const canRetry = (isProvisioning ? caps.provision : caps.change) && (change.status === "falhou" || isStuck(change, mountedAt));
  const canCancel = caps.change && !isProvisioning && (change.status === "aguardando_aprovacao" || change.status === "falhou");

  async function run(kind: "approve" | "retry") {
    setBusy(kind);
    const res = await (kind === "approve" ? approveErpChangeAction({ changeId: change.id }) : retryErpChangeAction({ changeId: change.id })).catch(() => ({ ok: false as const, error: "A conexão caiu. Recarregue a aba para ver a situação." }));
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      router.refresh();
      return;
    }
    const s = res.data.status;
    if (s === "aplicada") toast.success(`Aplicada pelo ERP (versão ${res.data.licenseVersion ?? "—"}).`);
    else if (s === "falhou") toast.warning(res.data.lastError?.message ?? "O ERP ainda não confirmou; nova tentativa automática agendada.");
    else if (s === "recusada" || s === "conflito") toast.error("O ERP recusou a alteração. Veja os motivos no histórico.");
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-warning/30 bg-warning-soft/40 p-4" aria-label="Alteração em andamento">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {change.status === "aguardando_aprovacao" ? <ShieldQuestion className="size-4" aria-hidden /> : <Clock3 className="size-4" aria-hidden />}
            {isProvisioning ? "Criação da empresa no ERP" : "Alteração de módulos em andamento"}
            <Badge variant={CHANGE_STATUS_BADGE[change.status]} size="sm">
              {ERP_CHANGE_STATUS_LABELS[change.status]}
            </Badge>
            {change.licenseVersion ? <span className="text-xs font-normal text-muted">versão {change.licenseVersion}</span> : null}
          </p>
          <p className="mt-1 text-xs text-muted">
            Pedida por {change.requestedBy.name} em {fmtDateTime(change.requestedAt)} · motivo: {change.reason}
            {change.contractReference ? ` · contrato ${change.contractReference}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canApprove ? (
            <Button size="sm" onClick={() => run("approve")} loading={busy === "approve"} disabled={Boolean(busy)}>
              Aprovar e enviar
            </Button>
          ) : null}
          {canRetry ? (
            <Button size="sm" variant="outline" onClick={() => run("retry")} loading={busy === "retry"} disabled={Boolean(busy)}>
              <RotateCw aria-hidden /> Tentar de novo
            </Button>
          ) : null}
          {canCancel ? (
            <Button size="sm" variant="ghost" onClick={() => setCancelOpen(true)} disabled={Boolean(busy)}>
              Cancelar
            </Button>
          ) : null}
        </div>
      </div>

      {change.status === "aguardando_aprovacao" ? (
        <div className="mt-3 text-xs">
          <p className="font-medium">{mine ? "Aguardando outra pessoa com a permissão de aprovar." : "Exige aprovação porque:"}</p>
          <ul className="mt-1 list-disc pl-5 text-muted">
            {change.approvalReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {change.lastError ? (
        <p className="mt-3 text-xs text-warning-fg">
          Última tentativa ({change.attempts}) em {fmtDateTime(change.lastAttemptAt)}: {change.lastError.message}
          {change.nextAttemptAt ? ` Nova tentativa automática em ${fmtDateTime(change.nextAttemptAt)}, com a mesma chave (o ERP não duplica).` : ""}
        </p>
      ) : null}
      {change.plan.length ? <PlanList change={change} nameOf={nameOf} /> : null}

      {cancelOpen ? <CancelDialog change={change} onClose={() => setCancelOpen(false)} /> : null}
    </section>
  );
}

function CancelDialog({ change, onClose }: { change: ErpChangeRequest; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function confirm() {
    setBusy(true);
    const res = await cancelErpChangeAction({ changeId: change.id, reason }).catch(() => ({ ok: false as const, error: "A conexão caiu. Recarregue a aba." }));
    setBusy(false);
    if (!res.ok) toast.error(res.error);
    else toast.success(res.data.status === "aplicada" ? "O ERP já tinha aplicado: a alteração foi concluída." : "Alteração cancelada.");
    onClose();
    router.refresh();
  }
  return (
    <Dialog open onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Cancelar a alteração?</DialogTitle>
          <DialogDescription>Nada desta alteração foi aplicado no ERP. Se o ERP já tiver aplicado, ela é concluída em vez de cancelada.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormField label="Motivo" htmlFor="erp-cancel-reason" required>
            <Textarea id="erp-cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Voltar
          </Button>
          <Button variant="destructive" onClick={confirm} loading={busy} disabled={reason.trim().length < 3}>
            Cancelar alteração
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanList({ change, nameOf }: { change: ErpChangeRequest; nameOf: (code: string) => string }) {
  return (
    <ul className="mt-3 flex flex-col gap-1 text-xs">
      {change.plan.map((p) => (
        <li key={p.code} className="flex flex-wrap items-center gap-x-2">
          <span className="w-12 font-mono text-muted">{p.code}</span>
          <span className="min-w-0 flex-1 truncate">{nameOf(p.code)}</span>
          <span className="text-muted">
            {stateLabel(p.from)} → <strong className="text-foreground">{stateLabel(p.to)}</strong>
            {p.until ? ` até ${fmtDate(p.until)}` : p.effectiveAt ? ` em ${fmtDate(p.effectiveAt)}` : ""}
          </span>
          {p.origin !== "pedido" ? (
            <Badge variant="muted" size="sm">
              {ORIGIN_LABEL[p.origin] ?? p.origin}
              {p.relatedTo ? ` de ${p.relatedTo}` : ""}
            </Badge>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Criação da empresa no ERP que não terminou (sem vínculo ainda, ou implantação parada). */
export function ErpProvisioningCard({ change, caps }: { change: ErpChangeRequest; caps: ErpChangeCaps }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<"retry" | "resume" | null>(null);
  const [invite, setInvite] = React.useState<string | null>(null);
  const stage = change.provisioning?.implantacao ?? null;
  const stalled = change.status === "aplicada" && stage === "falhou";
  if (!caps.provision) return null;

  async function retry() {
    setBusy("retry");
    const res = await retryErpChangeAction({ changeId: change.id }).catch(() => ({ ok: false as const, error: "A conexão caiu. Recarregue a aba." }));
    setBusy(null);
    if (!res.ok) toast.error(res.error);
    router.refresh();
  }
  async function resume() {
    setBusy("resume");
    const res = await resumeErpProvisioningAction({ changeId: change.id }).catch(() => ({ ok: false as const, error: "A conexão caiu. Recarregue a aba." }));
    setBusy(null);
    if (!res.ok) toast.error(res.error);
    else {
      if (res.data.invite?.link) setInvite(res.data.invite.link);
      toast.success(res.data.implantacao === "concluida" ? "Implantação concluída no ERP." : "Implantação retomada.");
    }
    router.refresh();
  }

  if (change.status !== "falhou" && change.status !== "enviando" && !stalled && !invite) return null;
  return (
    <section className="rounded-xl border border-warning/30 bg-warning-soft/40 p-4 text-sm" aria-label="Criação da empresa no ERP">
      <p className="flex flex-wrap items-center gap-2 font-semibold">
        Criação da empresa no ERP
        <Badge variant={CHANGE_STATUS_BADGE[change.status]} size="sm">
          {stalled ? "Implantação parada" : ERP_CHANGE_STATUS_LABELS[change.status]}
        </Badge>
      </p>
      <p className="mt-1 text-xs text-muted">
        Pedida por {change.requestedBy.name} em {fmtDateTime(change.requestedAt)} · {change.provisioning?.razaoSocial} · tentativas: {change.attempts}
      </p>
      {change.lastError ? <p className="mt-2 text-xs text-warning-fg">{change.lastError.message}</p> : null}
      {invite ? (
        <p className="mt-2 break-all rounded-lg border border-border bg-surface px-3 py-2 text-xs">
          Link de acesso do administrador (mostrado só agora): <span className="font-mono">{invite}</span>
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {change.status === "falhou" || change.status === "enviando" ? (
          <Button size="sm" variant="outline" onClick={retry} loading={busy === "retry"} disabled={Boolean(busy)}>
            <RotateCw aria-hidden /> Tentar de novo (mesma solicitação)
          </Button>
        ) : null}
        {stalled ? (
          <Button size="sm" variant="outline" onClick={resume} loading={busy === "resume"} disabled={Boolean(busy)}>
            Retomar implantação
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/** Histórico de alterações da empresa (auditoria): quem, quando, motivo, antes → depois e a referência no ERP. */
export function ErpHistoryList({ changes, nameOf }: { changes: ErpChangeRequest[]; nameOf: (code: string) => string }) {
  const [open, setOpen] = React.useState<string | null>(null);
  if (!changes.length) return <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Nenhuma alteração registrada pelo INTEROS para esta empresa.</p>;
  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface" aria-label="Histórico de alterações no ERP">
      {changes.map((c) => {
        const expanded = open === c.id;
        const Icon = c.status === "aplicada" ? CheckCircle2 : c.status === "recusada" || c.status === "conflito" || c.status === "cancelada" ? XCircle : Clock3;
        return (
          <li key={c.id}>
            <button type="button" onClick={() => setOpen(expanded ? null : c.id)} aria-expanded={expanded} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-hover">
              {expanded ? <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> : <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />}
              <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {c.kind === "provisionamento" ? "Criação da empresa" : c.initial ? "Licença inicial" : `${c.plan.length} ${c.plan.length === 1 ? "item" : "itens"}${c.controlMode ? " + modo de controle" : ""}`}
                  <Badge variant={CHANGE_STATUS_BADGE[c.status]} size="sm">
                    {ERP_CHANGE_STATUS_LABELS[c.status]}
                  </Badge>
                  {c.licenseVersion ? <span className="text-xs font-normal text-muted">v{c.licenseVersion}</span> : null}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted">
                  {fmtDateTime(c.requestedAt)} · {c.requestedBy.name} · {c.reason}
                </span>
              </span>
            </button>
            {expanded ? (
              <div className="flex flex-col gap-2 px-4 pb-4 pl-15 text-xs">
                {c.plan.length ? <PlanList change={c} nameOf={nameOf} /> : null}
                {c.controlMode ? <p>Modo de controle no ERP → {c.controlMode}</p> : null}
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  {c.contractReference ? (
                    <>
                      <dt className="text-muted">Contrato</dt>
                      <dd>{c.contractReference}</dd>
                    </>
                  ) : null}
                  {c.approval ? (
                    <>
                      <dt className="text-muted">Aprovação</dt>
                      <dd>
                        {c.approval.self ? "Pela própria pessoa (tem a permissão)" : c.approval.by.name} em {fmtDateTime(c.approval.at)}
                      </dd>
                    </>
                  ) : null}
                  {c.cancelled ? (
                    <>
                      <dt className="text-muted">Cancelada</dt>
                      <dd>
                        {c.cancelled.by.name} em {fmtDateTime(c.cancelled.at)}: {c.cancelled.reason}
                      </dd>
                    </>
                  ) : null}
                  {c.result ? (
                    <>
                      <dt className="text-muted">Resposta do ERP</dt>
                      <dd>
                        {RESULT_LABEL[c.result.status] ?? c.result.status} em {fmtDateTime(c.result.at)}
                        {c.result.appliedVersion ? ` · versão aplicada ${c.result.appliedVersion}` : ""}
                      </dd>
                    </>
                  ) : null}
                  {c.result?.rejectedItems.length ? (
                    <>
                      <dt className="text-muted">Recusados</dt>
                      <dd>{c.result.rejectedItems.map((r) => r.message).join("; ")}</dd>
                    </>
                  ) : null}
                  {c.lastError ? (
                    <>
                      <dt className="text-muted">Último erro</dt>
                      <dd>
                        {c.lastError.message} ({c.attempts} tentativa{c.attempts === 1 ? "" : "s"})
                      </dd>
                    </>
                  ) : null}
                  <dt className="text-muted">Referência</dt>
                  <dd className="break-all font-mono">
                    evento {c.id}
                    {c.requestIds.length ? ` · ERP ${c.requestIds.slice(-3).join(", ")}` : ""}
                  </dd>
                </dl>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
