"use client";

import * as React from "react";
import Link from "next/link";
import { Building2, CalendarDays, FileSignature, GitBranch, Pencil, Users } from "lucide-react";
import type { ProjectRow, UserLite } from "@/server/implementation/queries";
import { updateTeam } from "@/server/implementation/actions";
import { WORKFLOW_STEP_STATUS_LABELS, type WorkflowStepStatus } from "@/domain/constants";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { IMPLEMENTATION_PHASE_LABELS, IMPLEMENTATION_STATUS_LABELS, IMPLEMENTATION_STATUS_VARIANT } from "@/components/clients/labels";
import type { SlaState } from "@/domain/constants";
import { ProductChips, progressTone } from "./projects-table";
import { SlaCountdown } from "./sla-countdown";
import { useImplementationAction } from "./use-implementation-action";

export interface ProjectHeaderProps {
  row: ProjectRow;
  scope?: string;
  client: { id: string; tradeName: string };
  contract: { id: string; number: string; releasedAt?: string } | null;
  sla: { state: SlaState; remainingMs: number; dueAt: string } | null;
  users: UserLite[];
  workflowStep: { id: string; status: WorkflowStepStatus; stageName: string } | null;
  requiredDone: number;
  requiredTotal: number;
  editable: boolean;
}

/** Cabeçalho do projeto: cliente, produtos, responsável e equipe (editar), datas, SLA, status e progresso. */
export function ProjectHeader({ row, scope, client, contract, sla, users, workflowStep, requiredDone, requiredTotal, editable }: ProjectHeaderProps) {
  const [editing, setEditing] = React.useState(false);
  const names = new Map(users.map((u) => [u.id, u]));
  const team = row.teamIds.filter((id) => id !== row.ownerId).map((id) => names.get(id)).filter((u): u is UserLite => Boolean(u));

  return (
    <Card className="mb-5">
      <CardContent className="flex flex-col gap-4 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/clientes/${client.id}?aba=implantacao`} className="inline-flex items-center gap-1.5 text-lg font-semibold hover:underline">
                <Building2 className="size-4 text-muted" aria-hidden /> {client.tradeName}
              </Link>
              <Badge variant={IMPLEMENTATION_STATUS_VARIANT[row.status]}>{IMPLEMENTATION_STATUS_LABELS[row.status]}</Badge>
              <Badge variant="outline">{IMPLEMENTATION_PHASE_LABELS[row.currentPhase]}</Badge>
            </div>
            {scope ? <p className="mt-1 text-sm text-muted">{scope}</p> : null}
            <div className="mt-2">
              <ProductChips products={row.products} max={8} />
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-1 md:items-end">
            {sla ? <SlaCountdown state={sla.state} remainingMs={sla.remainingMs} /> : <span className="text-xs text-muted">Sem SLA</span>}
            {sla ? <span className="text-xs text-muted">Prazo do SLA: {formatDate(sla.dueAt, "dd/MM/yyyy HH:mm")}</span> : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="label-caps mb-1.5">Progresso</p>
            <Progress value={row.progress} showValue tone={progressTone(row)} />
            <p className="mt-1 text-xs text-muted">
              {requiredDone}/{requiredTotal} tarefas obrigatórias concluídas
            </p>
          </div>
          <div>
            <p className="label-caps mb-1.5 flex items-center gap-1">
              <CalendarDays className="size-3.5" aria-hidden /> Datas
            </p>
            <p className="text-sm">
              Início {formatDate(row.startDate)} · <span className={cn(row.overdue && "font-medium text-danger-fg")}>Prazo {formatDate(row.dueDate)}</span>
            </p>
            <p className="text-xs text-muted">
              {row.goLiveAt ? `Go-live ${formatDate(row.goLiveAt)}` : row.overdue ? `${row.daysLate} dia(s) de atraso` : "Go-live pendente"} · Atraso int. {row.internalDelayDays.toLocaleString("pt-BR")}d / ext.{" "}
              {row.externalDelayDays.toLocaleString("pt-BR")}d
            </p>
          </div>
          <div>
            <p className="label-caps mb-1.5 flex items-center gap-1">
              <Users className="size-3.5" aria-hidden /> Responsável e equipe
            </p>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-2 text-sm">
                <Avatar name={row.ownerName} src={row.ownerAvatarUrl} size="xs" /> {row.ownerName}
              </span>
              {team.length > 0 ? (
                <span className="flex -space-x-1.5" title={team.map((u) => u.name).join(", ")}>
                  {team.slice(0, 4).map((u) => (
                    <Avatar key={u.id} name={u.name} src={u.avatarUrl} size="xs" className="ring-2 ring-surface" />
                  ))}
                </span>
              ) : null}
              {editable ? (
                <Button variant="ghost" size="icon" className="size-11 md:size-8" aria-label="Editar responsável e equipe" onClick={() => setEditing(true)}>
                  <Pencil />
                </Button>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <p className="label-caps mb-0.5">Vínculos</p>
            {contract ? (
              <Link href={`/financeiro/contratos/${contract.id}`} className="inline-flex items-center gap-1.5 hover:underline">
                <FileSignature className="size-3.5 text-muted" aria-hidden /> Contrato {contract.number}
                {contract.releasedAt ? <span className="text-xs text-muted">· liberado {formatDate(contract.releasedAt)}</span> : null}
              </Link>
            ) : (
              <span className="text-muted">Sem contrato vinculado</span>
            )}
            {workflowStep ? (
              <Link href={`/workflow?etapa=${workflowStep.id}`} className="inline-flex items-center gap-1.5 hover:underline">
                <GitBranch className="size-3.5 text-muted" aria-hidden /> Etapa {workflowStep.stageName}: {WORKFLOW_STEP_STATUS_LABELS[workflowStep.status]}
              </Link>
            ) : null}
          </div>
        </div>
      </CardContent>
      {editing ? <TeamDialog projectId={row.id} ownerId={row.ownerId} teamIds={row.teamIds} users={users} onClose={() => setEditing(false)} /> : null}
    </Card>
  );
}

function TeamDialog({ projectId, ownerId, teamIds, users, onClose }: { projectId: string; ownerId: string; teamIds: string[]; users: UserLite[]; onClose: () => void }) {
  const { pending, run } = useImplementationAction();
  const [owner, setOwner] = React.useState(ownerId);
  const [team, setTeam] = React.useState<string[]>(teamIds);
  const candidates = users.filter((u) => u.departmentId === "implantacao" || u.departmentId === "suporte" || teamIds.includes(u.id));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => updateTeam({ projectId, ownerId: owner, teamIds: team }), "Equipe atualizada")) onClose();
  };
  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Responsável e equipe</DialogTitle>
            <DialogDescription>O responsável assume o SLA do projeto e passa a ser o implantador do cliente.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <FormField label="Responsável" htmlFor="team-owner" required>
              <Select id="team-owner" value={owner} onChange={(e) => setOwner(e.target.value)} required>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.jobTitle ? ` — ${u.jobTitle}` : ""}
                  </option>
                ))}
              </Select>
            </FormField>
            <fieldset>
              <legend className="mb-1 text-[13px] font-medium">Equipe</legend>
              <div className="flex flex-col rounded-lg border border-border px-3 py-1">
                {candidates.map((u) => (
                  <Checkbox
                    key={u.id}
                    label={u.name}
                    description={u.jobTitle}
                    checked={u.id === owner || team.includes(u.id)}
                    disabled={u.id === owner}
                    onCheckedChange={(v) => setTeam((cur) => (v === true ? [...cur, u.id] : cur.filter((id) => id !== u.id)))}
                  />
                ))}
              </div>
            </fieldset>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
