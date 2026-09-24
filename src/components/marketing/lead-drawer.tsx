"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, Building2, CheckCircle2, Copy, ExternalLink, History, MessageSquarePlus, MoreHorizontal, Target, UserX, XCircle } from "lucide-react";
import type { ActionResult } from "@/domain/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput, dateValueToIso, isoToDateTimeLocal } from "@/components/ui/date-input";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { formatDateTime, formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { assignLeadAction, changeLeadStatusAction, setLeadConsent, setLeadNextAction, updateLeadAction } from "@/server/marketing/actions";
import { LeadStatusBadge, ScorePill, TemperatureBadge } from "./lead-badges";
import { ContactDialog, DisqualifyDialog, DuplicateDialog, QualifyDialog } from "./lead-dialogs";
import { LeadFormFields, leadFormPayload, leadToForm, type LeadFormState } from "./lead-form-fields";
import { LEAD_STATUS_LABELS, type LeadDetail, type MarketingOptions } from "./marketing-model";
import { useMarketingUrl } from "./use-marketing-url";
import { RelativeTime } from "@/components/ui/relative-time";

export interface LeadDrawerProps {
  detail: LeadDetail | null;
  options: MarketingOptions;
}

/** Drawer do lead (?lead=<id>): dados editáveis, gate de MQL, score explicado e ações. */
export function LeadDrawer({ detail, options }: LeadDrawerProps) {
  const { navigate } = useMarketingUrl();
  const close = () => navigate({ lead: null }, { replace: true });
  return (
    <Drawer open={Boolean(detail)} onOpenChange={(open) => !open && close()}>
      <DrawerContent size="lg">{detail ? <DrawerInner key={detail.lead.id} detail={detail} options={options} /> : null}</DrawerContent>
    </Drawer>
  );
}

type DialogKind = "contact" | "qualify" | "disqualify" | "duplicate" | null;

function DrawerInner({ detail, options }: { detail: LeadDetail; options: MarketingOptions }) {
  const router = useRouter();
  const { lead, score, gate } = detail;
  const [pending, startTransition] = React.useTransition();
  const [dialog, setDialog] = React.useState<DialogKind>(null);
  const [form, setForm] = React.useState<LeadFormState>(() => leadToForm(lead));
  const [nextAction, setNextAction] = React.useState(lead.nextAction ?? "");
  const [nextActionAt, setNextActionAt] = React.useState(isoToDateTimeLocal(lead.nextActionAt));
  const [prevUpdatedAt, setPrevUpdatedAt] = React.useState(lead.updatedAt);

  // O servidor devolveu o lead atualizado: realinha os rascunhos locais.
  if (lead.updatedAt !== prevUpdatedAt) {
    setPrevUpdatedAt(lead.updatedAt);
    setForm(leadToForm(lead));
    setNextAction(lead.nextAction ?? "");
    setNextActionAt(isoToDateTimeLocal(lead.nextActionAt));
  }

  const open = lead.status === "novo" || lead.status === "em_contato";
  const closed = lead.status === "qualificado" || lead.status === "convertido";

  const run = (action: () => Promise<ActionResult<unknown>>, message: string) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(message);
      router.refresh();
    });

  const saveData = (e: React.FormEvent) => {
    e.preventDefault();
    const { consent: _consent, ...payload } = leadFormPayload(form);
    void _consent;
    run(() => updateLeadAction({ id: lead.id, ...payload }), "Dados do lead salvos");
  };

  const duplicateCandidates = detail.duplicates.map((d) => ({ id: d.id, name: d.name, company: d.company, reasons: d.reasons }));

  return (
    <>
      <DrawerHeader>
        <div className="flex flex-wrap items-center gap-2">
          <LeadStatusBadge status={lead.status} size="md" />
          <TemperatureBadge temperature={lead.temperature} size="md" />
          {lead.possibleDuplicate ? (
            <Badge variant="outline">
              <Copy /> Possível duplicidade
            </Badge>
          ) : null}
        </div>
        <DrawerTitle className="flex items-center gap-2">
          {lead.name}
          <ScorePill score={lead.score} temperature={lead.temperature} />
        </DrawerTitle>
        <DrawerDescription>
          {[lead.company, lead.city && `${lead.city}${lead.state ? `/${lead.state}` : ""}`, lead.originName].filter(Boolean).join(" · ")} · captado <RelativeTime value={lead.createdAt} />
        </DrawerDescription>
        <div className="mt-2 flex flex-wrap gap-2">
          {open ? (
            <>
              <Button size="sm" onClick={() => setDialog("contact")}>
                <MessageSquarePlus /> Registrar contato
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setDialog("qualify")}>
                <BadgeCheck /> Qualificar
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDialog("disqualify")}>
                <UserX /> Desqualificar
              </Button>
            </>
          ) : null}
          {lead.status === "desqualificado" && !lead.duplicateOfId ? (
            <Button size="sm" variant="outline" loading={pending} onClick={() => run(() => changeLeadStatusAction({ leadId: lead.id, status: "em_contato" }), "Lead devolvido ao funil")}>
              Voltar ao funil
            </Button>
          ) : null}
          {lead.status === "qualificado" ? (
            <Button size="sm" variant="outline" loading={pending} onClick={() => run(() => changeLeadStatusAction({ leadId: lead.id, status: "convertido" }), "Lead marcado como convertido")}>
              Marcar como convertido
            </Button>
          ) : null}
          {!closed && !lead.duplicateOfId ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" aria-label="Mais ações">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setDialog("duplicate")}>
                  <Copy /> Marcar como duplicado
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </DrawerHeader>

      <DrawerBody className="flex flex-col gap-6">
        {/* Vínculos */}
        {detail.client || detail.opportunity || detail.duplicateOf || lead.disqualificationReason ? (
          <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface-muted p-3 text-sm">
            {lead.disqualificationReason ? (
              <p>
                <span className="text-muted">Motivo da desqualificação:</span> {lead.disqualificationReason}
              </p>
            ) : null}
            {detail.duplicateOf ? (
              <p>
                <span className="text-muted">Duplicado de:</span>{" "}
                <Link href={`/marketing/leads?lead=${detail.duplicateOf.id}`} className="font-medium text-brand hover:underline">
                  {detail.duplicateOf.name}
                </Link>
              </p>
            ) : null}
            {detail.client ? (
              <p className="flex items-center gap-2">
                <Building2 className="size-4 text-muted" /> Cliente:{" "}
                <Link href={`/clientes/${detail.client.id}`} className="font-medium text-brand hover:underline">
                  {detail.client.tradeName}
                </Link>
              </p>
            ) : null}
            {detail.opportunity ? (
              <p className="flex items-center gap-2">
                <Target className="size-4 text-muted" /> Oportunidade:{" "}
                <Link href={`/vendas/oportunidades?oportunidade=${detail.opportunity.id}`} className="font-medium text-brand hover:underline">
                  {detail.opportunity.title}
                </Link>
                {detail.opportunity.ownerName ? <span className="text-muted">· {detail.opportunity.ownerName}</span> : null}
              </p>
            ) : null}
          </section>
        ) : null}

        {/* Gate de MQL + score */}
        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-border p-4">
            <h3 className="mb-2 flex items-center justify-between text-sm font-semibold">
              Gate de MQL
              <Badge variant={gate.ok ? "success" : "warning"} size="sm">
                {gate.ok ? "Pronto para qualificar" : `${gate.missing.length} pendência(s)`}
              </Badge>
            </h3>
            <ul className="flex flex-col gap-1.5 text-sm">
              {gate.checks.map((c) => (
                <li key={c.label} className="flex items-start gap-2">
                  {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Atendido" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-label="Pendente" />}
                  <span className={cn(!c.ok && "text-foreground", c.ok && "text-muted")}>{c.label}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-border p-4">
            <h3 className="mb-2 text-sm font-semibold">Como o score foi calculado</h3>
            <ul className="flex flex-col gap-1.5 text-sm">
              {score.factors.map((f) => (
                <li key={f.key} className="flex items-center justify-between gap-2">
                  <span>
                    {f.label}: <span className="text-muted">{f.rule ?? "nenhuma regra"}</span>
                  </span>
                  <span className="font-medium tabular-nums">+{f.points}</span>
                </li>
              ))}
              <li className="mt-1 flex items-center justify-between border-t border-border pt-2 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{score.score}</span>
              </li>
            </ul>
            {score.score !== lead.score ? <p className="mt-2 text-xs text-muted">Score gravado: {lead.score}. Salve os dados para recalcular com as regras atuais.</p> : null}
            <p className="mt-2 text-xs text-muted">
              Regras em{" "}
              <Link href="/admin/configuracoes" className="text-brand hover:underline">
                Configurações → Lead scoring
              </Link>
              .
            </p>
          </div>
        </section>

        {/* Consentimento, responsável, próxima ação */}
        <section className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1 rounded-lg border border-border p-4">
            <Switch
              label="Consentimento LGPD"
              description={lead.consent && lead.consentAt ? `Registrado em ${formatDateTime(lead.consentAt)}` : "Sem consentimento registrado"}
              checked={lead.consent}
              disabled={pending}
              onCheckedChange={(consent) => run(() => setLeadConsent({ leadId: lead.id, consent }), consent ? "Consentimento registrado" : "Consentimento revogado")}
            />
          </div>
          <FormField label="Responsável" htmlFor="lead-owner" className="rounded-lg border border-border p-4">
            <Select id="lead-owner" value={lead.ownerId ?? ""} disabled={pending} onChange={(e) => run(() => assignLeadAction({ leadId: lead.id, ownerId: e.target.value || undefined }), "Responsável atualizado")}>
              <option value="">Sem responsável</option>
              {options.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </FormField>
          <form
            className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-[1fr_200px_auto] sm:items-end md:col-span-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => setLeadNextAction({ leadId: lead.id, nextAction: nextAction || undefined, nextActionAt: dateValueToIso(nextActionAt) }), "Próxima ação salva");
            }}
          >
            <FormField label="Próxima ação" htmlFor="lead-next">
              <Input id="lead-next" value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="Ex.: Ligar para confirmar interesse" />
            </FormField>
            <FormField label="Data" htmlFor="lead-next-at">
              <DateInput id="lead-next-at" mode="datetime-local" value={nextActionAt} onChange={(e) => setNextActionAt(e.target.value)} invalid={lead.overdue} />
            </FormField>
            <Button type="submit" variant="outline" loading={pending}>
              Salvar
            </Button>
          </form>
        </section>

        {/* Dados */}
        <section>
          <h3 className="mb-3 text-sm font-semibold">Dados do lead</h3>
          <form onSubmit={saveData} className="flex flex-col gap-4">
            <LeadFormFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} options={options} compact idPrefix="edit-lead" />
            <div className="flex justify-end">
              <Button type="submit" loading={pending}>
                Salvar dados
              </Button>
            </div>
          </form>
        </section>

        {/* Duplicidade */}
        {detail.duplicates.length > 0 ? (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Leads parecidos</h3>
            <ul className="flex flex-col gap-1.5">
              {detail.duplicates.map((d) => (
                <li key={d.id}>
                  <Link href={`/marketing/leads?lead=${d.id}`} className="flex min-h-[44px] items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-hover">
                    <span>
                      <span className="font-medium">{d.name}</span>
                      {d.company ? ` · ${d.company}` : ""}
                      <span className="block text-xs text-muted">
                        {d.reasons.join(", ")} · {LEAD_STATUS_LABELS[d.status]}
                      </span>
                    </span>
                    <ExternalLink className="size-4 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Histórico */}
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <History className="size-4 text-muted" /> Histórico
          </h3>
          {detail.history.length === 0 ? (
            <p className="text-sm text-muted">Nenhum registro ainda.</p>
          ) : (
            <ol className="flex flex-col gap-3 border-l border-border pl-4">
              {detail.history.map((h) => (
                <li key={h.id} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-secondary" aria-hidden />
                  <p className="font-medium">{h.title}</p>
                  {h.description ? <p className="whitespace-pre-line text-muted">{h.description}</p> : null}
                  <p className="text-xs text-muted-light">
                    {h.actorName} · {formatDateTime(h.occurredAt)}
                  </p>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-xs text-muted">
            Contato: {lead.phone ? formatPhone(lead.phone) : "sem telefone"} · {lead.email ?? "sem e-mail"} · último contato {lead.lastContactAt ? <RelativeTime value={lead.lastContactAt} /> : "nunca"}
          </p>
        </section>
      </DrawerBody>

      <ContactDialog open={dialog === "contact"} onOpenChange={(v) => setDialog(v ? "contact" : null)} leadId={lead.id} leadName={lead.name} />
      <QualifyDialog open={dialog === "qualify"} onOpenChange={(v) => setDialog(v ? "qualify" : null)} leadId={lead.id} leadName={lead.name} sellers={options.sellers} />
      <DisqualifyDialog open={dialog === "disqualify"} onOpenChange={(v) => setDialog(v ? "disqualify" : null)} leadId={lead.id} leadName={lead.name} />
      <DuplicateDialog open={dialog === "duplicate"} onOpenChange={(v) => setDialog(v ? "duplicate" : null)} leadId={lead.id} leadName={lead.name} candidates={duplicateCandidates} />
    </>
  );
}
