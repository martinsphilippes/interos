"use client";

import * as React from "react";
import type { ContractSignerEntry } from "@/domain/types";
import { editSignerAction } from "@/server/finance/actions";
import { clicksignSignerNameProblem, isSignerEmail, isWitnessSigner } from "@/domain/contract-templates";
import { signerContact } from "@/domain/contract-signers";
import type { SignerContactOption } from "./signer-options";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useFinanceAction } from "./use-finance-action";

/**
 * Corrigir quem assina (nome, e-mail, papel). Por padrão a correção vai também para o contato do cliente — ou cadastra
 * o contato —, para o próximo contrato já nascer certo.
 */
export function EditSignerDialog({
  contractId,
  signer,
  others,
  contacts,
  teamEmails,
  clientName,
  canEditContacts,
  providerConnected,
  onClose,
}: {
  contractId: string;
  signer: ContractSignerEntry;
  /** E-mails dos outros signatários do contrato (não pode repetir). */
  others: string[];
  contacts: SignerContactOption[];
  teamEmails: string[];
  clientName: string;
  canEditContacts: boolean;
  providerConnected: boolean;
  onClose: () => void;
}) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const contact = signerContact(signer, contacts);
  const isTeam = teamEmails.some((e) => e.trim().toLowerCase() === signer.email.trim().toLowerCase());
  const [name, setName] = React.useState(signer.name);
  const [email, setEmail] = React.useState(signer.email);
  const [role, setRole] = React.useState(signer.role);
  // Testemunha e gente da equipe não viram contato do cliente por padrão.
  const [updateContact, setUpdateContact] = React.useState(canEditContacts && (Boolean(contact) || (!isWitnessSigner(signer) && !isTeam)));
  const newEmail = email.trim().toLowerCase();
  const emailProblem = !newEmail ? null : !isSignerEmail(newEmail) ? "E-mail inválido" : others.some((o) => o.trim().toLowerCase() === newEmail) ? "Este e-mail já é signatário do contrato" : null;
  const nameProblem = providerConnected && name.trim() ? clicksignSignerNameProblem(name) : null;
  const roleProblem = !role.trim() ? null : role.trim().length < 2 ? "Informe o papel" : role.trim().length > 60 ? "Papel muito longo" : null;
  const valid = name.trim().length >= 2 && newEmail && role.trim() && !emailProblem && !nameProblem && !roleProblem;
  const unchanged = name.trim() === signer.name && newEmail === signer.email.trim().toLowerCase() && role.trim() === signer.role;

  const save = async () => {
    const ok = await run(
      () => editSignerAction({ contractId, email: signer.email, name: name.trim(), newEmail, role: role.trim(), updateContact }),
      (d) =>
        [
          "Signatário corrigido",
          updateContact ? (d.contactCreated ? `cadastrado como contato de ${clientName}` : "contato do cliente atualizado") : null,
          d.otherContracts > 0 ? `também em ${d.otherContracts} outro(s) contrato(s) ainda não enviado(s)` : null,
        ]
          .filter(Boolean)
          .join(" · "),
    );
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Corrigir signatário</DialogTitle>
          <DialogDescription>
            {signer.name} · {signer.email}
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !(unchanged && (!updateContact || Boolean(contact)))) void save();
          }}
        >
          <DialogBody className="grid gap-3 py-2">
            <FormField label="Nome completo" htmlFor={`${id}-n`} required error={nameProblem ?? undefined}>
              <Input id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value)} className="h-11 md:h-9" autoFocus />
            </FormField>
            <FormField label="E-mail" htmlFor={`${id}-e`} required error={emailProblem ?? undefined} hint="O pedido de assinatura vai para este e-mail.">
              <Input id={`${id}-e`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 md:h-9" />
            </FormField>
            <FormField label="Papel no contrato" htmlFor={`${id}-r`} required error={roleProblem ?? undefined}>
              <Input id={`${id}-r`} value={role} onChange={(e) => setRole(e.target.value)} className="h-11 md:h-9" />
            </FormField>
            {canEditContacts ? (
              <Checkbox
                checked={updateContact}
                onCheckedChange={(v) => setUpdateContact(v === true)}
                label={contact ? `Atualizar também o contato «${contact.name}» de ${clientName}` : `Cadastrar como contato de ${clientName}`}
                description={
                  contact
                    ? "Os próximos contratos e os contratos ainda não enviados deste cliente passam a usar o nome e o e-mail corrigidos."
                    : "Os próximos contratos deste cliente já trazem esta pessoa."
                }
              />
            ) : contact ? (
              <p className="text-xs text-muted">A correção vale só para este contrato. Para corrigir o contato «{contact.name}», edite-o na ficha do cliente.</p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending} className="h-11 md:h-9">
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={!valid || (unchanged && (!updateContact || Boolean(contact)))} className="h-11 md:h-9">
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
