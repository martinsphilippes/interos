"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import { addDocument } from "@/server/clients/actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { CLIENT_DOCUMENT_CATEGORIES } from "@/domain/client-documents";

export interface DocumentLinkFormProps {
  clientId: string;
  className?: string;
}

/** Registra um documento por link (Drive, assinatura digital, ERP): o arquivo continua onde está. */
export function DocumentLinkForm({ clientId, className }: DocumentLinkFormProps) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [category, setCategory] = React.useState<string>("Contrato");
  const [pending, startTransition] = React.useTransition();
  const id = React.useId();

  const submit = () => {
    startTransition(async () => {
      const result = await addDocument({ clientId, name, url, category });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Link registrado");
      setName("");
      setUrl("");
      router.refresh();
    });
  };

  return (
    <form
      className={className ?? "grid gap-3 md:grid-cols-[1fr_1fr_200px_auto] md:items-end"}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <FormField label="Nome" htmlFor={`${id}-name`} required>
        <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={160} placeholder="Ex.: Contrato assinado CT-2026-0001" />
      </FormField>
      <FormField label="Link" htmlFor={`${id}-url`} required>
        <Input id={`${id}-url`} type="url" value={url} onChange={(e) => setUrl(e.target.value)} required leadingIcon={<Link2 />} placeholder="https://…" />
      </FormField>
      <FormField label="Categoria" htmlFor={`${id}-category`}>
        <Select id={`${id}-category`} value={category} onChange={(e) => setCategory(e.target.value)} options={CLIENT_DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: c }))} />
      </FormField>
      <Button type="submit" loading={pending} className="md:mb-0">
        Registrar link
      </Button>
    </form>
  );
}
