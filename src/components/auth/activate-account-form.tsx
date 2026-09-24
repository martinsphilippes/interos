"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { AuthCard } from "./auth-card";
import { requestPasswordEmail } from "./forgot-password-dialog";

/** Primeiro acesso: envia o link de definição de senha para o e-mail corporativo (resposta neutra). */
export function ActivateAccountForm() {
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    const result = await requestPasswordEmail(email);
    setLoading(false);
    if (result.ok) setSent(true);
    else setError(result.error);
  };

  return (
    <AuthCard title="Ativar minha conta" description="Informe seu e-mail corporativo para receber o link de definição de senha.">
      {sent ? (
        <div className="flex flex-col gap-4">
          <p role="status" className="flex items-start gap-2 rounded-lg border border-success/30 bg-success-soft px-3 py-3 text-sm text-success-fg">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            Se o e-mail estiver cadastrado no INTEROS, enviaremos o link para você definir sua senha. Confira também a caixa de spam.
          </p>
          <Button variant="outline" size="lg" onClick={() => setSent(false)} className="h-12 w-full rounded-xl">
            Enviar para outro e-mail
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <FormField label="E-mail corporativo" htmlFor="activate-email" error={error ?? undefined}>
            <Input
              id="activate-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="seuemail@intercert.com.br"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              leadingIcon={<Mail />}
              invalid={Boolean(error)}
              className="h-12 rounded-xl text-[15px]"
              autoFocus
            />
          </FormField>
          <Button type="submit" size="lg" loading={loading} className="h-12 w-full rounded-xl text-base">
            {!loading ? <Send /> : null}
            Enviar link de ativação
          </Button>
          <p className="text-center text-xs text-muted">O acesso é liberado pelo administrador. Se não receber o e-mail, fale com ele.</p>
        </form>
      )}
      <div className="mt-6 border-t border-border-strong pt-4 text-center">
        <Link href="/login" className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-brand-fg underline-offset-4 hover:underline">
          <ArrowLeft className="size-4" aria-hidden /> Voltar para o login
        </Link>
      </div>
    </AuthCard>
  );
}
