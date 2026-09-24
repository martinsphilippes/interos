"use client";

import * as React from "react";
import { ExternalLink, FileText, Plus } from "lucide-react";
import type { Document } from "@/domain/types";
import { addDocument } from "@/server/implementation/actions";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useImplementationAction } from "./use-implementation-action";

/** Documentos do projeto (por link): atas, termos de aceite, evidências, roteiros. */
export function DocumentsTab({ projectId, documents, users, editable }: { projectId: string; documents: Document[]; users: { id: string; name: string }[]; editable: boolean }) {
  const { pending, run } = useImplementationAction();
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [category, setCategory] = React.useState("");
  const names = new Map(users.map((u) => [u.id, u.name]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => addDocument({ projectId, name, url, category }), "Documento anexado")) {
      setName("");
      setUrl("");
      setCategory("");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {documents.length === 0 ? (
        <EmptyState size="sm" icon={<FileText />} title="Nenhum documento" description="Anexe por link a ata do kickoff, o termo de aceite e as evidências da implantação." />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-3">
              <FileText className="size-4 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium hover:underline">
                  {d.name} <ExternalLink className="size-3" aria-hidden />
                </a>
                <p className="text-xs text-muted">
                  {d.category ? `${d.category} · ` : ""}
                  {formatDate(d.createdAt)} · {names.get(d.uploadedBy) ?? "—"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editable ? (
        <form onSubmit={submit} className="grid gap-3 rounded-lg border border-dashed border-border-strong p-3 md:grid-cols-[1fr_1.4fr_160px_auto] md:items-end">
          <FormField label="Nome" htmlFor="doc-name" required>
            <Input id="doc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Termo de aceite" required maxLength={160} className="h-11 md:h-9" />
          </FormField>
          <FormField label="Link" htmlFor="doc-url" required>
            <Input id="doc-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" required className="h-11 md:h-9" />
          </FormField>
          <FormField label="Categoria" htmlFor="doc-cat">
            <Input id="doc-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="aceite" maxLength={60} className="h-11 md:h-9" />
          </FormField>
          <Button type="submit" loading={pending} className="h-11 md:h-9">
            <Plus /> Anexar
          </Button>
        </form>
      ) : null}
    </div>
  );
}
