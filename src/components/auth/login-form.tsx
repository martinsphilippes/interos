"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { OAuthProvider, signInWithEmailAndPassword, signInWithPopup, signOut, type UserCredential } from "firebase/auth";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { AuthCard } from "./auth-card";
import { ForgotPasswordDialog } from "./forgot-password-dialog";

const DEMO_EMAIL = "hercules@intercert.com.br";
const DEMO_PASSWORD = "interos123";
const MICROSOFT_DISABLED = "O login com Microsoft ainda não foi habilitado pelo administrador.";

/** Erro com mensagem já pronta para o usuário (resposta do /api/auth/session). */
class SessionError extends Error {}

function errorMessage(error: unknown): string {
  if (error instanceof SessionError) return error.message;
  const code = typeof error === "object" && error && "code" in error ? String((error as { code: string }).code) : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/invalid-login-credentials":
      return "E-mail ou senha inválidos.";
    case "auth/user-not-found":
      return "Usuário não encontrado.";
    case "auth/invalid-email":
      return "Informe um e-mail válido.";
    case "auth/user-disabled":
      return "Este usuário está desativado. Fale com o administrador.";
    case "auth/too-many-requests":
      return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
    case "auth/network-request-failed":
      return "Sem conexão com o servidor de autenticação.";
    // Microsoft
    case "auth/operation-not-allowed":
    case "auth/configuration-not-found":
    case "auth/invalid-provider-id":
    case "auth/unauthorized-domain":
    case "auth/admin-restricted-operation":
      return MICROSOFT_DISABLED;
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
    case "auth/user-cancelled":
      return "Login com Microsoft cancelado.";
    case "auth/popup-blocked":
      return "O navegador bloqueou a janela de login. Permita pop-ups para este site e tente novamente.";
    case "auth/account-exists-with-different-credential":
      return "Este e-mail já entra com outro método. Use e-mail e senha ou fale com o administrador.";
    default:
      return error instanceof Error && error.message.includes("Configuração do Firebase")
        ? "Configuração do Firebase ausente neste ambiente."
        : "Não foi possível entrar. Tente novamente.";
  }
}

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="size-[18px]" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

export interface LoginFormProps {
  next?: string;
  /** Mostra a dica de credenciais de demonstração (NEXT_PUBLIC_DEMO_MODE=true). */
  demoMode?: boolean;
}

export function LoginForm({ next, demoMode = false }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [remember, setRemember] = React.useState(true);
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<"password" | "microsoft" | null>(null);
  const [forgotOpen, setForgotOpen] = React.useState(false);

  /** Troca o ID token por cookie de sessão; se o servidor recusar, desfaz o login no Firebase cliente. */
  const startSession = async (credential: UserCredential) => {
    const idToken = await credential.user.getIdToken();
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ idToken, remember }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
      await signOut(getFirebaseAuth()).catch(() => undefined);
      if (response.status === 403 && body.error) throw new SessionError(body.error);
      throw new Error(body.error ?? "Falha ao criar sessão");
    }
    router.replace(next ?? "/meu-dia");
    router.refresh();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setError(null);
    setLoading("password");
    try {
      const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
      await startSession(credential);
    } catch (err) {
      setError(errorMessage(err));
      setLoading(null);
    }
  };

  const handleMicrosoft = async () => {
    if (loading) return;
    setError(null);
    setLoading("microsoft");
    try {
      const provider = new OAuthProvider("microsoft.com");
      provider.setCustomParameters({ prompt: "select_account" });
      const credential = await signInWithPopup(getFirebaseAuth(), provider);
      await startSession(credential);
    } catch (err) {
      setError(errorMessage(err));
      setLoading(null);
    }
  };

  return (
    <AuthCard title="Acesse sua conta" description="Entre com seus dados para continuar">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <FormField label="E-mail" htmlFor="email">
          <Input
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            placeholder="seuemail@intercert.com.br"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            leadingIcon={<Mail />}
            className="h-12 rounded-xl text-[15px]"
          />
        </FormField>
        <FormField label="Senha" htmlFor="password">
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            name="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            leadingIcon={<Lock />}
            className="h-12 rounded-xl text-[15px]"
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-foreground"
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            }
          />
        </FormField>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Checkbox label="Lembrar meu acesso" checked={remember} onCheckedChange={(v) => setRemember(v === true)} className="min-h-[44px] items-center py-0 md:min-h-[44px]" />
          <button type="button" onClick={() => setForgotOpen(true)} className="min-h-[44px] text-sm font-medium text-brand-fg underline-offset-4 hover:underline">
            Esqueci minha senha
          </button>
        </div>

        {error ? (
          <p role="alert" className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger-fg">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" loading={loading === "password"} disabled={loading !== null} className="h-12 w-full rounded-xl text-base">
          Entrar
          {loading !== "password" ? <ArrowRight /> : null}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs text-muted" aria-hidden>
        <span className="h-px flex-1 bg-border-strong" />
        ou continue com
        <span className="h-px flex-1 bg-border-strong" />
      </div>

      <Button variant="outline" size="lg" onClick={handleMicrosoft} loading={loading === "microsoft"} disabled={loading !== null} className="h-12 w-full rounded-xl">
        {loading !== "microsoft" ? <MicrosoftLogo /> : null}
        Entrar com Microsoft
      </Button>

      <div className="mt-6 border-t border-border-strong pt-5 text-center text-sm">
        <p className="text-muted">Primeiro acesso?</p>
        <Link href="/ativar-conta" className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 font-semibold text-brand-fg underline-offset-4 hover:underline">
          Ativar minha conta <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>

      {demoMode ? (
        <div className="mt-4 rounded-lg border border-border-strong bg-surface-muted px-4 py-3 text-xs text-muted">
          <p className="font-medium text-foreground">Ambiente de demonstração</p>
          <p className="mt-0.5">
            {DEMO_EMAIL} / {DEMO_PASSWORD}
          </p>
          <button
            type="button"
            onClick={() => {
              setEmail(DEMO_EMAIL);
              setPassword(DEMO_PASSWORD);
            }}
            className="mt-1.5 font-medium text-brand-fg hover:underline"
          >
            Preencher credenciais de demonstração
          </button>
        </div>
      ) : null}

      <ForgotPasswordDialog key={forgotOpen ? "aberto" : "fechado"} open={forgotOpen} onOpenChange={setForgotOpen} initialEmail={email} />
    </AuthCard>
  );
}
