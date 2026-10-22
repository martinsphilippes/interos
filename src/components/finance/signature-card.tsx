"use client";

import * as React from "react";
import Link from "next/link";
import { BellRing, CheckCircle2, FileText, Mail, PenLine, Plus, Send, ShieldCheck, Trash2 } from "lucide-react";
import type { Contract } from "@/domain/types";
import type { IntegrationFlags } from "@/server/integrations/types";
import { addContactAsSignerAction, addSignerAction, removeSignerAction, sendForSignatureAction, sendSignatureReminderAction } from "@/server/finance/actions";
import { clicksignSignerNameProblem } from "@/domain/contract-templates";
import { DEFAULT_CLIENT_SIGNER_ROLE, NEW_CONTACT_VALUE, signerChoices, type SignerChoice, type SignerOptions } from "./signer-options";
import { SIGNER_STATUS_LABELS } from "@/server/finance/schemas";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { contractDocumentPath, contractEmailHref, reminderEmailHref } from "./contract-links";
import { ManualSignatureButton } from "./manual-signature-dialog";
import { useFinanceAction } from "./use-finance-action";
import { useOrigin } from "@/components/ui/use-origin";
import { RelativeTime } from "@/components/ui/relative-time";
import { useFinanceAccess } from "./finance-access";
import { SignatureDocumentOptions, type SignatureDocumentInfo } from "./signature-document-options";

export interface SignatureCardProps {
  contract: Pick<Contract, "id" | "number" | "version" | "status" | "signers" | "signatureEnvelopeId" | "signatureProvider" | "documentHash" | "signedAt">;
  sentAt?: string;
  reminders: Record<string, { count: number; lastAt: string }>;
  /** Itens/condições/signatários ainda podem mudar. */
  editable: boolean;
  clientName: string;
  clientId: string;
  /** Quem pode ser escolhido como signatário: contatos do cliente e equipe da Intercert. */
  signerOptions?: SignerOptions;
  /** Pode cadastrar contato no cliente (operacao.clientes.contatos.editar): mostra "cadastrar novo contato". */
  canCreateContact?: boolean;
  /** Estado real das integrações (e-mail e assinatura decidem envio automático x manual). */
  integrations: IntegrationFlags;
  /** Modelo do documento, autenticação e download do PDF/Word. */
  documentInfo?: SignatureDocumentInfo;
}

const SIGNER_VARIANT = { pendente: "warning", assinado: "success", recusado: "danger" } as const;

/**
 * Signatários (adicionar/remover) e assinatura. Sem provedor de assinatura conectado: "Gerar documento para
 * assinatura" (hash do conteúdo), envio pelo e-mail do usuário (mailto) e assinatura registrada com evidência.
 */
export function SignatureCard({ contract, sentAt, reminders, editable, clientName, clientId, signerOptions, canCreateContact, integrations, documentInfo }: SignatureCardProps) {
  const id = React.useId();
  // Capacidades do servidor (assinatura: editar signatários, enviar/lembrar, registrar assinatura; documento: ver).
  const { contracts: can } = useFinanceAccess();
  const { pending, run } = useFinanceAction();
  const [adding, setAdding] = React.useState(false);
  // Quem assina: escolhido entre contatos do cliente / equipe, ou um contato novo cadastrado na hora.
  const [choice, setChoice] = React.useState("");
  const [role, setRole] = React.useState(DEFAULT_CLIENT_SIGNER_ROLE);
  const [newContact, setNewContact] = React.useState({ name: "", email: "", position: "", phone: "" });
  const [removing, setRemoving] = React.useState<{ email: string; name: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const sent = Boolean(contract.signatureEnvelopeId);
  const closed = contract.status === "liberado" || contract.status === "cancelado";
  const signedCount = contract.signers.filter((s) => s.status === "assinado").length;
  const allSigned = sent && contract.signers.length > 0 && signedCount === contract.signers.length;
  const providerConnected = integrations.assinatura === "conectado";
  const emailConnected = integrations.email === "conectado";
  // Envio ATUAL foi manual (mailto, registro com evidência)? E o PRÓXIMO envio será manual? Com a Clicksign conectada,
  // gerar de novo um contrato enviado manualmente passa a enviar pela Clicksign.
  const manual = !providerConnected || contract.signatureProvider === "manual";
  const nextManual = !providerConnected;
  const viaClicksign = providerConnected && contract.signatureProvider === "clicksign";
  const origin = useOrigin();
  const mailHref = contractEmailHref({
    number: contract.number,
    version: contract.version,
    clientName,
    documentHash: contract.documentHash,
    documentUrl: `${origin}${contractDocumentPath(contract.id)}`,
    signers: contract.signers,
  });

  const act = async (key: string, fn: () => Promise<boolean>) => {
    setBusy(key);
    await fn();
    setBusy(null);
  };

  const choices = React.useMemo(() => signerChoices(signerOptions ?? { contacts: [], users: [] }, contract.signers, providerConnected), [signerOptions, contract.signers, providerConnected]);
  const selected: SignerChoice | undefined = [...choices.contacts, ...choices.users].find((c) => c.value === choice);
  const creating = choice === NEW_CONTACT_VALUE;
  // Mesmas regras do servidor, para o erro aparecer antes de clicar (o servidor confere tudo de novo antes de gravar).
  const newContactProblem = providerConnected && newContact.name.trim() ? clicksignSignerNameProblem(newContact.name) : null;
  const newEmail = newContact.email.trim().toLowerCase();
  const newEmailProblem = !newEmail ? null : contract.signers.some((s) => s.email.trim().toLowerCase() === newEmail) ? "Este e-mail já é signatário do contrato" : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) ? "E-mail inválido" : null;
  const roleProblem = !role.trim() ? null : role.trim().length < 2 ? "Informe o papel" : role.trim().length > 60 ? "Papel muito longo" : null;
  const canSubmit = creating
    ? Boolean(newContact.name.trim() && newEmail && role.trim() && !newContactProblem && !newEmailProblem && !roleProblem)
    : Boolean(selected && !selected.disabledReason && !selected.nameProblem && role.trim() && !roleProblem);
  const noContacts = (signerOptions?.contacts.length ?? 0) === 0;

  const resetAdd = () => {
    setChoice("");
    setRole(DEFAULT_CLIENT_SIGNER_ROLE);
    setNewContact({ name: "", email: "", position: "", phone: "" });
    setAdding(false);
  };

  const add = async () => {
    if (creating) {
      // Uma ação só no servidor: valida tudo e, se puder, cadastra o contato no cliente e o põe como signatário.
      const ok = await run(() => addContactAsSignerAction({ contractId: contract.id, name: newContact.name.trim(), email: newEmail, position: newContact.position.trim(), phone: newContact.phone, role: role.trim() }), "Contato cadastrado e adicionado como signatário");
      if (ok) resetAdd();
      return;
    }
    if (!selected) return;
    const ok = await run(() => addSignerAction({ contractId: contract.id, source: selected.kind, id: selected.id, role: role.trim() }), "Signatário adicionado");
    if (ok) resetAdd();
  };

  const pick = (value: string) => {
    setChoice(value);
    const next = [...choices.contacts, ...choices.users].find((c) => c.value === value);
    setRole(next ? next.suggestedRole : DEFAULT_CLIENT_SIGNER_ROLE);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PenLine className="size-4 text-muted" /> Assinatura
        </CardTitle>
        <CardDescription>
          {allSigned
            ? `Assinado por todos${contract.signedAt ? ` em ${formatDateTime(contract.signedAt)}` : ""}.`
            : sent
              ? <>{manual ? "Documento gerado" : "Enviado"} {sentAt ? <RelativeTime value={sentAt} /> : ""} · {signedCount}/{contract.signers.length} assinatura(s).</>
              : nextManual
                ? "Documento ainda não gerado. Assinatura digital não conectada: envio manual e registro com evidência."
                : "Ainda não enviado para assinatura. O envio cria o documento na Clicksign e manda o pedido por e-mail."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        {sent ? (
          <div className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted">
            <p className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-success" /> {contract.signatureProvider === "manual" ? "Envio manual · documento" : `Provedor: ${contract.signatureProvider === "clicksign" ? "Clicksign" : (contract.signatureProvider ?? "—")} · envelope`}{" "}
              <span className="font-mono">{contract.signatureEnvelopeId}</span> · v{contract.version}
            </p>
            {contract.documentHash ? (
              <p className="mt-1 truncate font-mono" title={contract.documentHash}>
                {contract.documentHash}
              </p>
            ) : null}
          </div>
        ) : null}

        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {contract.signers.length === 0 ? <li className="px-3 py-4 text-center text-sm text-muted">Nenhum signatário. Adicione quem assina pelo cliente.</li> : null}
          {contract.signers.map((s) => {
            const r = reminders[s.email.toLowerCase()];
            return (
              <li key={s.email} className="flex flex-col gap-2 px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {s.name}
                      {s.party === "contratada" ? (
                        <Badge variant="info" size="sm">
                          Intercert
                        </Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {s.role} · {s.email}
                    </p>
                    {viaClicksign && sent && s.status === "pendente" && !s.providerSignerId ? (
                      <p className="text-xs text-warning-fg">Incluído depois do envio: não recebeu o documento na Clicksign. Reenvie para assinatura.</p>
                    ) : null}
                    {s.signedAt ? (
                      <p className="text-xs text-success-fg">
                        Assinou em {formatDateTime(s.signedAt)}
                        {s.method === "manual" ? " · registro manual" : s.method === "provedor" ? " · confirmado pela Clicksign" : ""}
                      </p>
                    ) : null}
                    {s.evidence ? (
                      <p className="break-words text-xs text-muted" title={s.evidence}>
                        Evidência: {s.evidenceUrl ? s.evidence.replace(` · ${s.evidenceUrl}`, "").replace(s.evidenceUrl, "") : s.evidence}
                        {s.evidenceUrl ? (
                          <a href={s.evidenceUrl} target="_blank" rel="noreferrer" className="ml-1 text-brand-fg hover:underline">
                            abrir documento assinado
                          </a>
                        ) : null}
                      </p>
                    ) : null}
                    {r ? (
                      <p className="text-xs text-muted">
                        {r.count} lembrete(s) · último <RelativeTime value={r.lastAt} />
                      </p>
                    ) : null}
                  </div>
                  <Badge variant={SIGNER_VARIANT[s.status]} size="sm">
                    {s.status === "assinado" ? <CheckCircle2 /> : null}
                    {SIGNER_STATUS_LABELS[s.status]}
                  </Badge>
                </div>
                {(can.sign || can.signatureSend || (can.signersEdit && editable)) && !closed && s.status !== "assinado" ? (
                  <div className="flex flex-wrap gap-2">
                    {sent ? (
                      <>
                        {can.sign ? <ManualSignatureButton contractId={contract.id} contractNumber={contract.number} signer={s} className="h-10 md:h-8" /> : null}
                        {!can.signatureSend ? null : emailConnected || viaClicksign ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-10 md:h-8"
                            loading={busy === `rem:${s.email}`}
                            disabled={pending}
                            onClick={() => act(`rem:${s.email}`, () => run(() => sendSignatureReminderAction({ contractId: contract.id, email: s.email }), (d) => (d.delivered ? `Lembrete enviado para ${s.name}` : `Falha ao enviar o lembrete para ${s.name}`)))}
                          >
                            <BellRing /> Reenviar lembrete
                          </Button>
                        ) : (
                          <Button asChild variant="ghost" size="sm" className="h-10 md:h-8">
                            <a
                              href={reminderEmailHref(contract, s)}
                              onClick={() => void run(() => sendSignatureReminderAction({ contractId: contract.id, email: s.email }), `Lembrete para ${s.name} registrado (enviado pelo seu e-mail)`)}
                            >
                              <BellRing /> Lembrete por e-mail
                            </a>
                          </Button>
                        )}
                      </>
                    ) : null}
                    {can.signersEdit && editable ? (
                      <Button variant="ghost" size="sm" className="h-10 text-danger md:h-8" disabled={pending} onClick={() => setRemoving({ email: s.email, name: s.name })}>
                        <Trash2 /> Remover
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        {can.signersEdit && editable ? (
          adding ? (
            <div className="grid gap-3 rounded-lg border border-border p-3">
              <FormField label="Quem assina" htmlFor={`${id}-q`} required hint={noContacts ? `${clientName} ainda não tem contatos cadastrados.` : choices.contacts.length === 0 ? `Todos os contatos de ${clientName} já assinam este contrato.` : undefined}>
                <Select id={`${id}-q`} value={choice} onChange={(e) => pick(e.target.value)} className="h-11 md:h-9">
                  <option value="">Escolha…</option>
                  {choices.contacts.length > 0 ? (
                    <optgroup label={`Contatos de ${clientName}`}>
                      {choices.contacts.map((c) => (
                        <option key={c.value} value={c.value} disabled={Boolean(c.disabledReason)}>
                          {c.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {choices.users.length > 0 ? (
                    <optgroup label="Equipe Intercert (testemunha, representante)">
                      {choices.users.map((u) => (
                        <option key={u.value} value={u.value}>
                          {u.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {canCreateContact ? <option value={NEW_CONTACT_VALUE}>＋ Cadastrar novo contato de {clientName}</option> : null}
                </Select>
              </FormField>

              {selected?.nameProblem ? (
                <p className="text-xs text-danger-fg" role="alert">
                  {selected.name}: {selected.nameProblem}.{" "}
                  {selected.kind === "contact" ? (
                    <Link href={`/clientes/${clientId}`} className="font-medium underline">
                      Corrija o nome no cadastro do contato
                    </Link>
                  ) : (
                    "Corrija o nome no cadastro do usuário"
                  )}
                  .
                </p>
              ) : null}

              {creating ? (
                <>
                  <FormField label="Nome completo" htmlFor={`${id}-n`} required error={newContactProblem ?? undefined} hint={providerConnected ? "A Clicksign exige nome e sobrenome, sem números." : undefined}>
                    <Input id={`${id}-n`} value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} className="h-11 md:h-9" autoFocus />
                  </FormField>
                  <FormField label="E-mail" htmlFor={`${id}-e`} required error={newEmailProblem ?? undefined} hint="O pedido de assinatura vai para este e-mail.">
                    <Input id={`${id}-e`} type="email" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} className="h-11 md:h-9" />
                  </FormField>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label="Cargo no cliente" htmlFor={`${id}-c`} hint="Ex.: Sócio-administrador">
                      <Input id={`${id}-c`} value={newContact.position} onChange={(e) => setNewContact({ ...newContact, position: e.target.value })} className="h-11 md:h-9" />
                    </FormField>
                    <FormField label="Celular" htmlFor={`${id}-t`} hint="Para código por SMS/WhatsApp">
                      <Input id={`${id}-t`} inputMode="tel" value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} className="h-11 md:h-9" />
                    </FormField>
                  </div>
                </>
              ) : null}

              {selected || creating ? (
                <FormField label="Papel no contrato" htmlFor={`${id}-r`} required error={roleProblem ?? undefined} hint="Ex.: Contratante, Testemunha, Representante legal">
                  <Input id={`${id}-r`} value={role} onChange={(e) => setRole(e.target.value)} className="h-11 md:h-9" />
                </FormField>
              ) : null}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={resetAdd} disabled={pending} className="h-11 md:h-9">
                  Cancelar
                </Button>
                <Button onClick={add} loading={pending} disabled={!canSubmit} className="h-11 md:h-9">
                  {creating ? "Cadastrar e adicionar" : "Adicionar"}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setAdding(true)} className="h-11 md:h-9">
              <Plus /> Adicionar signatário
            </Button>
          )
        ) : null}

        {documentInfo && !closed ? <SignatureDocumentOptions contractId={contract.id} info={documentInfo} canEdit={can.signersEdit && editable && !allSigned} /> : null}

        {can.signatureSend && editable ? (
          <Button
            onClick={() =>
              act("send", () =>
                run(
                  () => sendForSignatureAction({ contractId: contract.id }),
                  (d) => (nextManual ? `Documento gerado (${d.envelopeId}): aguardando assinatura — envio manual` : `Contrato enviado para assinatura pela Clicksign (envelope ${d.envelopeId})`),
                ),
              )
            }
            loading={busy === "send"}
            disabled={pending || contract.signers.length === 0}
            className="h-11 md:h-10"
          >
            {nextManual ? <FileText /> : <Send />}
            {nextManual ? (sent ? "Gerar nova versão do documento" : "Gerar documento para assinatura") : sent ? "Reenviar para assinatura" : "Enviar para assinatura"}
          </Button>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {can.documentsView ? (
            <Button asChild variant="outline" className="h-11 flex-1 md:h-9">
              <Link href={contractDocumentPath(contract.id)}>
                <FileText /> Ver contrato
              </Link>
            </Button>
          ) : null}
          {can.documentsView && allSigned && contract.signatureProvider === "clicksign" ? (
            <Button asChild variant="outline" className="h-11 flex-1 md:h-9">
              <a href={`/api/financeiro/contratos/${contract.id}/assinado`} target="_blank" rel="noreferrer">
                <ShieldCheck /> PDF assinado
              </a>
            </Button>
          ) : null}
          {sent && !allSigned && manual ? (
            <Button asChild variant="outline" className="h-11 flex-1 md:h-9">
              <a href={mailHref}>
                <Mail /> Enviar por e-mail
              </a>
            </Button>
          ) : null}
        </div>
        {sent && !allSigned && manual ? (
          <p className="text-xs text-muted">Envio manual: baixe o PDF (ou o Word preenchido) e anexe ao e-mail. Depois registre cada assinatura com a evidência.</p>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remover signatário?"
        description={removing ? `${removing.name} (${removing.email}) deixa de assinar o contrato ${contract.number}.` : undefined}
        confirmLabel="Remover"
        destructive
        onConfirm={async () => {
          if (removing) await run(() => removeSignerAction({ contractId: contract.id, email: removing.email }), "Signatário removido");
        }}
      />
    </Card>
  );
}
