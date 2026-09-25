"use client";

import * as React from "react";
import { Ban, PauseCircle, Play, ShieldCheck } from "lucide-react";
import type { ImplementationStatus } from "@/domain/types";
import { registerBlock, resolveBlock, resumeWaitingProject } from "@/server/implementation/actions";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { useImplementationAction } from "./use-implementation-action";
import { WaitingClientDialog } from "./waiting-client-dialog";

export interface PendingTabProps {
  projectId: string;
  clientName: string;
  status: ImplementationStatus;
  ownerId: string;
  waitingClient?: { reason: string; since: string; responsibleId: string; evidence?: string };
  blocked?: { reason: string; since: string; byId: string };
  externalDelayDays: number;
  internalDelayDays: number;
  users: { id: string; name: string }[];
  editable: boolean;
}

/**
 * Pendência do cliente (AGUARDANDO CLIENTE: SLA e etapa pausados, atraso externo) e bloqueio interno
 * (BLOQUEADA: SLA segue correndo, atraso interno). Separar as duas causas é o que permite medir o
 * SLA da equipe sem punir atrasos do cliente.
 */
export function PendingTab({ projectId, clientName, status, ownerId, waitingClient, blocked, externalDelayDays, internalDelayDays, users, editable }: PendingTabProps) {
  const { pending, run } = useImplementationAction();
  const [waitingOpen, setWaitingOpen] = React.useState(false);
  const [blockOpen, setBlockOpen] = React.useState(false);
  const names = new Map(users.map((u) => [u.id, u.name]));
  const active = status !== "concluida" && status !== "cancelada";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className={status === "aguardando_cliente" ? "border-warning/50" : undefined}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PauseCircle className="size-4 text-warning-fg" aria-hidden /> Pendência do cliente
          </CardTitle>
          <CardDescription>Atraso externo acumulado: {externalDelayDays.toLocaleString("pt-BR")} dia(s) útil(eis).</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          {waitingClient ? (
            <div role="status" className="rounded-md bg-warning-soft p-3 text-sm">
              <p className="font-medium text-warning-fg">Aguardando o cliente desde {formatDateTime(waitingClient.since)}</p>
              <p className="mt-1">{waitingClient.reason}</p>
              <p className="mt-1 text-xs text-muted">
                Acompanhamento: {names.get(waitingClient.responsibleId) ?? "—"}
                {waitingClient.evidence ? ` · Evidência: ${waitingClient.evidence}` : ""}
              </p>
              <p className="mt-1 text-xs text-muted">SLA do projeto e etapa da jornada pausados.</p>
            </div>
          ) : (
            <p className="text-sm text-muted">Nenhuma pendência do cliente em aberto.</p>
          )}
          {editable && active ? (
            waitingClient ? (
              <Button className="h-11 self-start md:h-9" loading={pending} onClick={() => run(() => resumeWaitingProject({ projectId }), "Implantação retomada: SLA voltou a contar")}>
                <Play /> Cliente respondeu: retomar
              </Button>
            ) : (
              <Button variant="outline" className="h-11 self-start md:h-9" disabled={status === "bloqueada"} onClick={() => setWaitingOpen(true)}>
                <PauseCircle /> Registrar pendência do cliente
              </Button>
            )
          ) : null}
        </CardContent>
      </Card>

      <Card className={status === "bloqueada" ? "border-danger/50" : undefined}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ban className="size-4 text-danger-fg" aria-hidden /> Bloqueio interno
          </CardTitle>
          <CardDescription>Atraso interno acumulado: {internalDelayDays.toLocaleString("pt-BR")} dia(s) útil(eis). O SLA não pausa.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          {blocked ? (
            <div role="status" className="rounded-md bg-danger-soft p-3 text-sm">
              <p className="font-medium text-danger-fg">Bloqueado desde {formatDateTime(blocked.since)}</p>
              <p className="mt-1">{blocked.reason}</p>
              <p className="mt-1 text-xs text-muted">Registrado por {names.get(blocked.byId) ?? "—"}</p>
            </div>
          ) : status === "bloqueada" ? (
            <p className="text-sm text-danger-fg">Projeto bloqueado (motivo não registrado).</p>
          ) : (
            <p className="text-sm text-muted">Nenhum bloqueio interno.</p>
          )}
          {editable && active ? (
            status === "bloqueada" ? (
              <Button className="h-11 self-start md:h-9" loading={pending} onClick={() => run(() => resolveBlock({ projectId }), "Bloqueio resolvido")}>
                <ShieldCheck /> Resolver bloqueio
              </Button>
            ) : (
              <Button variant="outline" className="h-11 self-start md:h-9" disabled={status === "aguardando_cliente"} onClick={() => setBlockOpen(true)}>
                <Ban /> Bloquear projeto
              </Button>
            )
          ) : null}
        </CardContent>
      </Card>

      {waitingOpen ? <WaitingClientDialog open onOpenChange={setWaitingOpen} projectId={projectId} clientName={clientName} users={users} defaultResponsibleId={ownerId} /> : null}
      {blockOpen ? <BlockDialog projectId={projectId} onClose={() => setBlockOpen(false)} /> : null}
    </div>
  );
}

function BlockDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { pending, run } = useImplementationAction();
  const [reason, setReason] = React.useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => registerBlock({ projectId, reason }), "Projeto bloqueado")) onClose();
  };
  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Bloquear projeto</DialogTitle>
            <DialogDescription>Use para impedimentos internos (equipe, ambiente, fornecedor). Pendências do cliente pausam o SLA e devem ser registradas como pendência do cliente.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <FormField label="Motivo" htmlFor="block-reason" required>
              <Textarea id="block-reason" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" loading={pending}>
              Bloquear
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
