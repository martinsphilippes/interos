"use client";

import * as React from "react";
import { CheckCircle2, CircleAlert, PartyPopper, Rocket } from "lucide-react";
import type { GoLiveGate } from "@/server/implementation/schemas";
import { approveProjectGoLive, saveAcceptance, saveValidation } from "@/server/implementation/actions";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateInput, dateValueToIso, isoToDateValue } from "@/components/ui/date-input";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useImplementationAction } from "./use-implementation-action";

export interface GoLivePanelProps {
  projectId: string;
  clientName: string;
  gate: GoLiveGate;
  status: string;
  goLiveAt?: string;
  validation?: { validatedBy: string; validatedAt: string; notes?: string };
  acceptance?: { acceptedBy: string; acceptedAt: string; notes?: string };
  editable: boolean;
  canApprove: boolean;
  requiresManager: boolean;
  currentUserName: string;
  defaultContactName?: string;
  /** Hoje (AAAA-MM-DD, fuso da operação) calculado no servidor, para os campos de data. */
  today: string;
}

/** Lista de exigências do gate de go-live com o que falta em cada uma. */
export function GateChecklist({ gate, compact }: { gate: GoLiveGate; compact?: boolean }) {
  return (
    <ul className={cn("flex flex-col", compact ? "gap-1" : "gap-2")}>
      {gate.checks.map((c) => (
        <li key={c.key} className="flex items-start gap-2 text-sm">
          {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning-fg" aria-hidden />}
          <span>
            <span className={cn(c.ok ? "text-foreground" : "font-medium")}>{c.label}</span>
            {!c.ok && c.detail ? <span className="block text-xs text-muted">{c.detail}</span> : null}
          </span>
          <span className="sr-only">{c.ok ? "atendido" : "pendente"}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * GATE de go-live: exigências (checklist, tarefas, treinamento, validação, aceite), registro da
 * validação interna e do aceite do cliente e a aprovação (gestor/admin, ou o responsável quando a
 * configuração "go_live" permitir). A aprovação ativa o cliente e faz o handoff para o CS.
 */
export function GoLivePanel({ projectId, clientName, gate, status, goLiveAt, validation, acceptance, editable, canApprove, requiresManager, currentUserName, defaultContactName, today }: GoLivePanelProps) {
  const { pending, run } = useImplementationAction();
  const [confirm, setConfirm] = React.useState(false);
  const [validatedBy, setValidatedBy] = React.useState(validation?.validatedBy ?? currentUserName);
  const [validatedAt, setValidatedAt] = React.useState(isoToDateValue(validation?.validatedAt) || today);
  const [validationNotes, setValidationNotes] = React.useState(validation?.notes ?? "");
  const [acceptedBy, setAcceptedBy] = React.useState(acceptance?.acceptedBy ?? defaultContactName ?? "");
  const [acceptedAt, setAcceptedAt] = React.useState(isoToDateValue(acceptance?.acceptedAt) || today);
  const [acceptanceNotes, setAcceptanceNotes] = React.useState(acceptance?.notes ?? "");
  const done = status === "concluida";
  const formsEnabled = editable && !done && status !== "cancelada";

  if (done) {
    return (
      <Card className="border-success/40">
        <CardContent className="flex flex-col items-start gap-2 py-6">
          <PartyPopper className="size-6 text-success" aria-hidden />
          <p className="text-base font-semibold">Go-live registrado em {formatDateTime(goLiveAt)}</p>
          <p className="text-sm text-muted">
            Validação: {validation?.validatedBy ?? "—"} ({formatDate(validation?.validatedAt)}) · Aceite: {acceptance?.acceptedBy ?? "—"} ({formatDate(acceptance?.acceptedAt)})
            {acceptance?.notes ? ` · ${acceptance.notes}` : ""}
          </p>
          <p className="text-sm text-muted">O cliente foi ativado e entregue ao Customer Success (conta, health score inicial e tarefa de onboarding).</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardHeader>
          <CardTitle>Gate de go-live</CardTitle>
          <CardDescription>{gate.ok ? "Tudo pronto para aprovar." : `${gate.checks.filter((c) => !c.ok).length} exigência(s) pendente(s).`}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          <GateChecklist gate={gate} />
          <div className="rounded-md bg-surface-muted p-3 text-xs text-muted">
            Aprovação: {requiresManager ? "somente gestores ou administradores." : "gestores, administradores ou o responsável pelo projeto."} Ao aprovar: projeto concluído, produtos ativos, cliente ativo em
            Customer Success e handoff (conta de CS, health score inicial e tarefa de onboarding em 3 dias úteis).
          </div>
          {editable ? (
            <Button className="h-11 self-start" disabled={!gate.ok || !canApprove} onClick={() => setConfirm(true)}>
              <Rocket /> Aprovar go-live
            </Button>
          ) : null}
          {editable && gate.ok && !canApprove ? <p className="text-xs text-muted">Aguardando aprovação de um gestor.</p> : null}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Validação interna</CardTitle>
            <CardDescription>{validation ? `Registrada: ${validation.validatedBy} em ${formatDate(validation.validatedAt)}` : "Quem conferiu a implantação antes do go-live."}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => saveValidation({ projectId, validatedBy, validatedAt: dateValueToIso(validatedAt), notes: validationNotes }), "Validação registrada");
              }}
            >
              <FormField label="Validado por" htmlFor="gl-vby" required>
                <Input id="gl-vby" value={validatedBy} onChange={(e) => setValidatedBy(e.target.value)} disabled={!formsEnabled} required maxLength={120} className="h-11 md:h-9" />
              </FormField>
              <FormField label="Data" htmlFor="gl-vat" required>
                <DateInput id="gl-vat" value={validatedAt} onChange={(e) => setValidatedAt(e.target.value)} disabled={!formsEnabled} required className="h-11 md:h-9" />
              </FormField>
              <FormField label="Observações" htmlFor="gl-vnotes" className="sm:col-span-2">
                <Input id="gl-vnotes" value={validationNotes} onChange={(e) => setValidationNotes(e.target.value)} disabled={!formsEnabled} maxLength={1000} className="h-11 md:h-9" />
              </FormField>
              {formsEnabled ? (
                <Button type="submit" variant="outline" loading={pending} className="h-11 sm:col-span-2 sm:justify-self-start md:h-9">
                  {validation ? "Atualizar validação" : "Registrar validação"}
                </Button>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Aceite do cliente</CardTitle>
            <CardDescription>{acceptance ? `Registrado: ${acceptance.acceptedBy} em ${formatDate(acceptance.acceptedAt)}` : "Quem aceitou a entrega pelo cliente."}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => saveAcceptance({ projectId, acceptedBy, acceptedAt: dateValueToIso(acceptedAt), notes: acceptanceNotes }), "Aceite do cliente registrado");
              }}
            >
              <FormField label="Quem aceitou" htmlFor="gl-aby" required>
                <Input id="gl-aby" value={acceptedBy} onChange={(e) => setAcceptedBy(e.target.value)} disabled={!formsEnabled} required maxLength={120} className="h-11 md:h-9" />
              </FormField>
              <FormField label="Data do aceite" htmlFor="gl-aat" required>
                <DateInput id="gl-aat" value={acceptedAt} onChange={(e) => setAcceptedAt(e.target.value)} disabled={!formsEnabled} required className="h-11 md:h-9" />
              </FormField>
              <FormField label="Observação" htmlFor="gl-anotes" className="sm:col-span-2">
                <Textarea id="gl-anotes" value={acceptanceNotes} onChange={(e) => setAcceptanceNotes(e.target.value)} disabled={!formsEnabled} maxLength={1000} className="min-h-[64px]" />
              </FormField>
              {formsEnabled ? (
                <Button type="submit" variant="outline" loading={pending} className="h-11 sm:col-span-2 sm:justify-self-start md:h-9">
                  {acceptance ? "Atualizar aceite" : "Registrar aceite"}
                </Button>
              ) : null}
            </form>
          </CardContent>
        </Card>
      </div>

      {confirm ? (
        <ConfirmDialog
          open
          onOpenChange={setConfirm}
          title={`Aprovar go-live de ${clientName}?`}
          description="O projeto será concluído, os produtos ativados e o cliente entregue ao Customer Success. Esta ação encerra o SLA do projeto."
          confirmLabel="Aprovar go-live"
          onConfirm={async () => {
            await run(() => approveProjectGoLive({ projectId }), (d) => `Go-live aprovado! Handoff para ${d.csOwnerName}.`);
          }}
        />
      ) : null}
    </div>
  );
}
