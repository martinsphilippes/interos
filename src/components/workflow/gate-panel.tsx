"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, Database, FileCheck2, PenLine, ShieldCheck, ShieldX, XCircle } from "lucide-react";
import type { GateField } from "@/domain/types";
import { ROLE_LABELS } from "@/domain/constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { approveGateAction, completeGateAction, rejectGateAction, toggleStepChecklistAction, updateStepFieldsAction, type CompleteGateActionResult, type GateBlockedError } from "@/server/workflow/actions";
import type { GateFieldView } from "@/server/workflow/gates";
import type { StepDetail } from "./workflow-model";

export interface GatePanelProps {
  detail: StepDetail;
  /** Chamado após concluir com sucesso (ex.: abrir a próxima etapa no drawer). */
  onCompleted?: (nextStepId: string | undefined, instanceCompleted: boolean) => void;
}

const SOURCE_LABEL: Record<GateFieldView["source"], { label: string; variant: "success" | "info" | "danger"; icon: React.ReactNode }> = {
  sistema: { label: "Do sistema", variant: "success", icon: <Database /> },
  manual: { label: "Preenchido manualmente", variant: "info", icon: <PenLine /> },
  vazio: { label: "Faltando", variant: "danger", icon: <XCircle /> },
};

function draftValue(field: GateFieldView): string {
  if (field.source !== "manual" || field.value === undefined || field.value === null) return "";
  if (field.type === "booleano") return field.value === true ? "true" : "false";
  if (field.type === "data" && typeof field.value === "string") return field.value.slice(0, 10);
  return String(field.value);
}

/**
 * Aba "Gate": campos obrigatórios (origem do valor + preenchimento manual), checklist, documentos,
 * aprovação e o botão que conclui a etapa. Gestores podem informar motivo de exceção para passar com pendências.
 */
export function GatePanel({ detail, onCompleted }: GatePanelProps) {
  const router = useRouter();
  const { step, stage, gate, nextStage, canApprove, canException, approverNames } = detail;
  const [pending, startTransition] = React.useTransition();
  const [drafts, setDrafts] = React.useState<Record<string, string>>(() => Object.fromEntries(gate.fields.map((f) => [f.path, draftValue(f)])));
  const [prevUpdatedAt, setPrevUpdatedAt] = React.useState(step.updatedAt);
  const [exceptionReason, setExceptionReason] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [blocked, setBlocked] = React.useState<GateBlockedError | null>(null);
  const [rejecting, setRejecting] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");

  if (step.updatedAt !== prevUpdatedAt) {
    setPrevUpdatedAt(step.updatedAt);
    setDrafts(Object.fromEntries(gate.fields.map((f) => [f.path, draftValue(f)])));
  }

  const isOpen = step.status === "em_andamento" || step.status === "aguardando_cliente" || step.status === "aguardando_aprovacao";
  const awaitingApproval = step.status === "aguardando_aprovacao";
  const editable = isOpen && !awaitingApproval;
  const checklistPct = gate.checklist.length ? Math.round((gate.checklist.filter((c) => c.done).length / gate.checklist.length) * 100) : 0;
  const dirtyFields = Object.fromEntries(Object.entries(drafts).filter(([path, value]) => value !== draftValue(gate.fields.find((f) => f.path === path)!)));
  const hasDirty = Object.keys(dirtyFields).length > 0;
  const missingAfterDrafts = gate.fields.filter((f) => !f.filled && !(drafts[f.path] ?? "").trim());
  const canCompleteNow = gate.ok || (missingAfterDrafts.length === 0 && gate.missingChecklist.length === 0 && !gate.needsDocuments);

  const handleResult = (result: CompleteGateActionResult, successVerb: string) => {
    if (!result.ok) {
      if ("blocked" in result) setBlocked(result.blocked);
      toast.error(result.error);
      return;
    }
    setBlocked(null);
    if (result.data.status === "awaiting_approval") {
      toast.info(`Etapa enviada para aprovação${result.data.approverNames?.length ? ` de ${result.data.approverNames.join(", ")}` : ""}.`);
      router.refresh();
      return;
    }
    toast.success(result.data.instanceCompleted ? "Jornada concluída." : `${successVerb} — próxima etapa: ${result.data.nextStageName ?? "—"}.`);
    router.refresh();
    onCompleted?.(result.data.nextStepId, Boolean(result.data.instanceCompleted));
  };

  const saveFields = () =>
    startTransition(async () => {
      const result = await updateStepFieldsAction({ stepId: step.id, fields: dirtyFields });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Campos do gate salvos");
      router.refresh();
    });

  const toggle = (itemId: string, done: boolean) =>
    startTransition(async () => {
      const result = await toggleStepChecklistAction({ stepId: step.id, itemId, done });
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });

  const complete = () =>
    startTransition(async () => {
      const result = await completeGateAction({
        stepId: step.id,
        fields: hasDirty ? dirtyFields : undefined,
        notes: notes.trim() || undefined,
        exceptionReason: canException && exceptionReason.trim() ? exceptionReason.trim() : undefined,
      });
      handleResult(result, "Etapa concluída");
    });

  const approve = () =>
    startTransition(async () => {
      const result = await approveGateAction({ stepId: step.id });
      handleResult(result, "Etapa aprovada e concluída");
    });

  const reject = async () => {
    const result = await rejectGateAction({ stepId: step.id, reason: rejectReason.trim() });
    if (!result.ok) throw new Error(result.error);
    toast.success("Aprovação rejeitada; a etapa voltou para o responsável.");
    setRejectReason("");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Critério de saída */}
      <section className="rounded-lg border border-border bg-surface-muted px-4 py-3">
        <p className="label-caps">Gate · {stage.gate.name}</p>
        <p className="mt-1 text-sm text-foreground">{stage.gate.exitCriteria}</p>
        {step.status === "concluida" ? (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-success-fg">
            <CheckCircle2 className="size-4" /> Concluída {detail.completedAtLabel ? `em ${detail.completedAtLabel}` : ""}
            {step.exceptionReason ? <span className="text-warning-fg"> · por exceção: {step.exceptionReason}</span> : null}
          </p>
        ) : null}
      </section>

      {/* Campos obrigatórios */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Campos obrigatórios</h3>
          <span className="text-xs tabular-nums text-muted">
            {gate.fields.filter((f) => f.filled).length}/{gate.fields.length}
          </span>
        </div>
        {gate.fields.length === 0 ? <p className="text-sm text-muted">Esta etapa não exige campos.</p> : null}
        <ul className="flex flex-col gap-2">
          {gate.fields.map((field) => {
            const source = SOURCE_LABEL[field.source];
            const highlighted = blocked?.missingFields.some((m) => m.path === field.path);
            return (
              <li key={field.path} className={cn("rounded-lg border px-3 py-2.5", field.filled ? "border-border" : "border-danger/40 bg-danger-soft/30", highlighted && "ring-2 ring-danger/40")}>
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{field.label}</p>
                    <p className="text-xs text-muted">
                      <code className="text-[11px]">{field.path}</code>
                      {field.filled ? <span className="ml-2 text-foreground">{field.display}</span> : null}
                    </p>
                  </div>
                  <Badge variant={source.variant} size="sm" className="gap-1">
                    {source.icon}
                    {source.label}
                  </Badge>
                </div>
                {editable && field.source !== "sistema" ? (
                  <div className="mt-2">
                    <FieldInput field={field} value={drafts[field.path] ?? ""} disabled={pending} onChange={(v) => setDrafts((d) => ({ ...d, [field.path]: v }))} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {editable && hasDirty ? (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" loading={pending} onClick={saveFields}>
              Salvar preenchimento
            </Button>
          </div>
        ) : null}
      </section>

      {/* Checklist */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Checklist</h3>
          {gate.checklist.length > 0 ? (
            <span className="text-xs tabular-nums text-muted">
              {gate.checklist.filter((c) => c.done).length}/{gate.checklist.length}
            </span>
          ) : null}
        </div>
        {gate.checklist.length > 0 ? <Progress value={checklistPct} size="sm" tone={checklistPct === 100 ? "success" : "brand"} /> : <p className="text-sm text-muted">Sem checklist.</p>}
        <ul className="flex flex-col">
          {gate.checklist.map((item) => {
            const highlighted = blocked?.missingChecklist.some((m) => m.key === item.key);
            return (
              <li key={item.key} className={cn("rounded-md px-1", highlighted && "bg-danger-soft/40")}>
                <Checkbox
                  checked={item.done}
                  disabled={!editable || pending}
                  onCheckedChange={(v) => toggle(item.key, v === true)}
                  label={
                    <span className={cn(item.done && "text-muted line-through")}>
                      {item.label}
                      {!item.required ? <span className="ml-1 text-xs text-muted-light">(opcional)</span> : null}
                    </span>
                  }
                />
              </li>
            );
          })}
        </ul>
      </section>

      {/* Documentos */}
      {stage.gate.requiresDocuments ? (
        <section className={cn("flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm", gate.needsDocuments ? "border-danger/40 bg-danger-soft/30 text-danger-fg" : "border-border text-foreground")}>
          <FileCheck2 className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Documentos obrigatórios</p>
            <p className="text-xs">{gate.documentsCount > 0 ? `${gate.documentsCount} documento(s) anexado(s) ao cliente.` : "Nenhum documento anexado ao cliente. Anexe na aba Documentos do cliente."}</p>
          </div>
        </section>
      ) : null}

      {/* Aprovação */}
      {stage.gate.requiresApproval ? (
        <section className={cn("rounded-lg border px-3 py-2.5 text-sm", awaitingApproval ? "border-info/40 bg-info-soft/40" : "border-border")}>
          <p className="flex items-center gap-2 font-medium">
            <ShieldCheck className="size-4 text-info-fg" /> Requer aprovação{stage.gate.approverRole ? ` (${ROLE_LABELS[stage.gate.approverRole]})` : ""}
          </p>
          <p className="mt-1 text-xs text-muted">
            {step.approval?.approvedAt ? "Aprovada." : awaitingApproval ? `Aguardando aprovação${approverNames.length ? ` de ${approverNames.join(", ")}` : ""}.` : approverNames.length ? `Ao concluir, o pedido vai para ${approverNames.join(", ")}.` : "Nenhum aprovador ativo encontrado; um gestor ou administrador poderá aprovar."}
            {step.approval?.rejectedAt && !step.approval.approvedAt ? <span className="block text-danger-fg">Última rejeição: {step.approval.reason}</span> : null}
          </p>
          {awaitingApproval && canApprove ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" loading={pending} onClick={approve}>
                <ShieldCheck /> Aprovar e concluir
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => setRejecting(true)}>
                <ShieldX /> Rejeitar
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Erros do gate */}
      {blocked ? (
        <section className="rounded-lg border border-danger/40 bg-danger-soft/40 px-3 py-2.5 text-sm text-danger-fg" role="alert">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" /> O gate ainda não foi atendido
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {blocked.missingFields.map((f) => (
              <li key={f.path}>Campo: {f.label}</li>
            ))}
            {blocked.missingChecklist.map((c) => (
              <li key={c.key}>Checklist: {c.label}</li>
            ))}
            {blocked.needsDocuments ? <li>Documentos anexados</li> : null}
          </ul>
        </section>
      ) : null}

      {/* Conclusão */}
      {editable ? (
        <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gate-notes">Observação ao concluir (opcional)</Label>
            <Textarea id="gate-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contexto para a próxima etapa…" disabled={pending} className="min-h-[64px]" />
          </div>
          {canException && !canCompleteNow ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gate-exception">Motivo de exceção (gestor/admin)</Label>
              <Textarea id="gate-exception" value={exceptionReason} onChange={(e) => setExceptionReason(e.target.value)} placeholder="Permite concluir mesmo com pendências. Fica registrado no histórico." disabled={pending} className="min-h-[64px]" />
            </div>
          ) : null}
          {!canCompleteNow && !canException ? <p className="text-xs text-muted">Preencha os campos e o checklist obrigatórios para liberar a conclusão. Gestores podem concluir por exceção.</p> : null}
          <Button loading={pending} disabled={!canCompleteNow && !(canException && exceptionReason.trim())} onClick={complete} className="w-full sm:w-auto sm:self-end" size="lg">
            {nextStage ? (
              <>
                Concluir etapa e entregar para {nextStage.name} <ArrowRight />
              </>
            ) : (
              <>
                <CheckCircle2 /> Concluir última etapa da jornada
              </>
            )}
          </Button>
        </section>
      ) : null}

      <ConfirmDialog
        open={rejecting}
        onOpenChange={(o) => !o && setRejecting(false)}
        title="Rejeitar aprovação?"
        description="A etapa volta para o responsável com o motivo informado."
        confirmLabel="Rejeitar"
        destructive
        onConfirm={reject}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reject-reason" required>
            Motivo
          </Label>
          <Textarea id="reject-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="O que precisa ser corrigido?" className="min-h-[72px]" />
        </div>
      </ConfirmDialog>
    </div>
  );
}

function FieldInput({ field, value, disabled, onChange }: { field: GateField; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const id = `gate-${field.path.replace(/\./g, "-")}`;
  if (field.type === "booleano") {
    return (
      <Select id={id} size="sm" aria-label={field.label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">Não informado</option>
        <option value="true">Sim</option>
        <option value="false">Não</option>
      </Select>
    );
  }
  if (field.type === "selecao") {
    return (
      <Select id={id} size="sm" aria-label={field.label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder="Selecione…" options={(field.options ?? []).map((o) => ({ value: o, label: o }))}>
        {field.options?.length ? null : (
          <>
            <option value="aprovado">aprovado</option>
            <option value="pendente">pendente</option>
            <option value="pendencia">pendencia</option>
          </>
        )}
      </Select>
    );
  }
  if (field.type === "data") {
    return <DateInput id={id} mode="date" aria-label={field.label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="h-8 text-[13px]" />;
  }
  return <Input id={id} type={field.type === "numero" ? "number" : "text"} inputMode={field.type === "numero" ? "decimal" : undefined} aria-label={field.label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder={`Informe ${field.label.toLowerCase()}`} className="h-8 text-[13px]" />;
}
