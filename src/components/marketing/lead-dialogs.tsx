"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, CheckCircle2, Mail, MessageCircle, Phone, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateInput, dateValueToIso } from "@/components/ui/date-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { disqualifyLeadAction, markLeadDuplicateAction, qualifyLead, registerLeadContact, type QualifyActionResult } from "@/server/marketing/actions";
import type { ContactChannel, UserOption } from "./marketing-model";

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
}

const CHANNEL_OPTIONS: { value: ContactChannel; label: string; icon: React.ReactNode }[] = [
  { value: "ligacao", label: "Ligação", icon: <Phone /> },
  { value: "whatsapp", label: "WhatsApp", icon: <MessageCircle /> },
  { value: "email", label: "E-mail", icon: <Mail /> },
];

// ---------------------------------------------------------------------------
// Registrar contato
// ---------------------------------------------------------------------------

export function ContactDialog({ open, onOpenChange, leadId, leadName, defaultChannel = "whatsapp", description }: BaseProps & { defaultChannel?: ContactChannel; description?: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  // Canal sugerido só na montagem: quem troca o canal (WhatsApp x Ligar) remonta o diálogo com `key`.
  const [channel, setChannel] = React.useState<ContactChannel>(defaultChannel);
  const [note, setNote] = React.useState("");
  const [nextAction, setNextAction] = React.useState("");
  const [nextActionAt, setNextActionAt] = React.useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await registerLeadContact({ leadId, channel, note, nextAction: nextAction || undefined, nextActionAt: dateValueToIso(nextActionAt) });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Contato registrado");
      setNote("");
      setNextAction("");
      setNextActionAt("");
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Registrar contato</DialogTitle>
            <DialogDescription>{description ?? `Com ${leadName}. Fica no histórico do lead e atualiza o último contato.`}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <SegmentedControl aria-label="Canal" options={CHANNEL_OPTIONS} value={channel} onChange={setChannel} />
            <FormField label="O que foi conversado" htmlFor="contact-note" required>
              <Textarea id="contact-note" value={note} onChange={(e) => setNote(e.target.value)} required minLength={2} placeholder="Ex.: Confirmou interesse no ERP, pediu contato à tarde." />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Próxima ação" htmlFor="contact-next">
                <Input id="contact-next" value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="Ex.: Enviar apresentação" />
              </FormField>
              <FormField label="Quando" htmlFor="contact-next-at">
                <DateInput id="contact-next-at" mode="datetime-local" value={nextActionAt} onChange={(e) => setNextActionAt(e.target.value)} />
              </FormField>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Qualificar (gate de MQL)
// ---------------------------------------------------------------------------

export function QualifyDialog({ open, onOpenChange, leadId, leadName, sellers }: BaseProps & { sellers: UserOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [sellerId, setSellerId] = React.useState("");
  const [outcome, setOutcome] = React.useState<QualifyActionResult | null>(null);

  const close = (v: boolean) => {
    if (pending) return;
    onOpenChange(v);
    if (!v) setOutcome(null);
  };

  const submit = () =>
    startTransition(async () => {
      const result = await qualifyLead({ leadId, sellerId: sellerId || undefined });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOutcome(result.data);
      if (result.data.qualified) {
        toast.success(`MQL enviado para ${result.data.sellerName}`);
        for (const w of result.data.warnings) toast.warning(w);
        router.refresh();
      }
    });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Qualificar lead (MQL)</DialogTitle>
          <DialogDescription>
            {leadName}. O gate confere contato válido, interesse, consentimento LGPD e score mínimo. Ao passar, o lead vira oportunidade em Vendas.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4 pb-4">
          {outcome?.qualified ? (
            <div className="flex flex-col gap-3 rounded-lg border border-success/30 bg-success-soft/50 p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold text-success-fg">
                <CheckCircle2 className="size-4" /> Lead qualificado e passado para Vendas
              </p>
              <ul className="flex flex-col gap-1 text-foreground">
                <li>
                  Cliente {outcome.reusedClient ? "existente vinculado" : "criado como prospect"}:{" "}
                  <Link href={`/clientes/${outcome.clientId}`} className="font-medium text-brand hover:underline">
                    {outcome.clientName}
                  </Link>
                </li>
                <li>
                  Oportunidade com <strong>{outcome.sellerName}</strong> —{" "}
                  <Link href={`/vendas/oportunidades?oportunidade=${outcome.opportunityId}`} className="font-medium text-brand hover:underline">
                    abrir oportunidade
                  </Link>
                </li>
                {outcome.workflowInstanceId ? (
                  <li>
                    Jornada na etapa Vendas —{" "}
                    <Link href={`/workflow/${outcome.workflowInstanceId}`} className="font-medium text-brand hover:underline">
                      ver jornada
                    </Link>
                  </li>
                ) : null}
                {outcome.taskId ? (
                  <li>
                    Tarefa de primeiro contato criada —{" "}
                    <Link href={`/tarefas?tarefa=${outcome.taskId}`} className="font-medium text-brand hover:underline">
                      ver tarefa
                    </Link>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : (
            <>
              <FormField label="Vendedor que recebe a oportunidade" htmlFor="qualify-seller" hint="Automático: rodízio entre os vendedores ativos (quem recebeu há mais tempo).">
                <Select id="qualify-seller" value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
                  <option value="">Automático (rodízio)</option>
                  {sellers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              {outcome && !outcome.qualified ? (
                <div className="rounded-lg border border-danger/30 bg-danger-soft/50 p-4 text-sm" role="alert">
                  <p className="mb-2 font-semibold text-danger-fg">O gate de MQL não foi atendido. Falta:</p>
                  <ul className="flex flex-col gap-1">
                    {outcome.missing.map((m) => (
                      <li key={m} className="flex items-start gap-2">
                        <XCircle className="mt-0.5 size-4 shrink-0 text-danger" /> {m}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {outcome?.qualified ? (
            <Button onClick={() => close(false)}>Fechar</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => close(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={submit} loading={pending}>
                <BadgeCheck /> Qualificar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Desqualificar
// ---------------------------------------------------------------------------

const QUICK_REASONS = ["Sem orçamento no momento", "Já usa concorrente com contrato vigente", "Contato inválido após 3 tentativas", "Fora da área de atendimento", "Não é o decisor e não indicou quem é"];

export function DisqualifyDialog({ open, onOpenChange, leadId, leadName }: BaseProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [reason, setReason] = React.useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await disqualifyLeadAction({ leadId, reason });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Lead desqualificado");
      setReason("");
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent>
        <form onSubmit={submit} className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Desqualificar lead</DialogTitle>
            <DialogDescription>{leadName} sai do funil. O motivo é obrigatório e alimenta os relatórios.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {QUICK_REASONS.map((r) => (
                <Button key={r} type="button" size="sm" variant={reason === r ? "secondary" : "outline"} onClick={() => setReason(r)}>
                  {r}
                </Button>
              ))}
            </div>
            <FormField label="Motivo" htmlFor="disqualify-reason" required>
              <Textarea id="disqualify-reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} className="min-h-[72px]" />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" loading={pending}>
              Desqualificar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Marcar duplicado
// ---------------------------------------------------------------------------

export function DuplicateDialog({ open, onOpenChange, leadId, leadName, candidates }: BaseProps & { candidates: { id: string; name: string; company?: string; reasons?: string[] }[] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [originalId, setOriginalId] = React.useState(candidates[0]?.id ?? "");

  const submit = () =>
    startTransition(async () => {
      const result = await markLeadDuplicateAction({ leadId, originalId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Lead marcado como duplicado");
      onOpenChange(false);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar como duplicado</DialogTitle>
          <DialogDescription>{leadName} será desqualificado e apontará para o lead original escolhido.</DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-4">
          {candidates.length === 0 ? (
            <p className="text-sm text-muted">Nenhum lead com o mesmo telefone, e-mail ou empresa foi encontrado.</p>
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-[13px] font-medium">Lead original</legend>
              {candidates.map((c) => (
                <label key={c.id} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 has-[:checked]:border-brand has-[:checked]:bg-brand-soft/40">
                  <input type="radio" name="original" value={c.id} checked={originalId === c.id} onChange={() => setOriginalId(c.id)} className="accent-[var(--color-brand)]" />
                  <span className="flex flex-col text-sm">
                    <span className="font-medium">
                      {c.name}
                      {c.company ? ` · ${c.company}` : ""}
                    </span>
                    {c.reasons?.length ? <span className="text-xs text-muted">{c.reasons.join(", ")}</span> : null}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={!originalId}>
            Marcar duplicado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
