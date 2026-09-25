"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, CalendarPlus, CheckSquare, ExternalLink, FileSignature, FileText, MapPin, MessagesSquare, Plus, Printer, RotateCcw, Trophy, XCircle } from "lucide-react";
import { PRIORITIES, PRIORITY_LABELS, TASK_STATUS_LABELS, type Priority } from "@/domain/constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateInput, dateValueToIso, isoToDateTimeLocal } from "@/components/ui/date-input";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SlaBadge } from "@/components/ui/sla-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { UserChip } from "@/components/ui/user-chip";
import { Timeline } from "@/components/timeline/timeline";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { changeOpportunityStage, createOpportunityTaskAction, registerOpportunityContactAction, reopenOpportunityAction, updateOpportunity } from "@/server/sales/actions";
import type { OpenStage } from "@/server/sales/schemas";
import type { OpportunityDetail } from "@/server/sales/queries";
import { lossReasonLabel } from "@/server/sales/schemas";
import { ContactButtons } from "./contact-buttons";
import { LostDialog } from "./lost-dialog";
import { OPPORTUNITY_KIND_LABELS, VISIT_STATUS_LABELS, VISIT_STATUS_VARIANT, isOpenStage, proposalHref, visitHref, workspaceHref } from "./model";
import { NextActionLabel, ProposalStatusBadge, StageBadge, TemperatureDot, ValueLine } from "./opportunity-bits";
import { ProductsEditor, toEditableLines, toPayloadLines, type EditableLine } from "./products-editor";
import { ProposalEditorDialog } from "./proposal-editor-dialog";
import { useSalesUrl } from "./use-sales-url";
import { WonDialog } from "./won-dialog";

export interface OpportunityDrawerProps {
  detail: OpportunityDetail | null;
}

/**
 * Drawer da oportunidade (?oportunidade=<id>), reutilizado pela Central, Pipeline e Oportunidades.
 * Recebe tudo do servidor; cada ação chama uma Server Action e faz router.refresh().
 */
export function OpportunityDrawer({ detail }: OpportunityDrawerProps) {
  const { navigate } = useSalesUrl();
  const close = () => navigate({ oportunidade: null, aba: null }, { replace: true });
  return (
    <Drawer open={Boolean(detail)} onOpenChange={(open) => !open && close()}>
      <DrawerContent size="lg">{detail ? <DrawerInner key={detail.opportunity.id} detail={detail} /> : null}</DrawerContent>
    </Drawer>
  );
}

type TabKey = "resumo" | "atividades" | "propostas" | "tarefas";

function DrawerInner({ detail }: { detail: OpportunityDetail }) {
  const router = useRouter();
  const { opportunity: opp, client, sla, users } = detail;
  const open = isOpenStage(opp.stage);
  const [tab, setTab] = React.useState<TabKey>("resumo");
  const [dialog, setDialog] = React.useState<"ganho" | "perdido" | "reabrir" | "proposta" | null>(null);
  const [, startTransition] = React.useTransition();
  const [stagePending, startStageTransition] = React.useTransition();
  const owner = users[opp.ownerId];
  const stageLabel = detail.stages.find((s) => s.key === opp.stage)?.label;

  const moveStage = (stage: string) => {
    if (!stage || stage === opp.stage) return;
    startStageTransition(async () => {
      const result = await changeOpportunityStage({ opportunityId: opp.id, stage: stage as OpenStage });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Etapa alterada para ${detail.stages.find((s) => s.key === stage)?.label ?? stage}`);
      router.refresh();
    });
  };

  const reopen = async () => {
    const result = await reopenOpportunityAction({ opportunityId: opp.id });
    if (!result.ok) {
      toast.error(result.error);
      throw new Error(result.error);
    }
    toast.success("Oportunidade reaberta");
    startTransition(() => router.refresh());
  };

  return (
    <>
      <DrawerHeader>
        <div className="flex flex-wrap items-center gap-2">
          <StageBadge stage={opp.stage} label={stageLabel} size="md" />
          <Badge variant="outline" size="sm">
            {OPPORTUNITY_KIND_LABELS[opp.kind]}
          </Badge>
          {sla ? <SlaBadge state={sla.view.state} remainingMs={sla.view.remainingMs} /> : null}
        </div>
        <DrawerTitle className="mt-1">
          <span className="mr-2 text-base font-bold tabular-nums text-brand-fg">#{opp.code}</span>
          {opp.title}
        </DrawerTitle>
        <DrawerDescription asChild>
          <div className="flex flex-col gap-2">
            <Link href={`/clientes/${client.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-secondary hover:underline">
              <Building2 className="size-4" /> {client.tradeName}
              <ExternalLink className="size-3.5" />
            </Link>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-foreground">
              <ValueLine opp={opp} className="font-semibold" />
              <TemperatureDot temperature={opp.temperature} />
              <span className="text-muted">Probabilidade {opp.probability}%</span>
              {open ? <span className="text-muted">{opp.daysInStage} {opp.daysInStage === 1 ? "dia" : "dias"} na etapa</span> : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {owner ? <UserChip name={owner.name} avatarUrl={owner.avatarUrl} subtitle="Vendedor" /> : null}
              <NextActionLabel opp={opp} />
            </div>
          </div>
        </DrawerDescription>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {open ? (
            <>
              <Select
                aria-label="Etapa"
                value={opp.stage}
                onChange={(e) => moveStage(e.target.value)}
                disabled={stagePending}
                className="w-auto min-w-[160px]"
                options={detail.stages.map((s) => ({ value: s.key, label: s.label }))}
              />
              <Button size="sm" className="min-h-[44px] bg-success-strong hover:bg-success-hover md:min-h-0" onClick={() => setDialog("ganho")}>
                <Trophy /> Marcar como ganho
              </Button>
              <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-0" onClick={() => setDialog("perdido")}>
                <XCircle className="text-danger" /> Perdido
              </Button>
            </>
          ) : null}
          {opp.stage === "perdido" ? (
            <Button size="sm" variant="outline" className="min-h-[44px] md:min-h-0" onClick={() => setDialog("reabrir")}>
              <RotateCcw /> Reabrir
            </Button>
          ) : null}
          {opp.stage === "ganho" && opp.contractId ? (
            <Button size="sm" variant="outline" asChild className="min-h-[44px] md:min-h-0">
              <Link href={`/financeiro/contratos?contrato=${opp.contractId}`}>
                <FileSignature /> Ver contrato
              </Link>
            </Button>
          ) : null}
          <ContactButtons opportunityId={opp.id} phone={opp.contactPhone} whatsapp={opp.contactWhatsapp} />
          <Button size="sm" variant="ghost" asChild className="min-h-[44px] md:min-h-0">
            <Link href={workspaceHref(opp.id)}>
              <MessagesSquare /> Abrir no workspace
            </Link>
          </Button>
        </div>
        {opp.stage === "ganho" ? (
          <p className="mt-2 rounded-md bg-success-soft px-3 py-2 text-sm text-success-fg">Ganha em {formatDateTime(opp.wonAt)}. Contrato, produtos e comissões foram gerados; a jornada segue no Financeiro.</p>
        ) : null}
        {opp.stage === "perdido" ? (
          <p className="mt-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-fg">
            Perdida em {formatDate(opp.lostAt)} · {lossReasonLabel(opp.lossReason)}
            {opp.lossCompetitor ? ` (${opp.lossCompetitor})` : ""}
            {opp.lossNotes ? ` — ${opp.lossNotes}` : ""}
          </p>
        ) : null}
      </DrawerHeader>

      <DrawerBody>
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList className="w-full">
            <TabsTrigger value="resumo">Resumo</TabsTrigger>
            <TabsTrigger value="atividades">Atividades ({detail.activities.length})</TabsTrigger>
            <TabsTrigger value="propostas">Propostas ({detail.proposals.length})</TabsTrigger>
            <TabsTrigger value="tarefas">Tarefas ({detail.tasks.filter((t) => t.status !== "concluida" && t.status !== "cancelada").length})</TabsTrigger>
          </TabsList>
          <TabsContent value="resumo">
            <SummaryTab detail={detail} />
          </TabsContent>
          <TabsContent value="atividades">
            <ActivitiesTab detail={detail} />
          </TabsContent>
          <TabsContent value="propostas">
            <ProposalsTab detail={detail} onNew={() => setDialog("proposta")} />
          </TabsContent>
          <TabsContent value="tarefas">
            <TasksTab detail={detail} />
          </TabsContent>
        </Tabs>
      </DrawerBody>

      {dialog === "ganho" ? (
        <WonDialog
          open
          onOpenChange={(v) => !v && setDialog(null)}
          opportunity={opp}
          clientDefaults={{ legalName: client.legalName, document: client.document, email: client.email }}
          products={detail.products}
        />
      ) : null}
      {dialog === "perdido" ? <LostDialog open onOpenChange={(v) => !v && setDialog(null)} opportunity={opp} /> : null}
      <ConfirmDialog
        open={dialog === "reabrir"}
        onOpenChange={(v) => !v && setDialog(null)}
        title="Reabrir oportunidade?"
        description="Ela volta para o funil (negociação se havia proposta, senão qualificação) e o motivo da perda é removido."
        confirmLabel="Reabrir"
        onConfirm={reopen}
      />
      {dialog === "proposta" ? (
        <ProposalEditorDialog
          open
          onOpenChange={(v) => !v && setDialog(null)}
          opportunity={opp}
          products={detail.products}
          onSaved={() => setTab("propostas")}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Resumo
// ---------------------------------------------------------------------------

function SummaryTab({ detail }: { detail: OpportunityDetail }) {
  const router = useRouter();
  const { opportunity: opp, products } = detail;
  const editable = isOpenStage(opp.stage);
  const id = React.useId();
  const [diagnosis, setDiagnosis] = React.useState(opp.diagnosis ?? "");
  const [need, setNeed] = React.useState(opp.need ?? "");
  const [objections, setObjections] = React.useState(opp.objections ?? "");
  const [temperature, setTemperature] = React.useState(opp.temperature);
  const [probability, setProbability] = React.useState(String(opp.probability));
  const [lines, setLines] = React.useState<EditableLine[]>(() => toEditableLines(opp.products));
  const [legalName, setLegalName] = React.useState(opp.billingData?.legalName ?? "");
  const [document, setDocument] = React.useState(opp.billingData?.document ?? "");
  const [email, setEmail] = React.useState(opp.billingData?.email ?? "");
  const [payment, setPayment] = React.useState(opp.billingData?.paymentCondition ?? "");
  const [nextAction, setNextAction] = React.useState(opp.nextAction ?? "");
  const [nextActionAt, setNextActionAt] = React.useState(isoToDateTimeLocal(opp.nextActionAt));
  const [noNext, setNoNext] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [prevUpdatedAt, setPrevUpdatedAt] = React.useState(opp.updatedAt);

  // Quando o servidor devolve a oportunidade atualizada, realinha os rascunhos locais.
  if (opp.updatedAt !== prevUpdatedAt) {
    setPrevUpdatedAt(opp.updatedAt);
    setDiagnosis(opp.diagnosis ?? "");
    setNeed(opp.need ?? "");
    setObjections(opp.objections ?? "");
    setTemperature(opp.temperature);
    setProbability(String(opp.probability));
    setLines(toEditableLines(opp.products));
    setNextAction(opp.nextAction ?? "");
    setNextActionAt(isoToDateTimeLocal(opp.nextActionAt));
  }

  const needsNext = !noNext && (!nextAction.trim() || !nextActionAt);

  const save = () => {
    startTransition(async () => {
      const result = await updateOpportunity({
        opportunityId: opp.id,
        diagnosis,
        need,
        objections,
        temperature,
        probability: Number(probability) || 0,
        products: toPayloadLines(lines),
        billingData: { legalName, document, email, paymentCondition: payment },
        nextAction: noNext ? undefined : nextAction,
        nextActionAt: noNext ? undefined : dateValueToIso(nextActionAt),
        noNextAction: noNext,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Oportunidade salva");
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-3">
        <h4 className="text-sm font-semibold">Diagnóstico</h4>
        <FormField label="Diagnóstico" htmlFor={`${id}-d`}>
          <Textarea id={`${id}-d`} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} disabled={!editable} placeholder="Como o cliente trabalha hoje, dores, sistema atual…" />
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Necessidade" htmlFor={`${id}-n`}>
            <Textarea id={`${id}-n`} value={need} onChange={(e) => setNeed(e.target.value)} disabled={!editable} className="min-h-[72px]" />
          </FormField>
          <FormField label="Objeções" htmlFor={`${id}-o`}>
            <Textarea id={`${id}-o`} value={objections} onChange={(e) => setObjections(e.target.value)} disabled={!editable} className="min-h-[72px]" />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Temperatura" htmlFor={`${id}-t`}>
            <Select id={`${id}-t`} value={temperature} onChange={(e) => setTemperature(e.target.value as typeof temperature)} disabled={!editable} options={[{ value: "quente", label: "Quente" }, { value: "morno", label: "Morno" }, { value: "frio", label: "Frio" }]} />
          </FormField>
          <FormField label="Probabilidade (%)" htmlFor={`${id}-p`}>
            <Input id={`${id}-p`} type="number" min={0} max={100} value={probability} onChange={(e) => setProbability(e.target.value)} disabled={!editable} />
          </FormField>
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-sm font-semibold">Produtos</h4>
        <ProductsEditor lines={lines} onChange={setLines} products={products} disabled={!editable} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <h4 className="text-sm font-semibold sm:col-span-2">Dados de faturamento</h4>
        <FormField label="Razão social" htmlFor={`${id}-ln`} className="sm:col-span-2">
          <Input id={`${id}-ln`} value={legalName} onChange={(e) => setLegalName(e.target.value)} disabled={!editable} placeholder={detail.client.legalName} />
        </FormField>
        <FormField label="CNPJ/CPF" htmlFor={`${id}-doc`}>
          <Input id={`${id}-doc`} value={document} onChange={(e) => setDocument(e.target.value)} disabled={!editable} inputMode="numeric" placeholder={detail.client.document} />
        </FormField>
        <FormField label="E-mail" htmlFor={`${id}-em`}>
          <Input id={`${id}-em`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!editable} placeholder={detail.client.email} />
        </FormField>
        <FormField label="Condição de pagamento" htmlFor={`${id}-pc`} className="sm:col-span-2">
          <Input id={`${id}-pc`} value={payment} onChange={(e) => setPayment(e.target.value)} disabled={!editable} />
        </FormField>
      </section>

      {editable ? (
        <section className="grid gap-3 rounded-lg border border-border p-3">
          <h4 className="text-sm font-semibold">Próxima ação</h4>
          <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
            <FormField label="O que fazer" htmlFor={`${id}-na`} required={!noNext}>
              <Input id={`${id}-na`} value={nextAction} onChange={(e) => setNextAction(e.target.value)} disabled={noNext} placeholder="Ex.: Enviar proposta revisada" />
            </FormField>
            <FormField label="Quando" htmlFor={`${id}-nw`} required={!noNext}>
              <DateInput id={`${id}-nw`} mode="datetime-local" value={nextActionAt} onChange={(e) => setNextActionAt(e.target.value)} disabled={noNext} />
            </FormField>
          </div>
          <Checkbox checked={noNext} onCheckedChange={(v) => setNoNext(v === true)} label="Salvar sem próxima ação" description="Use só quando não houver passo definido; a oportunidade aparece como SEM PRÓXIMA AÇÃO." />
          <div className="flex justify-end">
            <Button onClick={save} loading={pending} disabled={needsNext} className="min-h-[44px] md:min-h-0">
              Salvar
            </Button>
          </div>
          {needsNext ? <p className="text-right text-xs text-muted">Informe a próxima ação e a data para salvar.</p> : null}
        </section>
      ) : null}

      {opp.originDepartment || opp.originUserId ? (
        <p className="text-xs text-muted">
          Originada por {opp.originUserId ? (detail.users[opp.originUserId]?.name ?? "—") : "—"}
          {opp.originDepartment ? ` (${opp.originDepartment})` : ""} em {formatDate(opp.createdAt)}.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Atividades
// ---------------------------------------------------------------------------

function ActivitiesTab({ detail }: { detail: OpportunityDetail }) {
  const router = useRouter();
  const { opportunity: opp } = detail;
  const id = React.useId();
  const [channel, setChannel] = React.useState<"nota" | "whatsapp" | "ligacao">("nota");
  const [outcome, setOutcome] = React.useState<"atendeu" | "nao_atendeu" | "mensagem_enviada">("atendeu");
  const [notes, setNotes] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  const submit = () => {
    startTransition(async () => {
      const result = await registerOpportunityContactAction({ opportunityId: opp.id, channel, outcome: channel === "ligacao" ? outcome : channel === "whatsapp" ? "mensagem_enviada" : undefined, notes });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Atividade registrada");
      setNotes("");
      router.refresh();
    });
  };

  const visitParams = new URLSearchParams({ nova: "1", cliente: opp.clientId, oportunidade: opp.id });
  return (
    <div className="flex flex-col gap-5">
      <section className="grid gap-3 rounded-lg border border-border p-3">
        <h4 className="text-sm font-semibold">Registrar contato ou nota</h4>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Tipo" htmlFor={`${id}-c`}>
            <Select id={`${id}-c`} value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)} options={[{ value: "nota", label: "Nota" }, { value: "ligacao", label: "Ligação" }, { value: "whatsapp", label: "WhatsApp" }]} />
          </FormField>
          {channel === "ligacao" ? (
            <FormField label="Resultado" htmlFor={`${id}-o`}>
              <Select id={`${id}-o`} value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)} options={[{ value: "atendeu", label: "Atendeu" }, { value: "nao_atendeu", label: "Não atendeu" }]} />
            </FormField>
          ) : null}
        </div>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="O que foi conversado, combinados, próximos passos…" aria-label="Descrição" />
        <div className="flex justify-end">
          <Button onClick={submit} loading={pending} disabled={channel === "nota" && notes.trim().length < 2} className="min-h-[44px] md:min-h-0">
            Registrar
          </Button>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">Visitas ({detail.visits.length})</h4>
          {isOpenStage(opp.stage) ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/vendas/visitas?${visitParams.toString()}`}>
                <CalendarPlus /> Agendar visita
              </Link>
            </Button>
          ) : null}
        </div>
        {detail.visits.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma visita vinculada.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.visits.map((v) => (
              <li key={v.id}>
                <Link href={visitHref(v.id)} className="flex items-center gap-3 rounded-lg border border-border p-2.5 hover:bg-surface-hover">
                  <MapPin className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{v.objective}</span>
                    <span className="block text-xs text-muted">{formatDateTime(v.scheduledAt)}</span>
                  </span>
                  <Badge variant={VISIT_STATUS_VARIANT[v.status]} size="sm">
                    {VISIT_STATUS_LABELS[v.status]}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4 className="mb-2 text-sm font-semibold">Histórico</h4>
        <Timeline events={detail.activities} showFilters={false} pageSize={30} emptyTitle="Nenhuma atividade registrada" emptyDescription="Contatos, mudanças de etapa, propostas e visitas aparecem aqui." />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Propostas
// ---------------------------------------------------------------------------

function ProposalsTab({ detail, onNew }: { detail: OpportunityDetail; onNew: () => void }) {
  const canCreate = isOpenStage(detail.opportunity.stage);
  return (
    <div className="flex flex-col gap-3">
      {canCreate ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={onNew} className="min-h-[44px] md:min-h-0">
            <Plus /> Nova proposta
          </Button>
        </div>
      ) : null}
      {detail.proposals.length === 0 ? (
        <EmptyState size="sm" icon={<FileText />} title="Nenhuma proposta" description="Crie uma proposta a partir dos produtos da oportunidade." />
      ) : (
        <ul className="flex flex-col gap-2">
          {detail.proposals.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center">
              <Link href={proposalHref(p.id)} className="min-w-0 flex-1 hover:underline">
                <span className="flex items-center gap-2">
                  <span className="font-medium tabular-nums">
                    {p.number} v{p.version}
                  </span>
                  <ProposalStatusBadge status={p.effectiveStatus} />
                </span>
                <span className="mt-0.5 block text-xs text-muted tabular-nums">
                  {formatCurrency(p.monthlyTotal)}/mês · {formatCurrency(p.setupTotal)} adesão{p.discountTotal > 0 ? ` · desconto ${formatCurrency(p.discountTotal)}` : ""} · válida até {formatDate(p.validUntil)}
                </span>
              </Link>
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/vendas/propostas/${p.id}`} target="_blank">
                  <Printer /> Imprimir
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tarefas
// ---------------------------------------------------------------------------

function TasksTab({ detail }: { detail: OpportunityDetail }) {
  const router = useRouter();
  const id = React.useId();
  const [title, setTitle] = React.useState("");
  const [dueAt, setDueAt] = React.useState("");
  const [priority, setPriority] = React.useState<Priority>("media");
  const [pending, startTransition] = React.useTransition();
  const nowIso = new Date().toISOString();

  const submit = () => {
    const iso = dateValueToIso(dueAt);
    if (!iso) {
      toast.error("Informe o prazo");
      return;
    }
    startTransition(async () => {
      const result = await createOpportunityTaskAction({ opportunityId: detail.opportunity.id, title, dueAt: iso, priority });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Tarefa criada");
      setTitle("");
      setDueAt("");
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="grid gap-3 rounded-lg border border-border p-3">
        <h4 className="text-sm font-semibold">Nova tarefa</h4>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Enviar contrato modelo ao cliente" aria-label="Título da tarefa" />
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Prazo" htmlFor={`${id}-d`}>
            <DateInput id={`${id}-d`} mode="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </FormField>
          <FormField label="Prioridade" htmlFor={`${id}-p`}>
            <Select id={`${id}-p`} value={priority} onChange={(e) => setPriority(e.target.value as Priority)} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} />
          </FormField>
        </div>
        <div className="flex justify-end">
          <Button onClick={submit} loading={pending} disabled={title.trim().length < 3 || !dueAt} className="min-h-[44px] md:min-h-0">
            <Plus /> Criar tarefa
          </Button>
        </div>
      </section>
      {detail.tasks.length === 0 ? (
        <EmptyState size="sm" icon={<CheckSquare />} title="Nenhuma tarefa vinculada" />
      ) : (
        <ul className="flex flex-col gap-2">
          {detail.tasks.map((t) => {
            const done = t.status === "concluida" || t.status === "cancelada";
            const late = !done && t.dueAt && t.dueAt < nowIso;
            return (
              <li key={t.id}>
                <Link href={`/tarefas?tarefa=${t.id}`} className="flex items-center gap-3 rounded-lg border border-border p-2.5 hover:bg-surface-hover">
                  <CheckSquare className={cn("size-4 shrink-0", done ? "text-success" : "text-muted")} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm", done && "text-muted line-through")}>{t.title}</span>
                    <span className={cn("block text-xs", late ? "font-medium text-danger-fg" : "text-muted")}>
                      {t.dueAt ? formatDateTime(t.dueAt) : "Sem prazo"}
                      {t.assigneeName ? ` · ${t.assigneeName}` : ""}
                    </span>
                  </span>
                  <Badge variant={done ? "muted" : "info"} size="sm">
                    {TASK_STATUS_LABELS[t.status]}
                  </Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
