"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Lock } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { AuthCard } from "./auth-card";
import { authErrorMessage, establishSession, readAuthFragment } from "./session-client";

const MIN_LENGTH = 8;
const LINK_INVALID = "Link inválido ou expirado. Peça um novo em “Esqueci minha senha” ou “Ativar minha conta”.";

type LinkState = { status: "lendo" } | { status: "invalido"; message: string } | { status: "ok"; accessToken: string; refreshToken: string };

/**
 * Definição de senha pelo link do e-mail (ativação de conta e "Esqueci minha senha"). O Supabase Auth devolve o
 * token no fragmento da URL; com a senha gravada, a pessoa já entra no INTEROS (sem digitar a senha de novo).
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const [link, setLink] = React.useState<LinkState>({ status: "lendo" });
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const fragment = readAuthFragment();
    // Tira o token da barra de endereço (histórico, compartilhamento de tela).
    window.history.replaceState(null, "", window.location.pathname);
    // Leitura única do fragmento ao montar: o estado depende de window, indisponível na renderização do servidor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fragment.error || !fragment.accessToken || !fragment.refreshToken) setLink({ status: "invalido", message: LINK_INVALID });
    else setLink({ status: "ok", accessToken: fragment.accessToken, refreshToken: fragment.refreshToken });
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading || link.status !== "ok") return;
    if (password.length < MIN_LENGTH) return setError(`A senha deve ter pelo menos ${MIN_LENGTH} caracteres.`);
    if (password !== confirm) return setError("As senhas não conferem.");
    setLoading(true);
    setError(null);
    try {
      const auth = getSupabaseBrowser().auth;
      const { data, error: sessionError } = await auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken });
      if (sessionError || !data.session) {
        setLink({ status: "invalido", message: LINK_INVALID });
        return;
      }
      const { error: updateError } = await auth.updateUser({ password });
      if (updateError) throw updateError;
      await establishSession(data.session.access_token);
      router.replace("/meu-dia");
      router.refresh();
    } catch (err) {
      setError(authErrorMessage(err, "Não foi possível definir a senha. Tente novamente."));
      setLoading(false);
    }
  };

  return (
    <AuthCard title="Definir nova senha" description="Escolha a senha que você vai usar para entrar no INTEROS.">
      {link.status === "invalido" ? (
        <p role="alert" className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger-fg">
          {link.message}
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <FormField label="Nova senha" htmlFor="new-password" hint={`Mínimo de ${MIN_LENGTH} caracteres.`}>
            <Input
              id="new-password"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              leadingIcon={<Lock />}
              className="h-12 rounded-xl text-[15px]"
              disabled={link.status !== "ok"}
              autoFocus
              trailing={
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Ocultar senha" : "Mostrar senha"}
                  className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-foreground"
                >
                  {show ? <EyeOff /> : <Eye />}
                </button>
              }
            />
          </FormField>
          <FormField label="Confirme a senha" htmlFor="confirm-password">
            <Input
              id="confirm-password"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              leadingIcon={<Lock />}
              className="h-12 rounded-xl text-[15px]"
              disabled={link.status !== "ok"}
            />
          </FormField>
          {error ? (
            <p role="alert" className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger-fg">
              {error}
            </p>
          ) : null}
          <Button type="submit" size="lg" loading={loading} disabled={link.status !== "ok"} className="h-12 w-full rounded-xl text-base">
            Salvar e entrar
            {!loading ? <ArrowRight /> : null}
          </Button>
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
