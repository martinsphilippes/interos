"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Building2,
  CalendarClock,
  CalendarPlus,
  ExternalLink,
  FilePlus2,
  FileSignature,
  Kanban,
  MapPin,
  MoreVertical,
  RotateCcw,
  Trophy,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateInput, dateValueToIso, isoToDateTimeLocal } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { changeOpportunityStage, reopenOpportunityAction, scheduleOpportunityNextAction, transferOpportunityAction } from "@/server/sales/actions";
import type { OpenStage } from "@/server/sales/schemas";
import type { WorkspaceDetail } from "@/server/sales/workspace-queries";
import { LostDialog } from "../lost-dialog";
import { isOpenStage, opportunityHref } from "../model";
import { ProposalEditorDialog } from "../proposal-editor-dialog";
import { useSalesUrl } from "../use-sales-url";
import { VisitFormDialog } from "../visit-form-dialog";
import { WonDialog } from "../won-dialog";

type DialogKind = "transferir" | "ganho" | "perdido" | "proposta" | "visita" | "proxima" | "reabrir";

/** Seletor de estágio (etapas abertas); ganho/perdido têm diálogos próprios. */
export function StageSelect({ detail, className }: { detail: WorkspaceDetail; className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const opp = detail.opportunity;
  const change = (stage: string) => {
    if (!stage || stage === opp.stage) return;
    startTransition(async () => {
      const result = await changeOpportunityStage({ opportunityId: opp.id, stage: stage as OpenStage });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Estágio alterado para ${detail.stages.find((s) => s.key === stage)?.label ?? stage}`);
      router.refresh();
    });
  };
  return (
    <Select
      aria-label="Mudar estágio"
      size="sm"
      value={opp.stage}
      onChange={(e) => change(e.target.value)}
      disabled={pending || !detail.canEdit || !isOpenStage(opp.stage)}
      className={cn("w-auto min-w-[150px]", className)}
      options={detail.stages.map((s) => ({ value: s.key, label: s.label }))}
    />
  );
}

/**
 * Ações da oportunidade no workspace: Transferir, Agendar (visita ou próxima ação), Marcar como ganho e
 * menu com Perdido, Criar proposta, Reabrir e atalhos. Todas chamam Server Actions já existentes.
 */
export function OpportunityActions({ detail, currentUserId, isManager, className }: { detail: WorkspaceDetail; currentUserId: string; isManager: boolean; className?: string }) {
  const router = useRouter();
  const { navigate } = useSalesUrl();
  const [dialog, setDialog] = React.useState<DialogKind | null>(null);
  const opp = detail.opportunity;
  const open = isOpenStage(opp.stage);
  const close = () => setDialog(null);
  const touch = "min-h-[44px] md:min-h-0";

  const reopen = async () => {
    const result = await reopenOpportunityAction({ opportunityId: opp.id });
    if (!result.ok) {
      toast.error(result.error);
      throw new Error(result.error);
    }
    toast.success("Oportunidade reaberta");
    router.refresh();
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {open && detail.canEdit ? (
        <>
          <Button variant="outline" size="sm" className={touch} onClick={() => setDialog("transferir")}>
            <ArrowLeftRight /> Transferir
          </Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className={touch}>
                <CalendarPlus /> Agendar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDialog("visita")}>
                <MapPin /> Agendar visita
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog("proxima")}>
                <CalendarClock /> Agendar próxima ação
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" className={touch} onClick={() => setDialog("ganho")}>
            <Trophy /> Marcar como ganho
          </Button>
        </>
      ) : null}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-11 md:size-9" aria-label="Mais ações">
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          {open && detail.canEdit ? (
            <>
              <DropdownMenuItem onSelect={() => setDialog("proposta")}>
                <FilePlus2 /> Criar proposta
              </DropdownMenuItem>
              <DropdownMenuItem destructive onSelect={() => setDialog("perdido")}>
                <XCircle /> Marcar como perdido
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {opp.stage === "perdido" && detail.canEdit ? (
            <>
              <DropdownMenuItem onSelect={() => setDialog("reabrir")}>
                <RotateCcw /> Reabrir oportunidade
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {opp.stage === "ganho" && opp.contractId ? (
            <DropdownMenuItem asChild>
              <Link href={`/financeiro/contratos?contrato=${opp.contractId}`}>
                <FileSignature /> Ver contrato
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem asChild>
            <Link href={`/clientes/${detail.client.id}`}>
              <Building2 /> Ficha do cliente (360º)
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={opportunityHref(opp.id)}>
              <ExternalLink /> Detalhes completos
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/vendas/pipeline">
              <Kanban /> Ver no pipeline
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === "transferir" ? (
        <TransferDialog
          detail={detail}
          onClose={close}
          onDone={(stillVisible) => {
            close();
            // Sem acesso depois de transferir: sai da seleção (a navegação já traz os dados novos).
            if (!stillVisible) navigate({ oportunidade: null, tela: null }, { replace: true });
            else router.refresh();
          }}
        />
      ) : null}
      {dialog === "ganho" ? (
        <WonDialog
          open
          onOpenChange={(v) => !v && close()}
          opportunity={opp}
          clientDefaults={{ legalName: detail.client.legalName, document: detail.client.document, email: detail.client.email }}
          products={detail.products}
        />
      ) : null}
      {dialog === "perdido" ? <LostDialog open onOpenChange={(v) => !v && close()} opportunity={opp} /> : null}
      {dialog === "proposta" ? <ProposalEditorDialog open onOpenChange={(v) => !v && close()} opportunity={opp} products={detail.products} /> : null}
      {dialog === "visita" ? (
        <VisitFormDialog
          open
          onOpenChange={(v) => !v && close()}
          options={{
            clients: [{ id: detail.client.id, tradeName: detail.client.tradeName, status: detail.client.status }],
            sellers: detail.transferTargets.concat(detail.users[opp.ownerId] ? [detail.users[opp.ownerId]] : []),
            addresses: { [detail.client.id]: detail.client.address ?? {} },
            opportunitiesByClient: { [detail.client.id]: [{ id: opp.id, title: opp.title }] },
          }}
          currentUserId={opp.ownerId === currentUserId || !isManager ? currentUserId : opp.ownerId}
          canChooseSeller={isManager}
          defaults={{ clientId: detail.client.id, opportunityId: opp.id }}
          onCreated={() => undefined}
        />
      ) : null}
      {dialog === "proxima" ? <NextActionDialog opportunityId={opp.id} currentAction={opp.nextAction} currentAt={opp.nextActionAt} onClose={close} /> : null}
      <ConfirmDialog
        open={dialog === "reabrir"}
        onOpenChange={(v) => !v && close()}
        title="Reabrir oportunidade?"
        description="Ela volta para o funil (negociação se havia proposta, senão qualificação) e o motivo da perda é removido."
        confirmLabel="Reabrir"
        onConfirm={reopen}
      />
    </div>
  );
}

function TransferDialog({ detail, onClose, onDone }: { detail: WorkspaceDetail; onClose: () => void; onDone: (stillVisible: boolean) => void }) {
  const id = React.useId();
  const [ownerId, setOwnerId] = React.useState(detail.transferTargets[0]?.id ?? "");
  const [reason, setReason] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const current = detail.users[detail.opportunity.ownerId]?.name ?? "—";

  const submit = () =>
    startTransition(async () => {
      const result = await transferOpportunityAction({ opportunityId: detail.opportunity.id, ownerId, reason });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const name = detail.transferTargets.find((t) => t.id === ownerId)?.name ?? "o novo vendedor";
      toast.success(`Oportunidade transferida para ${name}`);
      onDone(result.data.stillVisible);
    });

  return (
    <Dialog open onOpenChange={(v) => !pending && !v && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="size-5 text-secondary" /> Transferir oportunidade
          </DialogTitle>
          <DialogDescription>
            Hoje com {current}. Tarefas abertas e visitas pendentes do responsável atual vão junto, e o novo vendedor é notificado.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <FormField label="Novo responsável" htmlFor={`${id}-o`} required>
            <Select id={`${id}-o`} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} options={detail.transferTargets.map((t) => ({ value: t.id, label: t.name }))} />
          </FormField>
          <FormField label="Motivo" htmlFor={`${id}-r`}>
            <Textarea id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[64px]" placeholder="Ex.: cliente da carteira do Igor, férias, região" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={!ownerId}>
            Transferir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function tomorrowNine(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return isoToDateTimeLocal(d.toISOString());
}

function NextActionDialog({ opportunityId, currentAction, currentAt, onClose }: { opportunityId: string; currentAction?: string; currentAt?: string; onClose: () => void }) {
  const router = useRouter();
  const id = React.useId();
  const [action, setAction] = React.useState(currentAction ?? "");
  const [when, setWhen] = React.useState(() => (currentAt && currentAt > new Date().toISOString() ? isoToDateTimeLocal(currentAt) : tomorrowNine()));
  const [pending, startTransition] = React.useTransition();

  const submit = () => {
    const iso = dateValueToIso(when);
    if (!iso) {
      toast.error("Informe a data da próxima ação");
      return;
    }
    startTransition(async () => {
      const result = await scheduleOpportunityNextAction({ opportunityId, nextAction: action, nextActionAt: iso });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Próxima ação agendada");
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog open onOpenChange={(v) => !pending && !v && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 text-secondary" /> Próxima ação
          </DialogTitle>
          <DialogDescription>Aparece na fila, no Meu Dia e na agenda; vencida, vira follow-up.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <FormField label="O que fazer" htmlFor={`${id}-a`} required>
            <Input id={`${id}-a`} value={action} onChange={(e) => setAction(e.target.value)} placeholder="Ex.: Retornar com a proposta revisada" />
          </FormField>
          <FormField label="Quando" htmlFor={`${id}-w`} required>
            <DateInput id={`${id}-w`} mode="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={action.trim().length < 3 || !when}>
            Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
