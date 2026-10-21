"use client";

import * as React from "react";
import { ShieldCheck, UserRound } from "lucide-react";
import { SIGNATURE_AUTH_METHODS, type SignatureAuthMethod } from "@/domain/types";
import { DEFAULT_COMPANY_SIGNER_ROLE, SIGNATURE_AUTH_HINTS, SIGNATURE_AUTH_LABELS, type SignatureSettings } from "@/domain/contract-templates";
import { saveSignatureSettingsAction } from "@/server/finance/signature-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useFinanceAction } from "./use-finance-action";

export interface SignatureSettingsFormProps {
  settings: SignatureSettings & { stored: boolean; fromUser: boolean };
  users: { id: string; name: string; email: string }[];
  canEdit: boolean;
  /** Clicksign conectada (token na Vercel)? */
  providerConnected: boolean;
}

/** Quem assina pela Intercert e como os signatários provam quem são. */
export function SignatureSettingsForm({ settings, users, canEdit, providerConnected }: SignatureSettingsFormProps) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [form, setForm] = React.useState<SignatureSettings>({ companySigner: { ...settings.companySigner }, defaultAuth: settings.defaultAuth });
  const s = form.companySigner;
  const setSigner = (patch: Partial<SignatureSettings["companySigner"]>) => setForm((f) => ({ ...f, companySigner: { ...f.companySigner, ...patch } }));
  const userOptions = [{ value: "", label: "Outra pessoa (digitar nome e e-mail)" }, ...users.map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` }))];
  const chosen = s.userId ? users.find((u) => u.id === s.userId) : undefined;
  const changed = JSON.stringify(form) !== JSON.stringify({ companySigner: settings.companySigner, defaultAuth: settings.defaultAuth });

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="size-4 text-muted" /> Quem assina pela Intercert
          </CardTitle>
          <CardDescription>Entra sozinho em todo contrato novo e ao gerar o documento para assinatura. Pode ser trocado aqui a qualquer momento.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          <Switch checked={s.enabled} disabled={!canEdit} onCheckedChange={(v) => setSigner({ enabled: v })} label="Incluir automaticamente nos contratos" />
          {s.enabled ? (
            <>
              <FormField label="Pessoa" htmlFor={`${id}-u`} hint="Escolhendo um usuário, nome e e-mail acompanham o cadastro dele.">
                <Select
                  id={`${id}-u`}
                  value={s.userId ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => {
                    const u = users.find((x) => x.id === e.target.value);
                    setSigner(u ? { userId: u.id, name: u.name, email: u.email } : { userId: undefined });
                  }}
                  options={userOptions}
                />
              </FormField>
              {!chosen ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Nome" htmlFor={`${id}-n`} required>
                    <Input id={`${id}-n`} value={s.name} disabled={!canEdit} onChange={(e) => setSigner({ name: e.target.value })} />
                  </FormField>
                  <FormField label="E-mail" htmlFor={`${id}-e`} required>
                    <Input id={`${id}-e`} type="email" value={s.email} disabled={!canEdit} onChange={(e) => setSigner({ email: e.target.value })} />
                  </FormField>
                </div>
              ) : null}
              <FormField label="Papel no contrato" htmlFor={`${id}-r`}>
                <Input id={`${id}-r`} value={s.role} placeholder={DEFAULT_COMPANY_SIGNER_ROLE} disabled={!canEdit} onChange={(e) => setSigner({ role: e.target.value })} />
              </FormField>
              {!settings.stored && settings.fromUser ? <p className="text-xs text-muted">Padrão sugerido: {settings.companySigner.name}. Salve para confirmar.</p> : null}
            </>
          ) : (
            <p className="text-sm text-muted">Desligado: o Financeiro adiciona quem assina pela Intercert em cada contrato.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted" /> Como o signatário prova quem é
          </CardTitle>
          <CardDescription>Padrão de todos os contratos; dá para trocar em cada contrato (cartão Assinatura).</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-0" role="radiogroup" aria-label="Autenticação padrão">
          {SIGNATURE_AUTH_METHODS.map((m: SignatureAuthMethod) => (
            <label
              key={m}
              className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors", form.defaultAuth === m ? "border-brand bg-brand-soft" : "border-border hover:bg-surface-muted", !canEdit && "cursor-default opacity-80")}
            >
              <input type="radio" name={`${id}-auth`} className="mt-1" checked={form.defaultAuth === m} disabled={!canEdit} onChange={() => setForm((f) => ({ ...f, defaultAuth: m }))} />
              <span>
                <span className="flex items-center gap-2 font-medium">
                  {SIGNATURE_AUTH_LABELS[m]}
                  {m === "email" ? (
                    <Badge variant="success" size="sm">
                      Recomendado
                    </Badge>
                  ) : null}
                </span>
                <span className="block text-xs text-muted">{SIGNATURE_AUTH_HINTS[m]}</span>
              </span>
            </label>
          ))}
          <p className="pt-1 text-xs text-muted">
            {providerConnected ? "A Clicksign pede a autenticação escolhida na hora de assinar." : "Vale quando a Clicksign estiver conectada. Até lá, o envio é manual e a assinatura é registrada com evidência."}
          </p>
        </CardContent>
      </Card>

      {canEdit ? (
        <div className="flex justify-end gap-2 lg:col-span-2">
          <Button variant="outline" disabled={pending || !changed} onClick={() => setForm({ companySigner: { ...settings.companySigner }, defaultAuth: settings.defaultAuth })}>
            Desfazer
          </Button>
          <Button loading={pending} disabled={!changed && settings.stored} onClick={() => void run(() => saveSignatureSettingsAction(form), "Configuração da assinatura salva")}>
            Salvar configuração
          </Button>
        </div>
      ) : null}
    </div>
  );
}
