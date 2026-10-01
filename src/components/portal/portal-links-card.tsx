"use client";

import * as React from "react";
import { ExternalLink, Link2, Link2Off, Mail, MessageCircle, Plus } from "lucide-react";
import { createPortalLinkAction, revokePortalLinkAction, sendPortalLinkAction, type CreatedPortalLinkView } from "@/server/portal/actions";
import type { PortalLinkRow } from "@/server/portal/service";
import { PORTAL_DEFAULT_DAYS, PORTAL_MAX_DAYS, PORTAL_MIN_DAYS } from "@/domain/portal";
import { formatDate, formatDateTime, formatPhone } from "@/lib/format";
import { mailtoHref, whatsappHref } from "@/components/clients/contact-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFinanceAction } from "@/components/finance/use-finance-action";
import { CopyButton } from "./copy-button";

export interface PortalLinksCardProps {
  clientId: string;
  /** Contrato de onde o link é gerado (página do contrato); ausente na ficha do cliente. */
  contractId?: string;
  clientName: string;
  links: PortalLinkRow[];
  inactiveCount: number;
  canCreate: boolean;
  canRevoke: boolean;
  className?: string;
}

const ORIGIN_VARIANT: Record<PortalLinkRow["origin"], "brand" | "secondary"> = { manual: "brand", mensagem: "secondary" };

/**
 * "Portal do cliente" (D31): gerar link (mostrado UMA vez, Copiar, Enviar por WhatsApp/e-mail) e lista dos links
 * ativos (rótulo, origem, criado por/em, validade, último acesso, nº de acessos) com "Revogar". As actions revalidam
 * permissão (financeiro.contratos.portal.*) e escopo; aqui só se escondem botões.
 */
export function PortalLinksCard({ clientId, contractId, clientName, links, inactiveCount, canCreate, canRevoke, className }: PortalLinksCardProps) {
  const [creating, setCreating] = React.useState(false);
  const [revoking, setRevoking] = React.useState<PortalLinkRow | null>(null);

  return (
    <Card className={className} data-testid="portal-card">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Link2 className="size-4 text-muted" /> Portal do cliente
          </CardTitle>
          <CardDescription>Contratos, boletos e cobranças de {clientName} por link, sem login e somente leitura. O link aparece uma única vez.</CardDescription>
        </div>
        {canCreate ? (
          <Button size="sm" className="h-10 shrink-0 md:h-8" onClick={() => setCreating(true)}>
            <Plus /> Gerar link
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {links.length === 0 ? (
          <EmptyState size="sm" icon={<Link2 />} title="Nenhum link ativo" description={canCreate ? "Gere um link para o cliente consultar contratos, boletos e cobranças." : "Nenhum link do portal ativo para este cliente."} />
        ) : (
          <ul className="flex flex-col gap-2">
            {links.map((l) => (
              <li key={l.id} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-start sm:justify-between" data-testid="portal-link-row" data-label={l.label ?? ""} data-origin={l.origin}>
                <div className="min-w-0 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="break-words">{l.label ?? "Link sem rótulo"}</span>
                    <Badge variant={ORIGIN_VARIANT[l.origin]} size="sm">
                      {l.originLabel}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted">
                    Criado por {l.createdByName} em {formatDateTime(l.createdAt)}
                    {l.contractNumber ? ` · contrato ${l.contractNumber}` : ""}
                  </p>
                  <p className="text-xs text-muted">
                    Expira em {formatDate(l.expiresAt)} · {l.lastAccessAt ? `último acesso ${formatDateTime(l.lastAccessAt)}` : "nunca acessado"} · {l.accessCount} acesso{l.accessCount === 1 ? "" : "s"}
                  </p>
                </div>
                {canRevoke ? (
                  <Button size="sm" variant="outline" className="h-10 shrink-0 md:h-8" onClick={() => setRevoking(l)} aria-label={`Revogar o link ${l.label ?? "sem rótulo"}`}>
                    <Link2Off /> Revogar
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {inactiveCount > 0 ? <p className="text-xs text-muted">{inactiveCount} link(s) revogado(s) ou expirado(s) — não abrem mais o portal.</p> : null}
      </CardContent>
      {creating ? <CreateLinkDialog clientId={clientId} contractId={contractId} onClose={() => setCreating(false)} /> : null}
      {revoking ? <RevokeLinkDialog link={revoking} onClose={() => setRevoking(null)} /> : null}
    </Card>
  );
}

function CreateLinkDialog({ clientId, contractId, onClose }: { clientId: string; contractId?: string; onClose: () => void }) {
  const id = React.useId();
  const [days, setDays] = React.useState(String(PORTAL_DEFAULT_DAYS));
  const [label, setLabel] = React.useState("");
  const [created, setCreated] = React.useState<CreatedPortalLinkView | null>(null);
  const [text, setText] = React.useState("");
  const { pending, run } = useFinanceAction();
  const daysNumber = Number(days);
  const validDays = Number.isInteger(daysNumber) && daysNumber >= PORTAL_MIN_DAYS && daysNumber <= PORTAL_MAX_DAYS;

  const generate = async () => {
    await run(
      () => createPortalLinkAction({ clientId, contractId, days: daysNumber, label: label.trim() || undefined }),
      "Link do portal gerado",
      (data) => {
        setCreated(data);
        setText(data.message);
      },
    );
  };

  const send = async (channel: "whatsapp" | "email") => {
    if (!created) return;
    await run(
      () => sendPortalLinkAction({ linkId: created.linkId, token: created.token, channel, text }),
      (d) => (d.result.delivery === "enviada" ? `Link enviado por ${channel === "whatsapp" ? "WhatsApp" : "e-mail"}` : d.result.delivery === "manual" ? `Envio registrado (${channel === "whatsapp" ? "WhatsApp" : "e-mail"} manual)` : `Não enviado: ${d.result.error ?? "canal indisponível"}`),
    );
  };

  const channelButton = (channel: "whatsapp" | "email") => {
    if (!created) return null;
    const r = created.recipient;
    const Icon = channel === "whatsapp" ? MessageCircle : Mail;
    const label = channel === "whatsapp" ? "WhatsApp" : "e-mail";
    const to = channel === "whatsapp" ? r.phone : r.email;
    const connected = channel === "whatsapp" ? r.whatsappConnected : r.emailConnected;
    if (r.optOut[channel])
      return (
        <Button key={channel} disabled className="h-11 md:h-9">
          <Icon /> Cliente sem {label} (opt-out)
        </Button>
      );
    if (!to)
      return (
        <Button key={channel} disabled className="h-11 md:h-9">
          <Icon /> Sem {channel === "whatsapp" ? "telefone" : "e-mail"}
        </Button>
      );
    if (connected)
      return (
        <Button key={channel} variant={channel === "whatsapp" ? "primary" : "outline"} onClick={() => send(channel)} loading={pending} disabled={!text.includes(created.url)} className="h-11 md:h-9">
          <Icon /> Enviar por {label}
        </Button>
      );
    // Sem integração: abre o WhatsApp/e-mail do aparelho com o texto pronto e registra o envio manual.
    const href = channel === "whatsapp" ? `${whatsappHref(to)}?text=${encodeURIComponent(text)}` : mailtoHref([to], "Portal do Cliente — Intercert", text);
    return (
      <Button key={channel} asChild variant={channel === "whatsapp" ? "primary" : "outline"} className="h-11 md:h-9">
        <a href={href} target={channel === "whatsapp" ? "_blank" : undefined} rel="noreferrer" onClick={() => void send(channel)} aria-disabled={pending || !text.includes(created.url)}>
          <Icon /> Abrir {channel === "whatsapp" ? "WhatsApp" : "e-mail"} e registrar
        </a>
      </Button>
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{created ? "Link do portal gerado" : "Gerar link do portal do cliente"}</DialogTitle>
          <DialogDescription>
            {created
              ? `Válido até ${formatDate(created.expiresAt)}. Copie ou envie agora: por segurança, o link não é exibido de novo (só fica registrado que existe).`
              : "O cliente vê contratos vigentes, documento assinado e cobranças (boleto/PIX quando registrados). Sem login e somente leitura; você pode revogar a qualquer momento."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {created ? (
            <>
              <FormField label="Link do portal" htmlFor={`${id}-url`}>
                <Input id={`${id}-url`} value={created.url} readOnly onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" data-testid="portal-generated-url" />
              </FormField>
              <div className="flex flex-wrap gap-2">
                <CopyButton value={created.url} label="Copiar link" testId="portal-copy-url" />
                <Button asChild variant="ghost" className="h-11 md:h-9">
                  <a href={created.url} target="_blank" rel="noreferrer">
                    <ExternalLink /> Abrir
                  </a>
                </Button>
              </div>
              <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-muted">
                Destinatário: {created.recipient.contactName}
                {created.recipient.phone ? ` · ${formatPhone(created.recipient.phone)}` : ""}
                {created.recipient.email ? ` · ${created.recipient.email}` : ""}. {created.recipient.whatsappConnected ? "WhatsApp conectado." : "WhatsApp não conectado: o botão abre o app com o texto pronto e registra o envio manual."}
              </p>
              <FormField label="Mensagem" htmlFor={`${id}-msg`} hint="A mensagem precisa conter o link. O registro da comunicação guarda o texto com o link mascarado.">
                <Textarea id={`${id}-msg`} value={text} onChange={(e) => setText(e.target.value)} rows={5} />
              </FormField>
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Validade (dias)" htmlFor={`${id}-days`} required hint={`De ${PORTAL_MIN_DAYS} a ${PORTAL_MAX_DAYS} dias`} error={days && !validDays ? "Validade inválida" : undefined}>
                <Input id={`${id}-days`} type="number" inputMode="numeric" min={PORTAL_MIN_DAYS} max={PORTAL_MAX_DAYS} value={days} onChange={(e) => setDays(e.target.value)} />
              </FormField>
              <FormField label="Rótulo (opcional)" htmlFor={`${id}-label`} hint="Ex.: enviado ao financeiro do cliente">
                <Input id={`${id}-label`} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
              </FormField>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending} className="h-11 md:h-9">
            {created ? "Concluir" : "Cancelar"}
          </Button>
          {created ? (
            <>
              {channelButton("email")}
              {channelButton("whatsapp")}
            </>
          ) : (
            <Button onClick={generate} loading={pending} disabled={!validDays} className="h-11 md:h-9">
              <Link2 /> Gerar link
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevokeLinkDialog({ link, onClose }: { link: PortalLinkRow; onClose: () => void }) {
  const id = React.useId();
  const [reason, setReason] = React.useState("");
  const { pending, run } = useFinanceAction();
  const revoke = async () => {
    const ok = await run(() => revokePortalLinkAction({ linkId: link.id, reason: reason.trim() || undefined }), "Link do portal revogado");
    if (ok) onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Revogar link do portal?</DialogTitle>
          <DialogDescription>
            {link.label ?? "Link sem rótulo"} · {link.originLabel} · criado em {formatDate(link.createdAt)}. Quem abrir este link passa a ver “Link inválido ou expirado”. Não dá para desfazer: gere um novo link se precisar.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormField label="Motivo (opcional)" htmlFor={`${id}-r`}>
            <Textarea id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} placeholder="Ex.: link enviado ao contato errado" />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending} className="h-11 md:h-9">
            Voltar
          </Button>
          <Button variant="destructive" onClick={revoke} loading={pending} className="h-11 md:h-9">
            <Link2Off /> Revogar link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
