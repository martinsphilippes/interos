"use client";

import * as React from "react";
import type { Lead } from "@/domain/types";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { MarketingOptions } from "./marketing-model";

export interface LeadFormState {
  name: string;
  company: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  origin: string;
  campaignId: string;
  interest: string;
  productInterestIds: string[];
  ownerId: string;
  consent: boolean;
  notes: string;
}

export function emptyLeadForm(ownerId = ""): LeadFormState {
  return { name: "", company: "", phone: "", email: "", city: "", state: "CE", origin: "manual", campaignId: "", interest: "", productInterestIds: [], ownerId, consent: false, notes: "" };
}

export function leadToForm(lead: Lead): LeadFormState {
  return {
    name: lead.name,
    company: lead.company ?? "",
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    city: lead.city ?? "",
    state: lead.state ?? "",
    origin: lead.origin,
    campaignId: lead.campaignId ?? "",
    interest: lead.interest ?? "",
    productInterestIds: lead.productInterestIds ?? [],
    ownerId: lead.ownerId ?? "",
    consent: lead.consent,
    notes: lead.notes ?? "",
  };
}

export interface LeadFormFieldsProps {
  value: LeadFormState;
  onChange: (patch: Partial<LeadFormState>) => void;
  options: MarketingOptions;
  /** Oculta responsável e consentimento (editados em blocos próprios no drawer). */
  compact?: boolean;
  idPrefix?: string;
}

/** Campos do lead, compartilhados entre "Novo lead" e a edição no drawer. */
export function LeadFormFields({ value, onChange, options, compact, idPrefix = "lead" }: LeadFormFieldsProps) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const toggleProduct = (productId: string, checked: boolean) =>
    onChange({ productInterestIds: checked ? [...value.productInterestIds, productId] : value.productInterestIds.filter((p) => p !== productId) });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label="Nome do contato" htmlFor={id("name")} required>
        <Input id={id("name")} value={value.name} onChange={(e) => onChange({ name: e.target.value })} required autoComplete="off" />
      </FormField>
      <FormField label="Empresa" htmlFor={id("company")}>
        <Input id={id("company")} value={value.company} onChange={(e) => onChange({ company: e.target.value })} autoComplete="off" />
      </FormField>
      <FormField label="Telefone / WhatsApp" htmlFor={id("phone")} hint="Com DDD. Telefone ou e-mail é obrigatório.">
        <Input id={id("phone")} type="tel" inputMode="tel" value={value.phone} onChange={(e) => onChange({ phone: e.target.value })} placeholder="(88) 99999-0000" />
      </FormField>
      <FormField label="E-mail" htmlFor={id("email")}>
        <Input id={id("email")} type="email" inputMode="email" value={value.email} onChange={(e) => onChange({ email: e.target.value })} />
      </FormField>
      <div className="grid grid-cols-[1fr_80px] gap-3">
        <FormField label="Cidade" htmlFor={id("city")}>
          <Input id={id("city")} value={value.city} onChange={(e) => onChange({ city: e.target.value })} />
        </FormField>
        <FormField label="UF" htmlFor={id("state")}>
          <Input id={id("state")} value={value.state} maxLength={2} onChange={(e) => onChange({ state: e.target.value.toUpperCase() })} />
        </FormField>
      </div>
      <FormField label="Origem" htmlFor={id("origin")} required>
        <Select id={id("origin")} value={value.origin} onChange={(e) => onChange({ origin: e.target.value })} required>
          {options.sources.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
          {!options.sources.some((s) => s.key === value.origin) && value.origin ? <option value={value.origin}>{value.origin}</option> : null}
        </Select>
      </FormField>
      <FormField label="Campanha" htmlFor={id("campaign")}>
        <Select id={id("campaign")} value={value.campaignId} onChange={(e) => onChange({ campaignId: e.target.value })}>
          <option value="">Sem campanha</option>
          {options.campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.status === "encerrada" ? " (encerrada)" : ""}
            </option>
          ))}
        </Select>
      </FormField>
      {!compact ? (
        <FormField label="Responsável (Marketing)" htmlFor={id("owner")}>
          <Select id={id("owner")} value={value.ownerId} onChange={(e) => onChange({ ownerId: e.target.value })}>
            <option value="">Sem responsável</option>
            {options.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
      <FormField label="Interesse" htmlFor={id("interest")} className="sm:col-span-2" hint="O que o lead procura, com as palavras dele.">
        <Input id={id("interest")} value={value.interest} onChange={(e) => onChange({ interest: e.target.value })} placeholder="Ex.: ERP com PDV e TEF para supermercado" />
      </FormField>
      <fieldset className="sm:col-span-2">
        <legend className="mb-2 text-[13px] font-medium">Produtos de interesse</legend>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 md:grid-cols-3">
          {options.products.map((p) => (
            <Checkbox key={p.id} label={p.name} checked={value.productInterestIds.includes(p.id)} onCheckedChange={(checked) => toggleProduct(p.id, checked === true)} className="py-1.5 md:py-1" />
          ))}
        </div>
      </fieldset>
      <FormField label="Observações" htmlFor={id("notes")} className="sm:col-span-2">
        <Textarea id={id("notes")} value={value.notes} onChange={(e) => onChange({ notes: e.target.value })} className="min-h-[64px]" />
      </FormField>
      {!compact ? (
        <div className="sm:col-span-2">
          <Switch label="Consentimento LGPD obtido" description="O contato autorizou o uso dos dados para contato comercial." checked={value.consent} onCheckedChange={(consent) => onChange({ consent })} />
        </div>
      ) : null}
    </div>
  );
}

/** Converte o formulário no payload das actions (vazio → undefined). */
export function leadFormPayload(value: LeadFormState) {
  const opt = (v: string) => (v.trim() ? v.trim() : undefined);
  return {
    name: value.name.trim(),
    company: opt(value.company),
    phone: opt(value.phone),
    email: opt(value.email),
    city: opt(value.city),
    state: opt(value.state),
    origin: value.origin,
    campaignId: opt(value.campaignId),
    interest: opt(value.interest),
    productInterestIds: value.productInterestIds,
    ownerId: opt(value.ownerId),
    consent: value.consent,
    notes: opt(value.notes),
  };
}
