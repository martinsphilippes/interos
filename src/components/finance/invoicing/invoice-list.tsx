"use client";

import * as React from "react";
import Link from "next/link";
import { Download, FileText, Send, XCircle } from "lucide-react";
import type { InvoiceListRow } from "@/server/finance/invoices";
import { cancelInvoiceAction, invoiceMessageDraftAction, sendInvoiceAction } from "@/server/finance/invoice-actions";
import { INVOICE_KIND_LABELS, INVOICE_KIND_SHORT } from "@/domain/fiscal";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ReasonDialog } from "@/components/commissions/commission-ui";
import { useFinanceAction } from "@/components/finance/use-finance-action";
import { money } from "@/components/finance/values";
import type { InvoicingCan } from "./invoice-queue";

/** Notas registradas: baixar PDF/XML, enviar ao cliente e cancelar (a cobrança volta para "A faturar"). */
export function InvoiceList({ rows, can }: { rows: InvoiceListRow[]; can: InvoicingCan }) {
  const [sending, setSending] = React.useState<InvoiceListRow | null>(null);
  const [cancelling, setCancelling] = React.useState<InvoiceListRow | null>(null);
  const { pending, run } = useFinanceAction();
  const hidden = !can.values;

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={<FileText />} title="Nenhuma nota registrada" description="As notas registradas na fila «A faturar» aparecem aqui, com o PDF/XML e o envio ao cliente." />
      </Card>
    );
  }

  return (
    <>
      <Card className="min-w-0 overflow-hidden">
        <ul className="flex flex-col divide-y divide-border" data-testid="invoice-list">
          {rows.map((r) => {
            const cancelled = r.status === "cancelada";
            const label = `${INVOICE_KIND_SHORT[r.kind]} ${r.number}${r.series ? `/${r.series}` : ""}`;
            return (
              <li key={r.id} className={cn("flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-4", cancelled && "opacity-70")}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span title={INVOICE_KIND_LABELS[r.kind]}>{label}</span>
                    {cancelled ? (
                      <Badge variant="muted" size="sm" title={r.cancelReason}>
                        Cancelada
                      </Badge>
                    ) : r.sentAt ? (
                      <Badge variant="success" size="sm" title={`Enviada ${formatDateTime(r.sentAt)}`}>
                        Enviada
                      </Badge>
                    ) : (
                      <Badge variant="warning" size="sm">
                        Não enviada
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 break-words text-xs text-muted">
                    <Link href={`/clientes/${r.clientId}`} className="hover:underline">
                      {r.clientName}
                    </Link>{" "}
                    · {r.billingLabel} ·{" "}
                    <Link href={`/financeiro/contratos/${r.contractId}`} className="hover:underline">
                      contrato {r.contractNumber}
                    </Link>
                    {r.accessKey ? <span className="block font-mono">chave {r.accessKey}</span> : null}
                    {r.verificationCode ? <span className="block">verificação {r.verificationCode}</span> : null}
                    {cancelled && r.cancelReason ? <span className="block">cancelada: {r.cancelReason}</span> : null}
                  </p>
                </div>
                <div className="text-sm md:w-[180px] md:shrink-0 md:text-right">
                  <p className="font-medium tabular-nums">{money(r.amount, hidden)}</p>
                  <p className="text-xs text-muted">emitida {formatDate(r.issuedAt)}</p>
                </div>
                <div className="flex flex-wrap gap-2 md:shrink-0 md:justify-end">
                  {can.files && r.pdfFileId ? (
                    <Button asChild variant="outline" size="sm" className="h-10 md:h-8">
                      <a href={`/api/financeiro/notas/${r.id}/pdf`} target="_blank" rel="noreferrer">
                        <FileText /> PDF
                      </a>
                    </Button>
                  ) : null}
                  {can.files && r.xmlFileId ? (
                    <Button asChild variant="outline" size="sm" className="h-10 md:h-8">
                      <a href={`/api/financeiro/notas/${r.id}/xml`}>
                        <Download /> XML
                      </a>
                    </Button>
                  ) : null}
                  {!cancelled && can.send ? (
                    <Button size="sm" variant={r.sentAt ? "ghost" : "primary"} className="h-10 md:h-8" onClick={() => setSending(r)}>
                      <Send /> {r.sentAt ? "Reenviar" : "Enviar ao cliente"}
                    </Button>
                  ) : null}
                  {!cancelled && can.cancel ? (
                    <Button variant="ghost" size="sm" className="h-10 text-danger md:h-8" onClick={() => setCancelling(r)}>
                      <XCircle /> Cancelar
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {sending ? <SendInvoiceDialog row={sending} onClose={() => setSending(null)} /> : null}

      <ReasonDialog
        open={cancelling !== null}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancelar o registro desta nota?"
        description={
          cancelling
            ? `${INVOICE_KIND_SHORT[cancelling.kind]} ${cancelling.number} · ${cancelling.clientName}. Cancele também no emissor (prefeitura/SEFAZ). A cobrança volta para «A faturar».`
            : undefined
        }
        placeholder="Ex.: valor errado, nota substituída pela nº …"
        confirmLabel="Cancelar nota"
        destructive
        pending={pending}
        onConfirm={async (reason) => {
          if (!cancelling) return false;
          const ok = await run(() => cancelInvoiceAction({ invoiceId: cancelling.id, reason }), "Nota cancelada: a cobrança voltou para «A faturar»");
          if (ok) setCancelling(null);
          return ok;
        }}
      />
    </>
  );
}

function SendInvoiceDialog({ row, onClose }: { row: InvoiceListRow; onClose: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [draft, setDraft] = React.useState<{
    text: string;
    contactName: string;
    email?: string;
    phone?: string;
  } | null>(null);
  const [text, setText] = React.useState("");
  const [channel, setChannel] = React.useState<"email" | "whatsapp" | "ambos">("email");

  React.useEffect(() => {
    let alive = true;
    void invoiceMessageDraftAction({ invoiceId: row.id }).then((r) => {
      if (!alive) return;
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setDraft(r.data);
      setText(r.data.text);
      if (!r.data.email && r.data.phone) setChannel("whatsapp");
    });
    return () => {
      alive = false;
    };
  }, [row.id]);

  const send = async () => {
    const ok = await run(
      () => sendInvoiceAction({ invoiceId: row.id, channel, text }),
      (d) => {
        const manual = d.results.filter((x) => x.manual && x.url);
        for (const m of manual) window.open(m.url!, "_blank", "noopener");
        const failed = d.results.filter((x) => !x.delivered && !x.manual);
        if (failed.length) return `Não enviado por ${failed.map((f) => (f.channel === "email" ? "e-mail" : "WhatsApp")).join(" e ")}: ${failed[0].error ?? "sem contato"}`;
        return manual.length ? "Mensagem aberta no seu aplicativo; o envio ficou registrado" : `Nota enviada para ${d.contactName}`;
      },
    );
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Enviar nota ao cliente</DialogTitle>
          <DialogDescription>
            {INVOICE_KIND_SHORT[row.kind]} {row.number} · {row.clientName}
            {draft ? ` · para ${draft.contactName}` : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <DialogBody className="grid gap-3 py-2">
            <FormField
              label="Canal"
              htmlFor={`${id}-ch`}
              hint={draft ? [draft.email && `e-mail ${draft.email}`, draft.phone && `WhatsApp ${draft.phone}`].filter(Boolean).join(" · ") || "Cliente sem e-mail e sem telefone" : undefined}
            >
              <Select id={`${id}-ch`} value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)} className="h-11 md:h-9">
                <option value="email">E-mail</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="ambos">E-mail e WhatsApp</option>
              </Select>
            </FormField>
            <FormField label="Mensagem" htmlFor={`${id}-t`} hint="{linkPortal} vira o link do Portal do Cliente, onde ficam o PDF e o XML da nota">
              <Textarea id={`${id}-t`} value={text} onChange={(e) => setText(e.target.value)} className="min-h-[140px]" disabled={!draft} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending} className="h-11 md:h-9">
              Cancelar
            </Button>
            <Button type="submit" loading={pending} disabled={!draft || !text.trim()} className="h-11 md:h-9">
              <Send /> Enviar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
