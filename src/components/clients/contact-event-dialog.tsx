"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, MessageCircle, Phone } from "lucide-react";
import type { Contact } from "@/domain/types";
import { registerContactEvent } from "@/server/clients/actions";
import { formatPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

/** Número em dígitos com DDI 55 (para tel: e wa.me). */
export function toInternationalDigits(phone: string | undefined): string {
  const d = (phone ?? "").replace(/\D/g, "");
  if (!d) return "";
  return d.length <= 11 ? `55${d}` : d;
}

export function whatsappHref(phone: string | undefined): string | null {
  const d = toInternationalDigits(phone);
  return d ? `https://wa.me/${d}` : null;
}

export function telHref(phone: string | undefined): string | null {
  const d = toInternationalDigits(phone);
  return d ? `tel:+${d}` : null;
}

export interface ContactEventDialogProps {
  clientId: string;
  clientName: string;
  channel: "ligacao" | "whatsapp";
  contacts: Contact[];
  /** Telefone principal do cliente (quando nenhum contato é escolhido). */
  clientPhone?: string;
  clientWhatsapp?: string;
  /** Contato pré-selecionado. */
  defaultContactId?: string;
  trigger: React.ReactNode;
}

/**
 * Abre o discador (tel:) ou o WhatsApp (wa.me) e, ao confirmar, registra `call.completed` /
 * `whatsapp.message.sent` na timeline. A integração real (VoIP, WhatsApp API) entra depois.
 */
export function ContactEventDialog({ clientId, clientName, channel, contacts, clientPhone, clientWhatsapp, defaultContactId, trigger }: ContactEventDialogProps) {
  const router = useRouter();
  const isCall = channel === "ligacao";
  const [open, setOpen] = React.useState(false);
  const [contactId, setContactId] = React.useState(defaultContactId ?? "");
  const [outcome, setOutcome] = React.useState<"atendeu" | "nao_atendeu" | "mensagem_enviada">(isCall ? "atendeu" : "mensagem_enviada");
  const [duration, setDuration] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const id = React.useId();

  // Alvos possíveis: números da empresa (sem contato) e cada contato com telefone.
  const clientNumbers = Array.from(new Set((isCall ? [clientPhone, clientWhatsapp] : [clientWhatsapp, clientPhone]).filter((p): p is string => Boolean(p))));
  const targets = [
    ...clientNumbers.map((p, i) => ({ key: `empresa-${i}`, contactId: undefined as string | undefined, label: `${clientName} · ${formatPhone(p)}`, phone: p })),
    ...contacts.flatMap((c) => {
      const phone = isCall ? c.phone ?? c.whatsapp : c.whatsapp ?? c.phone;
      return phone ? [{ key: `contato-${c.id}`, contactId: c.id, label: `${c.name}${c.role ? ` (${c.role})` : ""} · ${formatPhone(phone)}`, phone }] : [];
    }),
  ];
  const selected = targets.find((t) => t.contactId === contactId && contactId) ?? targets.find((t) => t.key === contactId) ?? targets[0];
  const href = selected ? (isCall ? telHref(selected.phone) : whatsappHref(selected.phone)) : null;

  const submit = () => {
    startTransition(async () => {
      const result = await registerContactEvent({
        clientId,
        channel,
        contactId: selected?.contactId,
        phone: selected?.phone,
        outcome,
        notes,
        durationMinutes: isCall && duration ? Number(duration) : undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(isCall ? "Ligação registrada na timeline" : "Mensagem registrada na timeline");
      setOpen(false);
      setNotes("");
      setDuration("");
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{isCall ? "Ligar para o cliente" : "Enviar WhatsApp"}</DialogTitle>
          <DialogDescription>{isCall ? "Abra o discador e, ao terminar, registre o resultado." : "Abra a conversa no WhatsApp e registre o contato na timeline."}</DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogBody className="flex flex-col gap-4 py-2">
            {targets.length === 0 ? (
              <p className="rounded-md bg-warning-soft p-3 text-sm text-warning-fg">Nenhum telefone cadastrado. Edite o cliente ou adicione um contato com número.</p>
            ) : (
              <>
                <FormField label="Para quem" htmlFor={`${id}-target`}>
                  <Select id={`${id}-target`} value={selected?.key ?? ""} onChange={(e) => setContactId(e.target.value)}>
                    {targets.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </FormField>
                {href ? (
                  <Button asChild variant="secondary" size="lg" className="w-full">
                    <a href={href} target={isCall ? undefined : "_blank"} rel="noreferrer">
                      {isCall ? <Phone /> : <MessageCircle />}
                      {isCall ? `Discar ${formatPhone(selected?.phone)}` : "Abrir conversa no WhatsApp"}
                      <ExternalLink className="ml-auto opacity-70" />
                    </a>
                  </Button>
                ) : null}
                <div className="rounded-md border border-border p-3">
                  <p className="label-caps mb-3">Registrar contato</p>
                  <div className="flex flex-col gap-3">
                    <div className={isCall ? "grid grid-cols-[1fr_110px] gap-3" : ""}>
                      <FormField label="Resultado" htmlFor={`${id}-outcome`}>
                        <Select
                          id={`${id}-outcome`}
                          value={outcome}
                          onChange={(e) => setOutcome(e.target.value as typeof outcome)}
                          options={
                            isCall
                              ? [
                                  { value: "atendeu", label: "Atendeu" },
                                  { value: "nao_atendeu", label: "Não atendeu" },
                                ]
                              : [
                                  { value: "mensagem_enviada", label: "Mensagem enviada" },
                                  { value: "atendeu", label: "Cliente respondeu" },
                                ]
                          }
                        />
                      </FormField>
                      {isCall ? (
                        <FormField label="Duração (min)" htmlFor={`${id}-duration`}>
                          <Input id={`${id}-duration`} type="number" min={0} max={600} inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} />
                        </FormField>
                      ) : null}
                    </div>
                    <FormField label="Resumo" htmlFor={`${id}-notes`}>
                      <Textarea id={`${id}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[64px]" placeholder="O que foi conversado ou combinado" />
                    </FormField>
                  </div>
                </div>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={targets.length === 0}>
              Registrar contato
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
