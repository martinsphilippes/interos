"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Check, ClipboardCopy, FilePlus2, FileText, RotateCcw, TriangleAlert } from "lucide-react";
import type { InvoiceIssueData, InvoiceQueueRow } from "@/server/finance/invoices";
import { invoiceIssueDataAction, restoreInvoiceAction, waiveInvoiceAction } from "@/server/finance/invoice-actions";
import { INVOICE_KIND_LABELS, INVOICE_KIND_SHORT, INVOICE_QUEUE_STATE_LABELS } from "@/domain/fiscal";
import type { InvoiceKind } from "@/domain/types";
import { formatCompetence, formatDate, formatDocument } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { ReasonDialog } from "@/components/commissions/commission-ui";
import { useFinanceAction } from "@/components/finance/use-finance-action";
import { money } from "@/components/finance/values";

export interface InvoicingCan {
  values: boolean;
  register: boolean;
  send: boolean;
  cancel: boolean;
  waive: boolean;
  issueData: boolean;
  files: boolean;
  configView: boolean;
  configEdit: boolean;
}

const STATE_VARIANT = {
  a_faturar: "warning",
  aguardando: "muted",
  emitida: "info",
  enviada: "success",
  dispensada: "muted",
  sem_nota: "muted",
  fora: "muted",
} as const;

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Cobranças do faturamento: "A faturar", as próximas (aguardando o momento) e as dispensadas. */
export function InvoiceQueue({ rows, can, mode }: { rows: InvoiceQueueRow[]; can: InvoicingCan; mode: "a_faturar" | "aguardando" | "dispensada" }) {
  const [registering, setRegistering] = React.useState<InvoiceQueueRow | null>(null);
  const [waiving, setWaiving] = React.useState<InvoiceQueueRow | null>(null);
  const { pending, run } = useFinanceAction();
  const hidden = !can.values;

  if (rows.length === 0) {
    const empty = {
      a_faturar: {
        title: "Nada a faturar agora",
        description: "Quando uma cobrança chegar ao momento configurado (dias antes do vencimento ou depois do pagamento), ela aparece aqui.",
      },
      aguardando: {
        title: "Nenhuma cobrança a caminho",
        description: "As próximas cobranças que vão pedir nota aparecem aqui antes de entrar na fila.",
      },
      dispensada: {
        title: "Nenhuma cobrança dispensada",
        description: "Cobranças dispensadas de nota (com motivo) ficam aqui e podem voltar para a fila.",
      },
    }[mode];
    return (
      <Card>
        <EmptyState icon={<FileText />} title={empty.title} description={empty.description} />
      </Card>
    );
  }

  return (
    <>
      <Card className="min-w-0 overflow-hidden">
        <ul className="flex flex-col divide-y divide-border" data-testid={`invoice-queue-${mode}`}>
          {rows.map((r) => (
            <li key={r.billingId} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <Link href={`/clientes/${r.clientId}`} className="min-w-0 break-words hover:underline">
                    {r.clientName}
                  </Link>
                  {r.kind ? (
                    <Badge variant="info" size="sm" title={INVOICE_KIND_LABELS[r.kind]}>
                      {INVOICE_KIND_SHORT[r.kind]}
                    </Badge>
                  ) : null}
                  <Badge variant={STATE_VARIANT[r.state]} size="sm">
                    {INVOICE_QUEUE_STATE_LABELS[r.state]}
                  </Badge>
                </p>
                <p className="mt-0.5 break-words text-xs text-muted">
                  {r.typeLabel}
                  {r.installment && r.type !== "mensalidade" ? ` (parcela ${r.installment})` : ""} · {formatCompetence(r.competence)} ·{" "}
                  <Link href={`/financeiro/contratos/${r.contractId}`} className="hover:underline">
                    contrato {r.contractNumber}
                  </Link>
                  {r.billingStatus === "paga" ? " · paga" : r.billingStatus === "vencida" ? " · vencida" : ""}
                  {r.waivedReason ? ` · motivo: ${r.waivedReason}` : ""}
                </p>
              </div>
              <div className="text-sm md:w-[200px] md:shrink-0 md:text-right">
                <p className="font-medium tabular-nums">{money(r.amount, hidden)}</p>
                <p className="text-xs text-muted">vence {formatDate(r.dueDate)}</p>
              </div>
              <div className="flex flex-wrap gap-2 md:shrink-0 md:justify-end">
                {mode !== "dispensada" && can.register && can.values ? (
                  <Button size="sm" className="h-10 md:h-8" onClick={() => setRegistering(r)} aria-label={`Registrar nota de ${r.clientName}`}>
                    <FilePlus2 /> Registrar nota
                  </Button>
                ) : null}
                {mode !== "dispensada" && can.waive ? (
                  <Button variant="ghost" size="sm" className="h-10 md:h-8" onClick={() => setWaiving(r)}>
                    <Ban /> Dispensar
                  </Button>
                ) : null}
                {mode === "dispensada" && can.waive ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 md:h-8"
                    disabled={pending}
                    onClick={() => void run(() => restoreInvoiceAction({ billingId: r.billingId }), "A cobrança volta a exigir nota")}
                  >
                    <RotateCcw /> Voltar a exigir nota
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {registering ? <RegisterInvoiceDialog row={registering} can={can} onClose={() => setRegistering(null)} /> : null}

      <ReasonDialog
        open={waiving !== null}
        onOpenChange={(o) => !o && setWaiving(null)}
        title="Dispensar esta cobrança de nota?"
        description={waiving ? `${waiving.clientName} · ${waiving.typeLabel} · ${formatCompetence(waiving.competence)}. Ela sai da fila "A faturar"; dá para desfazer.` : undefined}
        placeholder="Ex.: nota emitida fora do INTEROS antes do controle; cortesia sem nota"
        confirmLabel="Dispensar"
        pending={pending}
        onConfirm={async (reason) => {
          if (!waiving) return false;
          const ok = await run(() => waiveInvoiceAction({ billingId: waiving.billingId, reason }), "Cobrança dispensada de nota");
          if (ok) setWaiving(null);
          return ok;
        }}
      />
    </>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = React.useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-surface-muted hover:text-foreground"
      aria-label={`Copiar ${label}`}
      title={`Copiar ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check className="size-3.5 text-success" /> : <ClipboardCopy className="size-3.5" />}
    </button>
  );
}

function DataLine({ label, value, copy }: { label: string; value?: string; copy?: string }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1">
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className="break-words text-sm">{value || "—"}</p>
      </div>
      <CopyButton value={copy ?? value ?? ""} label={label.toLowerCase()} />
    </div>
  );
}

/** Dados para emitir: o que copiar para o emissor da prefeitura/SEFAZ, com as pendências que travam a emissão. */
function IssueDataPanel({ data, hidden }: { data: InvoiceIssueData; hidden: boolean }) {
  const a = data.taker.address;
  const address = [a.street, a.number, a.complement, a.district, a.city && `${a.city}${a.state ? `/${a.state}` : ""}`, a.zip].filter(Boolean).join(", ");
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-muted/40 p-3" data-testid="invoice-issue-data">
      <p className="text-sm font-medium">Dados para emitir no emissor</p>
      {data.gaps.length > 0 ? (
        <div role="status" className="flex flex-col gap-1 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning-fg">
          {data.gaps.map((g) => (
            <p key={g} className="flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {g}
            </p>
          ))}
        </div>
      ) : null}
      <div className="grid gap-x-4 sm:grid-cols-2">
        <DataLine label="Tomador (razão social)" value={data.taker.legalName} />
        <DataLine label="CNPJ/CPF" value={data.taker.document ? formatDocument(data.taker.document) : undefined} copy={data.taker.document?.replace(/\D/g, "")} />
        <DataLine label="E-mail" value={data.taker.email} />
        <DataLine label="Endereço" value={address} />
      </div>
      {data.items.length > 0 ? (
        <div className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
          {data.items.map((i) => (
            <div key={i.productId} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 break-words font-medium">
                  {i.quantity}x {i.description}
                </p>
                <span className="shrink-0 tabular-nums">{money(i.total, hidden)}</span>
              </div>
              <p className="text-xs text-muted">
                {data.kind === "nfe"
                  ? `NCM ${i.ncm ?? "—"} · CFOP ${i.cfop ?? "—"}`
                  : `Serviço ${i.serviceCode ?? "—"}${i.issRate !== undefined ? ` · ISS ${String(i.issRate).replace(".", ",")}%` : ""}`}
                {hidden ? "" : ` · unitário ${money(i.unitValue, hidden)}`}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {data.scaled ? <p className="text-xs text-muted">Os valores dos itens foram ajustados ao valor da cobrança (reajuste, parcela ou desconto).</p> : null}
      <DataLine label="Discriminação" value={data.description} />
    </div>
  );
}

function RegisterInvoiceDialog({ row, can, onClose }: { row: InvoiceQueueRow; can: InvoicingCan; onClose: () => void }) {
  const id = React.useId();
  const router = useRouter();
  const [data, setData] = React.useState<InvoiceIssueData | null>(null);
  const [loading, setLoading] = React.useState(can.issueData);
  const [saving, setSaving] = React.useState(false);
  const [kind, setKind] = React.useState<InvoiceKind>(row.kind ?? "nfse");
  const [form, setForm] = React.useState({
    numero: "",
    serie: "",
    emissao: todayLocal(),
    chave: "",
    codigo: "",
    valor: row.amount ? String(row.amount.toFixed(2)).replace(".", ",") : "",
    observacao: "",
  });
  const [pdf, setPdf] = React.useState<File | null>(null);
  const [xml, setXml] = React.useState<File | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  React.useEffect(() => {
    if (!can.issueData) return;
    let alive = true;
    void invoiceIssueDataAction({ billingId: row.billingId }).then((r) => {
      if (!alive) return;
      if (r.ok) setData(r.data);
      else toast.error(r.error);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [row.billingId, can.issueData]);

  const keyDigits = form.chave.replace(/\D/g, "");
  const keyProblem = kind === "nfe" && keyDigits && keyDigits.length !== 44 ? "A chave tem 44 dígitos" : null;
  const valid = (form.numero.trim() || (kind === "nfe" && xml)) && form.emissao && form.valor.trim() && !keyProblem;

  const submit = async () => {
    setSaving(true);
    try {
      const body = new FormData();
      body.set("billingId", row.billingId);
      body.set("tipo", kind);
      for (const [k, v] of Object.entries(form)) body.set(k, v);
      if (pdf) body.set("pdf", pdf);
      if (xml) body.set("xml", xml);
      const res = await fetch("/api/financeiro/notas", {
        method: "POST",
        body,
      });
      const json = (await res.json().catch(() => null)) as {
        ok: boolean;
        error?: string;
        data?: { number: string };
      } | null;
      if (!json?.ok) {
        toast.error(json?.error ?? "Não foi possível registrar a nota");
        return;
      }
      toast.success(`${INVOICE_KIND_SHORT[kind]} ${json.data?.number ?? ""} registrada`);
      onClose();
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Registrar nota fiscal</DialogTitle>
          <DialogDescription>
            {row.clientName} · {row.typeLabel} · {formatCompetence(row.competence)} · contrato {row.contractNumber}
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) void submit();
          }}
        >
          <DialogBody className="grid gap-4 py-2">
            {loading ? <p className="text-sm text-muted">Carregando os dados da nota…</p> : data ? <IssueDataPanel data={data} hidden={!can.values} /> : null}
            <p className="text-sm text-muted">Emita a nota no emissor e registre aqui o que saiu. O XML da NF-e já preenche número e chave.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="Tipo da nota" htmlFor={`${id}-k`} required>
                <Select id={`${id}-k`} value={kind} onChange={(e) => setKind(e.target.value as InvoiceKind)} className="h-11 md:h-9">
                  <option value="nfse">{INVOICE_KIND_LABELS.nfse}</option>
                  <option value="nfe">{INVOICE_KIND_LABELS.nfe}</option>
                </Select>
              </FormField>
              <FormField label="Número" htmlFor={`${id}-n`} required={!(kind === "nfe" && xml)} hint={kind === "nfe" && xml ? "Lido do XML se vazio" : undefined}>
                <Input id={`${id}-n`} value={form.numero} onChange={set("numero")} inputMode="numeric" className="h-11 md:h-9" autoFocus />
              </FormField>
              <FormField label="Série" htmlFor={`${id}-s`}>
                <Input id={`${id}-s`} value={form.serie} onChange={set("serie")} className="h-11 md:h-9" />
              </FormField>
              <FormField label="Data de emissão" htmlFor={`${id}-d`} required>
                <Input id={`${id}-d`} type="date" value={form.emissao} max={todayLocal()} onChange={set("emissao")} className="h-11 md:h-9" />
              </FormField>
              <FormField label="Valor da nota" htmlFor={`${id}-v`} required>
                <Input id={`${id}-v`} value={form.valor} onChange={set("valor")} inputMode="decimal" className="h-11 tabular-nums md:h-9" />
              </FormField>
              {kind === "nfe" ? (
                <FormField label="Chave de acesso" htmlFor={`${id}-c`} error={keyProblem ?? undefined} className="sm:col-span-3" hint="44 dígitos (opcional se anexar o XML)">
                  <Input id={`${id}-c`} value={form.chave} onChange={set("chave")} inputMode="numeric" className="h-11 font-mono md:h-9" />
                </FormField>
              ) : (
                <FormField label="Código de verificação" htmlFor={`${id}-cv`}>
                  <Input id={`${id}-cv`} value={form.codigo} onChange={set("codigo")} className="h-11 md:h-9" />
                </FormField>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="PDF da nota (DANFE/DANFSe)" htmlFor={`${id}-pdf`} hint="Até 3 MB · vai para o portal do cliente">
                <Input id={`${id}-pdf`} type="file" accept="application/pdf,.pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} className="h-11 md:h-9" />
              </FormField>
              <FormField label="XML da nota" htmlFor={`${id}-xml`} hint="Até 1 MB">
                <Input id={`${id}-xml`} type="file" accept=".xml,application/xml,text/xml" onChange={(e) => setXml(e.target.files?.[0] ?? null)} className="h-11 md:h-9" />
              </FormField>
            </div>
            <FormField label="Observação" htmlFor={`${id}-o`}>
              <Textarea id={`${id}-o`} value={form.observacao} onChange={set("observacao")} maxLength={500} className="min-h-[60px]" />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving} className="h-11 md:h-9">
              Cancelar
            </Button>
            <Button type="submit" loading={saving} disabled={!valid} className="h-11 md:h-9">
              Registrar nota
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
