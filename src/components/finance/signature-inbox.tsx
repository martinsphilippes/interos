"use client";

import * as React from "react";
import Link from "next/link";
import { FileText, Inbox, Link2, RotateCcw, Sparkles, XCircle } from "lucide-react";
import type { SignatureInboxItem } from "@/domain/types";
import { assignInboxItemAction, ignoreInboxItemAction, reopenInboxItemAction } from "@/server/finance/signature-actions";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { ClientCombobox } from "@/components/tasks/client-combobox";
import type { ClientOption } from "@/components/tasks/task-model";
import { useFinanceAction } from "./use-finance-action";

const STATUS = {
  em_andamento: { label: "Em assinatura", variant: "warning" },
  finalizado: { label: "Assinado por todos", variant: "success" },
  cancelado: { label: "Cancelado", variant: "muted" },
  recusado: { label: "Recusado", variant: "danger" },
} as const;

type Filter = "pendente" | "vinculado" | "ignorado";

export interface SignatureInboxProps {
  items: SignatureInboxItem[];
  clients: ClientOption[];
  /** Contratos não cancelados, para vincular ao contrato certo do cliente. */
  contracts: { id: string; number: string; clientId: string; status: string }[];
  canEdit: boolean;
  /** Clicksign conectada (os documentos só chegam com ela). */
  providerConnected: boolean;
  /** Item aberto pelo link do documento (?item=). */
  focusId?: string;
}

/** Documentos criados direto na Clicksign: escolher o cliente (e o contrato) certo ou ignorar. */
export function SignatureInbox({ items, clients, contracts, canEdit, providerConnected, focusId }: SignatureInboxProps) {
  const focused = focusId ? items.find((i) => i.id === focusId) : undefined;
  const [filter, setFilter] = React.useState<Filter>(focused?.state ?? "pendente");
  const [assigning, setAssigning] = React.useState<SignatureInboxItem | null>(null);
  const [ignoring, setIgnoring] = React.useState<SignatureInboxItem | null>(null);
  const { pending, run } = useFinanceAction();
  const count = (s: Filter) => items.filter((i) => i.state === s).length;
  const shown = items.filter((i) => i.state === filter);
  const clientName = (id?: string) => clients.find((c) => c.id === id)?.tradeName;

  return (
    <div className="flex flex-col gap-4">
      {!providerConnected ? (
        <p className="rounded-lg border border-info/35 bg-info-soft px-4 py-3 text-sm text-info-fg">
          A Clicksign ainda não está conectada. Quando estiver, todo contrato criado direto lá (fora do INTEROS) aparece aqui para alguém escolher o cliente certo.
        </p>
      ) : null}
      <SegmentedControl
        aria-label="Situação"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "pendente", label: `A destinar (${count("pendente")})` },
          { value: "vinculado", label: `Vinculados (${count("vinculado")})` },
          { value: "ignorado", label: `Ignorados (${count("ignorado")})` },
        ]}
      />
      {shown.length === 0 ? (
        <Card>
          <EmptyState size="sm" icon={<Inbox />} title={filter === "pendente" ? "Nada a destinar" : "Nenhum documento aqui"} description={filter === "pendente" ? "Os contratos criados direto na Clicksign chegam aqui." : undefined} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((item) => (
            <li key={item.id}>
              <Card className={`flex flex-col gap-3 p-4 ${item.id === focusId ? "ring-2 ring-brand" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-xs text-muted">
                      Recebido em {formatDateTime(item.receivedAt)}
                      {item.finishedAt ? ` · finalizado em ${formatDateTime(item.finishedAt)}` : ""}
                    </p>
                  </div>
                  <Badge variant={STATUS[item.providerStatus].variant} size="sm">
                    {STATUS[item.providerStatus].label}
                  </Badge>
                </div>
                <ul className="flex flex-col gap-0.5 text-sm">
                  {item.signers.map((s) => (
                    <li key={`${s.email}-${s.name}`} className="truncate">
                      {s.name} <span className="text-muted">· {s.email}</span>
                      {s.signedAt ? <span className="text-success-fg"> · assinou {formatDateTime(s.signedAt)}</span> : null}
                    </li>
                  ))}
                </ul>
                {item.signedFileId ? (
                  <a href={`/api/financeiro/assinaturas/entrada/${item.id}/arquivo`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-fg hover:underline">
                    <FileText className="size-4" /> PDF assinado
                  </a>
                ) : null}
                {item.state === "pendente" && item.suggestedClientId ? (
                  <p className="flex items-center gap-1.5 text-sm text-brand-fg">
                    <Sparkles className="size-4" /> Sugestão: {clientName(item.suggestedClientId) ?? "cliente"} ({item.suggestionReason})
                  </p>
                ) : null}
                {item.state === "vinculado" ? (
                  <p className="text-sm text-muted">
                    Vinculado a{" "}
                    <Link href={`/clientes/${item.clientId}`} className="font-medium text-foreground hover:text-brand">
                      {clientName(item.clientId) ?? "cliente"}
                    </Link>
                    {item.contractId ? (
                      <>
                        {" "}
                        · contrato{" "}
                        <Link href={`/financeiro/contratos/${item.contractId}`} className="font-medium text-foreground hover:text-brand">
                          {contracts.find((c) => c.id === item.contractId)?.number ?? "ver"}
                        </Link>
                      </>
                    ) : null}{" "}
                    por {item.resolvedByName} em {item.resolvedAt ? formatDateTime(item.resolvedAt) : "—"}
                  </p>
                ) : null}
                {item.state === "ignorado" ? (
                  <p className="text-sm text-muted">
                    Ignorado por {item.resolvedByName}: {item.ignoreReason}
                  </p>
                ) : null}
                {canEdit ? (
                  <div className="flex flex-wrap gap-2">
                    {item.state === "pendente" ? (
                      <>
                        <Button size="sm" onClick={() => setAssigning(item)}>
                          <Link2 /> Destinar ao cliente
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setIgnoring(item)}>
                          <XCircle /> Ignorar
                        </Button>
                      </>
                    ) : null}
                    {item.state === "ignorado" ? (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => void run(() => reopenInboxItemAction({ id: item.id }), "Documento voltou para a caixa de entrada")}>
                        <RotateCcw /> Voltar para a fila
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {assigning ? <AssignDialog item={assigning} clients={clients} contracts={contracts} onClose={() => setAssigning(null)} /> : null}
      {ignoring ? <IgnoreDialog item={ignoring} onClose={() => setIgnoring(null)} /> : null}
    </div>
  );
}

function AssignDialog({ item, clients, contracts, onClose }: { item: SignatureInboxItem; clients: ClientOption[]; contracts: SignatureInboxProps["contracts"]; onClose: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [clientId, setClientId] = React.useState<string | undefined>(item.suggestedClientId);
  const [contractId, setContractId] = React.useState("");
  const options = contracts.filter((c) => c.clientId === clientId).map((c) => ({ value: c.id, label: `${c.number} (${c.status.replace(/_/g, " ")})` }));
  const save = async () => {
    if (!clientId) return;
    const ok = await run(() => assignInboxItemAction({ id: item.id, clientId, contractId: contractId || undefined }), "Documento vinculado ao cliente");
    if (ok) onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Destinar «{item.name}»</DialogTitle>
          <DialogDescription>O documento entra na ficha do cliente (e no contrato, se escolher um).</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <FormField label="Cliente" htmlFor={`${id}-c`} required hint={item.suggestedClientId && clientId === item.suggestedClientId ? `Sugerido: ${item.suggestionReason}` : undefined}>
            <ClientCombobox
              id={`${id}-c`}
              clients={clients}
              value={clientId}
              onChange={(v) => {
                setClientId(v);
                setContractId("");
              }}
              placeholder="Escolha o cliente"
            />
          </FormField>
          <FormField label="Contrato (opcional)" htmlFor={`${id}-k`} hint={clientId && options.length === 0 ? "Este cliente não tem contrato no INTEROS." : undefined}>
            <Select id={`${id}-k`} value={contractId} onChange={(e) => setContractId(e.target.value)} options={[{ value: "", label: "Só na ficha do cliente" }, ...options]} disabled={!clientId || options.length === 0} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={save} loading={pending} disabled={!clientId}>
            Vincular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IgnoreDialog({ item, onClose }: { item: SignatureInboxItem; onClose: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [reason, setReason] = React.useState("");
  const save = async () => {
    const ok = await run(() => ignoreInboxItemAction({ id: item.id, reason }), "Documento ignorado");
    if (ok) onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Ignorar «{item.name}»?</DialogTitle>
          <DialogDescription>Ex.: documento de teste, não é contrato de cliente. Dá para voltar depois.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormField label="Motivo" htmlFor={`${id}-r`} required>
            <Textarea id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={save} loading={pending} disabled={reason.trim().length < 3}>
            Ignorar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
