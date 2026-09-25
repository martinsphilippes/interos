"use client";

import * as React from "react";
import { ExternalLink, FileText, Paperclip, Plus } from "lucide-react";
import type { Document } from "@/domain/types";
import { addContractDocumentAction } from "@/server/finance/actions";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useFinanceAction } from "./use-finance-action";

const CATEGORIES = ["Contrato", "Contrato assinado", "Comprovante de pagamento", "Documento fiscal", "Cadastro", "Outro"];

export interface DocumentsCardProps {
  contractId: string;
  documents: Document[];
  users: Record<string, { name: string }>;
  canOperate: boolean;
}

/** Documentos do contrato (e comprovantes das cobranças), anexados por link. */
export function DocumentsCard({ contractId, documents, users, canOperate }: DocumentsCardProps) {
  const id = React.useId();
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", url: "", category: "Contrato" });
  const { pending, run } = useFinanceAction();

  const save = async () => {
    const ok = await run(() => addContractDocumentAction({ contractId, ...form }), "Documento anexado");
    if (ok) {
      setForm({ name: "", url: "", category: "Contrato" });
      setAdding(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Paperclip className="size-4 text-muted" /> Documentos
        </CardTitle>
        <CardDescription>{documents.length > 0 ? `${documents.length} documento(s)` : "Nenhum documento anexado."}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {documents.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {documents.map((d) => (
              <li key={d.id}>
                <a href={d.url} target="_blank" rel="noreferrer" className="flex min-h-[44px] items-center gap-3 py-2 hover:text-brand">
                  <FileText className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{d.name}</span>
                    <span className="block text-xs text-muted">
                      {d.category ?? "Documento"} · {formatDate(d.createdAt)} · {users[d.uploadedBy]?.name ?? "—"}
                    </span>
                  </span>
                  <ExternalLink className="size-3.5 shrink-0 text-muted" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {canOperate ? (
          adding ? (
            <div className="grid gap-3 rounded-lg border border-border p-3">
              <FormField label="Nome" htmlFor={`${id}-n`} required>
                <Input id={`${id}-n`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Contrato assinado v1" className="h-11 md:h-9" />
              </FormField>
              <FormField label="Link" htmlFor={`${id}-u`} required>
                <Input id={`${id}-u`} type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" className="h-11 md:h-9" />
              </FormField>
              <FormField label="Categoria" htmlFor={`${id}-c`}>
                <Select id={`${id}-c`} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
              </FormField>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAdding(false)} disabled={pending} className="h-11 md:h-9">
                  Cancelar
                </Button>
                <Button onClick={save} loading={pending} disabled={!form.name.trim() || !form.url.trim()} className="h-11 md:h-9">
                  Anexar
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setAdding(true)} className="h-11 md:h-9">
              <Plus /> Anexar documento
            </Button>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
