"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Link2, Paperclip } from "lucide-react";
import { addDocument } from "@/server/clients/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { DOCUMENT_CATEGORIES } from "./labels";

export interface DocumentFormProps {
  clientId: string;
  className?: string;
}

/** Registra um documento por URL (Drive, assinatura digital, ERP). Upload de arquivo entra em outra onda. */
export function DocumentForm({ clientId, className }: DocumentFormProps) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [category, setCategory] = React.useState<string>(DOCUMENT_CATEGORIES[0]);
  const [pending, startTransition] = React.useTransition();
  const id = React.useId();

  const submit = () => {
    startTransition(async () => {
      const result = await addDocument({ clientId, name, url, category });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Documento registrado");
      setName("");
      setUrl("");
      router.refresh();
    });
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <Paperclip className="size-4 text-muted" aria-hidden /> Registrar documento
        </CardTitle>
        <CardDescription>
          Informe o link do arquivo (Google Drive, plataforma de assinatura, ERP). O upload direto de arquivos para o INTEROS ainda não está disponível; por enquanto, o documento fica referenciado
          pelo link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 md:grid-cols-[1fr_1fr_180px_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <FormField label="Nome" htmlFor={`${id}-name`} required>
            <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} placeholder="Ex.: Contrato assinado CT-2026-0001" />
          </FormField>
          <FormField label="Link" htmlFor={`${id}-url`} required>
            <Input id={`${id}-url`} type="url" value={url} onChange={(e) => setUrl(e.target.value)} required leadingIcon={<Link2 />} placeholder="https://…" />
          </FormField>
          <FormField label="Categoria" htmlFor={`${id}-category`}>
            <Select id={`${id}-category`} value={category} onChange={(e) => setCategory(e.target.value)} options={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: c }))} />
          </FormField>
          <Button type="submit" loading={pending} className="md:mb-0">
            Registrar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
