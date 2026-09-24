"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Crown, Mail, MessageCircle, Pencil, Phone, Plus, Star, Trash2, UserRound } from "lucide-react";
import type { Contact } from "@/domain/types";
import { addContact, removeContact, updateContact } from "@/server/clients/actions";
import { formatPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { telHref, whatsappHref } from "./contact-event-dialog";

interface ContactFormState {
  name: string;
  role: string;
  phone: string;
  whatsapp: string;
  email: string;
  isPrimary: boolean;
  isDecisionMaker: boolean;
}

const EMPTY: ContactFormState = { name: "", role: "", phone: "", whatsapp: "", email: "", isPrimary: false, isDecisionMaker: false };

function fromContact(c: Contact): ContactFormState {
  return { name: c.name, role: c.role ?? "", phone: c.phone ? formatPhone(c.phone) : "", whatsapp: c.whatsapp ? formatPhone(c.whatsapp) : "", email: c.email ?? "", isPrimary: c.isPrimary, isDecisionMaker: Boolean(c.isDecisionMaker) };
}

function ContactDialog({ clientId, contact, open, onOpenChange, firstContact }: { clientId: string; contact: Contact | null; open: boolean; onOpenChange: (o: boolean) => void; firstContact: boolean }) {
  const router = useRouter();
  const [values, setValues] = React.useState<ContactFormState>(contact ? fromContact(contact) : { ...EMPTY, isPrimary: firstContact });
  const [pending, startTransition] = React.useTransition();
  const id = React.useId();
  const set = (name: keyof ContactFormState) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [name]: e.target.value }));

  const submit = () => {
    startTransition(async () => {
      const payload = { clientId, ...values };
      const result = contact ? await updateContact({ ...payload, id: contact.id }) : await addContact(payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(contact ? "Contato atualizado" : "Contato adicionado");
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{contact ? "Editar contato" : "Novo contato"}</DialogTitle>
          <DialogDescription>Pessoa de contato na empresa do cliente.</DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogBody className="grid gap-4 py-2 sm:grid-cols-2">
            <FormField label="Nome" htmlFor={`${id}-name`} required className="sm:col-span-2">
              <Input id={`${id}-name`} value={values.name} onChange={set("name")} required minLength={2} autoFocus />
            </FormField>
            <FormField label="Cargo" htmlFor={`${id}-role`}>
              <Input id={`${id}-role`} value={values.role} onChange={set("role")} placeholder="Proprietário, gerente, financeiro…" />
            </FormField>
            <FormField label="E-mail" htmlFor={`${id}-email`}>
              <Input id={`${id}-email`} type="email" value={values.email} onChange={set("email")} />
            </FormField>
            <FormField label="Telefone" htmlFor={`${id}-phone`}>
              <Input id={`${id}-phone`} type="tel" value={values.phone} onChange={set("phone")} onBlur={() => setValues((v) => ({ ...v, phone: v.phone ? formatPhone(v.phone) : "" }))} />
            </FormField>
            <FormField label="WhatsApp" htmlFor={`${id}-whatsapp`}>
              <Input id={`${id}-whatsapp`} type="tel" value={values.whatsapp} onChange={set("whatsapp")} onBlur={() => setValues((v) => ({ ...v, whatsapp: v.whatsapp ? formatPhone(v.whatsapp) : "" }))} />
            </FormField>
            <Checkbox label="Contato principal" description="Recebe contratos e comunicações oficiais." checked={values.isPrimary} onCheckedChange={(c) => setValues((v) => ({ ...v, isPrimary: c === true }))} />
            <Checkbox label="Decisor" description="Aprova compras e renovações." checked={values.isDecisionMaker} onCheckedChange={(c) => setValues((v) => ({ ...v, isDecisionMaker: c === true }))} />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" loading={pending}>
              {contact ? "Salvar" : "Adicionar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface ContactsCardProps {
  clientId: string;
  contacts: Contact[];
  className?: string;
}

/** Card lateral de contatos com adicionar/editar/remover e atalhos de telefone, WhatsApp e e-mail. */
export function ContactsCard({ clientId, contacts, className }: ContactsCardProps) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<{ open: boolean; contact: Contact | null }>({ open: false, contact: null });
  const [removing, setRemoving] = React.useState<Contact | null>(null);

  const confirmRemove = async () => {
    if (!removing) return;
    const result = await removeContact({ id: removing.id, clientId });
    if (!result.ok) {
      toast.error(result.error);
      throw new Error(result.error);
    }
    toast.success("Contato removido");
    router.refresh();
  };

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="flex items-center gap-2">
          Contatos
          <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium tabular-nums text-muted">{contacts.length}</span>
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setEditing({ open: true, contact: null })}>
          <Plus /> Adicionar
        </Button>
      </CardHeader>
      <CardContent className="px-2 pb-2 pt-0">
        {contacts.length === 0 ? (
          <EmptyState size="sm" icon={<UserRound />} title="Sem contatos" description="Adicione quem responde pela empresa." />
        ) : (
          <ul className="flex flex-col">
            {contacts.map((c) => {
              const tel = telHref(c.phone);
              const wa = whatsappHref(c.whatsapp ?? c.phone);
              return (
                <li key={c.id} className="group/contact rounded-md px-3 py-2.5 transition-colors hover:bg-surface-muted">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium leading-tight">
                        <span className="truncate">{c.name}</span>
                        {c.isPrimary ? (
                          <Badge variant="brand" size="sm" title="Contato principal">
                            <Star /> Principal
                          </Badge>
                        ) : null}
                        {c.isDecisionMaker ? (
                          <Badge variant="outline" size="sm" title="Decisor">
                            <Crown /> Decisor
                          </Badge>
                        ) : null}
                      </p>
                      {c.role ? <p className="text-xs text-muted">{c.role}</p> : null}
                      <div className="mt-1.5 flex flex-col gap-0.5 text-xs text-muted">
                        {c.phone ? (
                          <a href={tel ?? undefined} className="inline-flex items-center gap-1.5 hover:text-foreground">
                            <Phone className="size-3" aria-hidden /> {formatPhone(c.phone)}
                          </a>
                        ) : null}
                        {c.whatsapp ? (
                          <a href={wa ?? undefined} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-foreground">
                            <MessageCircle className="size-3" aria-hidden /> {formatPhone(c.whatsapp)}
                          </a>
                        ) : null}
                        {c.email ? (
                          <a href={`mailto:${c.email}`} className="inline-flex min-w-0 items-center gap-1.5 hover:text-foreground">
                            <Mail className="size-3 shrink-0" aria-hidden /> <span className="truncate">{c.email}</span>
                          </a>
                        ) : null}
                      </div>
                    </div>
                    <div className={cn("flex shrink-0 items-center gap-0.5 md:opacity-0 md:transition-opacity md:group-hover/contact:opacity-100 md:focus-within:opacity-100")}>
                      <Button variant="ghost" size="icon" className="size-8" aria-label={`Editar ${c.name}`} onClick={() => setEditing({ open: true, contact: c })}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8 text-muted hover:text-danger" aria-label={`Remover ${c.name}`} onClick={() => setRemoving(c)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      {editing.open ? <ContactDialog key={editing.contact?.id ?? "novo"} clientId={clientId} contact={editing.contact} open={editing.open} onOpenChange={(open) => setEditing((s) => ({ ...s, open }))} firstContact={contacts.length === 0} /> : null}

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remover contato?"
        description={removing ? `${removing.name} deixará de aparecer na ficha do cliente. O histórico na timeline é mantido.` : undefined}
        confirmLabel="Remover"
        destructive
        onConfirm={confirmRemove}
      />
    </Card>
  );
}
