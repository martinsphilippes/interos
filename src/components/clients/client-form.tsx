"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Save } from "lucide-react";
import type { Client } from "@/domain/types";
import type { ClientFormOptions } from "@/server/clients/queries";
import { createClient, findDuplicates, updateClient, type DuplicateMatch } from "@/server/clients/actions";
import { BR_STATES, SEGMENT_OPTIONS, createClientSchema, updateClientSchema, zodFieldErrors, zodMessage } from "@/server/clients/schemas";
import { formatDocument, formatPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { ClientStatusBadge } from "./client-badges";

/** Valores do formulário: sempre strings (o zod converte e limpa no envio). */
export interface ClientFormValues {
  legalName: string;
  tradeName: string;
  document: string;
  segment: string;
  origin: string;
  campaignId: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  zip: string;
  ownerSalesId: string;
  ownerCsId: string;
  tags: string;
  notes: string;
  status: "prospect" | "lead";
}

export const EMPTY_CLIENT_FORM: ClientFormValues = {
  legalName: "",
  tradeName: "",
  document: "",
  segment: "",
  origin: "",
  campaignId: "",
  phone: "",
  whatsapp: "",
  email: "",
  website: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "",
  zip: "",
  ownerSalesId: "",
  ownerCsId: "",
  tags: "",
  notes: "",
  status: "prospect",
};

export function clientToFormValues(client: Client): ClientFormValues {
  return {
    ...EMPTY_CLIENT_FORM,
    legalName: client.legalName,
    tradeName: client.tradeName,
    document: formatDocument(client.document) === "—" ? "" : formatDocument(client.document),
    segment: client.segment ?? "",
    origin: client.origin ?? "",
    campaignId: client.campaignId ?? "",
    phone: client.phone ? formatPhone(client.phone) : "",
    whatsapp: client.whatsapp ? formatPhone(client.whatsapp) : "",
    email: client.email ?? "",
    website: client.website ?? "",
    street: client.address?.street ?? "",
    number: client.address?.number ?? "",
    complement: client.address?.complement ?? "",
    district: client.address?.district ?? "",
    city: client.address?.city ?? "",
    state: client.address?.state ?? "",
    zip: client.address?.zip ?? "",
    ownerSalesId: client.ownerSalesId ?? "",
    ownerCsId: client.ownerCsId ?? "",
    tags: client.tags?.join(", ") ?? "",
    notes: client.notes ?? "",
    status: client.status === "lead" ? "lead" : "prospect",
  };
}

function toPayload(v: ClientFormValues) {
  return {
    legalName: v.legalName,
    tradeName: v.tradeName,
    document: v.document,
    segment: v.segment,
    origin: v.origin,
    campaignId: v.campaignId,
    phone: v.phone,
    whatsapp: v.whatsapp,
    email: v.email,
    website: v.website,
    address: { street: v.street, number: v.number, complement: v.complement, district: v.district, city: v.city, state: v.state, zip: v.zip },
    ownerSalesId: v.ownerSalesId,
    ownerCsId: v.ownerCsId,
    tags: v.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    notes: v.notes,
  };
}

interface SectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

/* Seções definidas fora do formulário: um componente criado dentro do render remontaria os inputs a cada tecla. */
function PageSection({ title, description, children }: SectionProps) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-card">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function DrawerSection({ title, description, children }: SectionProps) {
  return (
    <section className="border-b border-border pb-5 last:border-0">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export interface ClientFormProps {
  mode: "create" | "edit";
  clientId?: string;
  initial?: Partial<ClientFormValues>;
  options: ClientFormOptions;
  /** Chamado após salvar com sucesso (recebe o id do cliente). */
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
  /** "page" usa cards com seções; "drawer" é mais compacto. */
  layout?: "page" | "drawer";
  className?: string;
}

/** Formulário completo de cliente (cadastro e edição) com validação zod e aviso de duplicidade. */
export function ClientForm({ mode, clientId, initial, options, onSuccess, onCancel, layout = "page", className }: ClientFormProps) {
  const router = useRouter();
  const [values, setValues] = React.useState<ClientFormValues>({ ...EMPTY_CLIENT_FORM, ...initial });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = React.useState<DuplicateMatch[] | null>(null);
  const [pending, startTransition] = React.useTransition();
  const baseId = React.useId();
  const fid = (name: string) => `${baseId}-${name}`;

  const set = (name: keyof ClientFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    setValues((v) => ({ ...v, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
    // Mudou um campo de identidade: a checagem de duplicidade precisa ser refeita.
    if (["document", "phone", "whatsapp", "email"].includes(name)) setDuplicates(null);
  };
  const formatOnBlur = (name: "document" | "phone" | "whatsapp") => () => {
    setValues((v) => {
      const raw = v[name];
      if (!raw) return v;
      const formatted = name === "document" ? formatDocument(raw) : formatPhone(raw);
      return { ...v, [name]: formatted === "—" ? raw : formatted };
    });
  };

  const submit = (ignoreDuplicates: boolean) => {
    const payload = mode === "create" ? { ...toPayload(values), status: values.status } : { ...toPayload(values), id: clientId ?? "" };
    const parsed = mode === "create" ? createClientSchema.safeParse(payload) : updateClientSchema.safeParse(payload);
    if (!parsed.success) {
      const fieldErrors = zodFieldErrors(parsed.error);
      // Chaves aninhadas de endereço ("address.city") viram o nome do campo no formulário.
      const mapped: Record<string, string> = {};
      for (const [key, message] of Object.entries(fieldErrors)) mapped[key.replace(/^address\./, "")] = message;
      setErrors(mapped);
      toast.error(zodMessage(parsed.error));
      return;
    }

    startTransition(async () => {
      if (!ignoreDuplicates) {
        const check = await findDuplicates({ document: values.document, phone: values.phone, whatsapp: values.whatsapp, email: values.email, excludeId: clientId });
        if (check.ok && check.data.matches.length > 0) {
          setDuplicates(check.data.matches);
          toast.warning("Encontramos clientes parecidos. Confira antes de salvar.");
          return;
        }
      }
      const result = mode === "create" ? await createClient(payload) : await updateClient(payload);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const id = result.data.id;
      toast.success(mode === "create" ? "Cliente cadastrado" : "Cliente atualizado");
      if (mode === "create") router.push(`/clientes/${id}`);
      else router.refresh();
      onSuccess?.(id);
    });
  };

  const isPage = layout === "page";
  const Section = isPage ? PageSection : DrawerSection;

  return (
    <form
      className={cn("flex flex-col gap-4", className)}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <Section title="Identificação" description="Como a empresa aparece no INTEROS e nos documentos.">
        <FormField label="Nome fantasia" htmlFor={fid("tradeName")} required error={errors.tradeName}>
          <Input id={fid("tradeName")} value={values.tradeName} onChange={set("tradeName")} invalid={Boolean(errors.tradeName)} autoFocus={mode === "create"} placeholder="Ex.: Supermercado Bom Jesus" />
        </FormField>
        <FormField label="Razão social" htmlFor={fid("legalName")} required error={errors.legalName}>
          <Input id={fid("legalName")} value={values.legalName} onChange={set("legalName")} invalid={Boolean(errors.legalName)} placeholder="Ex.: Bom Jesus Comércio de Alimentos LTDA" />
        </FormField>
        <FormField label="CNPJ ou CPF" htmlFor={fid("document")} error={errors.document} hint="Usado para checar duplicidade e emitir contrato.">
          <Input id={fid("document")} value={values.document} onChange={set("document")} onBlur={formatOnBlur("document")} invalid={Boolean(errors.document)} inputMode="numeric" placeholder="00.000.000/0000-00" />
        </FormField>
        <FormField label="Segmento" htmlFor={fid("segment")} error={errors.segment}>
          <Select id={fid("segment")} value={values.segment} onChange={set("segment")} placeholder="Selecione…" options={SEGMENT_OPTIONS} />
        </FormField>
        {mode === "create" ? (
          <FormField label="Status inicial" htmlFor={fid("status")} error={errors.status} hint="Lead entra na etapa de Marketing; prospect vai direto para Vendas.">
            <Select id={fid("status")} value={values.status} onChange={set("status")} options={[{ value: "prospect", label: "Prospect (já qualificado)" }, { value: "lead", label: "Lead (a qualificar)" }]} />
          </FormField>
        ) : null}
      </Section>

      <Section title="Contato">
        <FormField label="Telefone" htmlFor={fid("phone")} error={errors.phone}>
          <Input id={fid("phone")} type="tel" value={values.phone} onChange={set("phone")} onBlur={formatOnBlur("phone")} invalid={Boolean(errors.phone)} placeholder="(88) 3000-0000" />
        </FormField>
        <FormField label="WhatsApp" htmlFor={fid("whatsapp")} error={errors.whatsapp}>
          <Input id={fid("whatsapp")} type="tel" value={values.whatsapp} onChange={set("whatsapp")} onBlur={formatOnBlur("whatsapp")} invalid={Boolean(errors.whatsapp)} placeholder="(88) 90000-0000" />
        </FormField>
        <FormField label="E-mail" htmlFor={fid("email")} error={errors.email}>
          <Input id={fid("email")} type="email" value={values.email} onChange={set("email")} invalid={Boolean(errors.email)} placeholder="contato@empresa.com.br" />
        </FormField>
        <FormField label="Site" htmlFor={fid("website")} error={errors.website}>
          <Input id={fid("website")} type="url" value={values.website} onChange={set("website")} invalid={Boolean(errors.website)} placeholder="https://www.empresa.com.br" />
        </FormField>
      </Section>

      <Section title="Endereço">
        <FormField label="CEP" htmlFor={fid("zip")} error={errors.zip}>
          <Input id={fid("zip")} value={values.zip} onChange={set("zip")} invalid={Boolean(errors.zip)} inputMode="numeric" placeholder="63000-000" />
        </FormField>
        <FormField label="Logradouro" htmlFor={fid("street")} error={errors.street}>
          <Input id={fid("street")} value={values.street} onChange={set("street")} placeholder="Rua, avenida…" />
        </FormField>
        <FormField label="Número" htmlFor={fid("number")} error={errors.number}>
          <Input id={fid("number")} value={values.number} onChange={set("number")} />
        </FormField>
        <FormField label="Complemento" htmlFor={fid("complement")} error={errors.complement}>
          <Input id={fid("complement")} value={values.complement} onChange={set("complement")} placeholder="Sala, loja, galpão…" />
        </FormField>
        <FormField label="Bairro" htmlFor={fid("district")} error={errors.district}>
          <Input id={fid("district")} value={values.district} onChange={set("district")} />
        </FormField>
        <div className="grid grid-cols-[1fr_96px] gap-4">
          <FormField label="Cidade" htmlFor={fid("city")} error={errors.city}>
            <Input id={fid("city")} value={values.city} onChange={set("city")} invalid={Boolean(errors.city)} />
          </FormField>
          <FormField label="UF" htmlFor={fid("state")} error={errors.state}>
            <Select id={fid("state")} value={values.state} onChange={set("state")} invalid={Boolean(errors.state)} placeholder="UF" options={BR_STATES.map((uf) => ({ value: uf, label: uf }))} />
          </FormField>
        </div>
      </Section>

      <Section title="Comercial" description="Origem do relacionamento e responsáveis.">
        <FormField label="Origem" htmlFor={fid("origin")} error={errors.origin}>
          <Select id={fid("origin")} value={values.origin} onChange={set("origin")} placeholder="Selecione…" options={options.leadSources.map((s) => ({ value: s.key, label: s.name }))} />
        </FormField>
        <FormField label="Campanha" htmlFor={fid("campaignId")} error={errors.campaignId}>
          <Select id={fid("campaignId")} value={values.campaignId} onChange={set("campaignId")} placeholder="Nenhuma" options={options.campaigns.map((c) => ({ value: c.id, label: c.name }))} />
        </FormField>
        <FormField label="Responsável comercial" htmlFor={fid("ownerSalesId")} error={errors.ownerSalesId}>
          <Select id={fid("ownerSalesId")} value={values.ownerSalesId} onChange={set("ownerSalesId")} placeholder="Selecione…" options={options.sellers.map((u) => ({ value: u.id, label: u.name }))} />
        </FormField>
        <FormField label="Responsável de CS" htmlFor={fid("ownerCsId")} error={errors.ownerCsId} hint="Normalmente definido na ativação.">
          <Select id={fid("ownerCsId")} value={values.ownerCsId} onChange={set("ownerCsId")} placeholder="Nenhum" options={options.csOwners.map((u) => ({ value: u.id, label: u.name }))} />
        </FormField>
      </Section>

      <Section title="Outros">
        <FormField label="Tags" htmlFor={fid("tags")} error={errors.tags} hint="Separe por vírgula. Ex.: supermercado, pacote, indicacao">
          <Input id={fid("tags")} value={values.tags} onChange={set("tags")} />
        </FormField>
        <FormField label="Observações" htmlFor={fid("notes")} error={errors.notes} className="sm:col-span-2">
          <Textarea id={fid("notes")} value={values.notes} onChange={set("notes")} placeholder="Preferências de contato, particularidades da operação…" />
        </FormField>
      </Section>

      {duplicates && duplicates.length > 0 ? (
        <div role="alert" className="rounded-lg border border-warning/40 bg-warning-soft p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning-fg" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-warning-fg">Possível duplicidade</p>
              <p className="mt-0.5 text-sm text-foreground">
                {duplicates.length === 1 ? "Já existe um cliente" : `Já existem ${duplicates.length} clientes`} com os mesmos dados de identificação. Abra o cadastro existente ou confirme para salvar mesmo assim.
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {duplicates.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-md bg-surface px-3 py-2 text-sm">
                    <Link href={`/clientes/${d.id}`} className="font-medium text-secondary hover:underline" target="_blank" rel="noreferrer">
                      {d.tradeName}
                    </Link>
                    <ClientStatusBadge status={d.status} />
                    <span className="text-xs text-muted">{d.reasons.join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", isPage && "sticky bottom-[calc(var(--spacing-mobile-nav)+8px)] rounded-lg border border-border bg-surface/95 p-3 shadow-card backdrop-blur md:static md:border-0 md:bg-transparent md:p-0 md:shadow-none")}>
        {onCancel ? (
          <Button type="button" variant="outline" size="lg" onClick={onCancel} disabled={pending}>
            Cancelar
          </Button>
        ) : mode === "create" ? (
          <Button asChild type="button" variant="outline" size="lg">
            <Link href="/clientes">Cancelar</Link>
          </Button>
        ) : null}
        {duplicates && duplicates.length > 0 ? (
          <Button type="button" variant="secondary" size="lg" loading={pending} onClick={() => submit(true)}>
            {mode === "create" ? "Cadastrar mesmo assim" : "Salvar mesmo assim"}
          </Button>
        ) : (
          <Button type="submit" size="lg" loading={pending}>
            <Save /> {mode === "create" ? "Cadastrar cliente" : "Salvar alterações"}
          </Button>
        )}
      </div>
    </form>
  );
}
