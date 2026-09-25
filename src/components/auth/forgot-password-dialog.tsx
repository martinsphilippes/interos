"use client";

import * as React from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { CheckCircle2, Mail } from "lucide-react";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

const NEUTRAL_MESSAGE = "Se o e-mail existir, enviaremos o link para redefinir a senha.";

/**
 * Envia o e-mail de definição/redefinição de senha pelo Firebase Auth. A resposta é sempre neutra (não revela
 * se o e-mail existe); só erros de formato ou de rede aparecem ao usuário.
 */
export async function requestPasswordEmail(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const value = email.trim();
  if (!/^\S+@\S+\.\S+$/.test(value)) return { ok: false, error: "Informe um e-mail válido." };
  try {
    await sendPasswordResetEmail(getFirebaseAuth(), value);
    return { ok: true };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String((error as { code: string }).code) : "";
    if (code === "auth/invalid-email") return { ok: false, error: "Informe um e-mail válido." };
    if (code === "auth/network-request-failed") return { ok: false, error: "Sem conexão com o servidor de autenticação." };
    if (code === "auth/too-many-requests") return { ok: false, error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." };
    // user-not-found e demais: resposta neutra.
    return { ok: true };
  }
}

export function ForgotPasswordDialog({ open, onOpenChange, initialEmail }: { open: boolean; onOpenChange: (open: boolean) => void; initialEmail?: string }) {
  const [email, setEmail] = React.useState(initialEmail ?? "");
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const change = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setSent(false);
      setError(null);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    // O diálogo fica num portal, mas o evento sintético sobe pela árvore React: não deixe chegar a outro <form>.
    event.stopPropagation();
    setLoading(true);
    setError(null);
    const result = await requestPasswordEmail(email);
    setLoading(false);
    if (result.ok) setSent(true);
    else setError(result.error);
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent size="sm">
        <form onSubmit={submit} className="flex flex-col" noValidate>
          <DialogHeader>
            <DialogTitle>Esqueci minha senha</DialogTitle>
            <DialogDescription>Informe seu e-mail corporativo para receber o link de redefinição.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3 pb-4">
            {sent ? (
              <p role="status" className="flex items-start gap-2 rounded-lg border border-success/30 bg-success-soft px-3 py-2.5 text-sm text-success-fg">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                {NEUTRAL_MESSAGE}
              </p>
            ) : (
              <FormField label="E-mail" htmlFor="reset-email" error={error ?? undefined}>
                <Input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seuemail@intercert.com.br"
                  leadingIcon={<Mail />}
                  className="h-11"
                  invalid={Boolean(error)}
                  autoFocus
                />
              </FormField>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => change(false)}>
              {sent ? "Fechar" : "Cancelar"}
            </Button>
            {!sent ? (
              <Button type="submit" loading={loading}>
                Enviar link
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
