"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { getSupabaseConfig } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { AuthCard } from "./auth-card";
import { demoSignInAction } from "@/server/auth/demo-actions";
import { ForgotPasswordDialog } from "./forgot-password-dialog";
import { QuickAccess, type QuickAccessUser } from "./quick-access";
import { authErrorMessage, establishSession, SessionError } from "./session-client";

const MICROSOFT_DISABLED = "O login com Microsoft ainda não foi habilitado pelo administrador.";

/** O provedor Microsoft (azure) está ligado no Supabase Auth? Evita mandar o usuário para uma página de erro JSON. */
async function microsoftEnabled(): Promise<boolean> {
  const { url, publishableKey } = getSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: publishableKey } });
  if (!response.ok) return false;
  const settings = (await response.json()) as { external?: Record<string, boolean> };
  return settings.external?.azure === true;
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
  /** Usuários do acesso rápido (só vem preenchido com NEXT_PUBLIC_DEMO_MODE=true). */
  quickAccessUsers?: QuickAccessUser[];
}

/**
 * Formulário de login. Devolve um fragmento: o card e, em modo demonstração, o acesso rápido, que ocupa as duas
 * colunas da grade da página (lg:col-span-2).
 */
export function LoginForm({ next, quickAccessUsers = [] }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [remember, setRemember] = React.useState(true);
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<"password" | "microsoft" | "quick" | null>(null);
  const [quickId, setQuickId] = React.useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = React.useState(false);

  const finish = () => {
    router.replace(next ?? "/meu-dia");
    router.refresh();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setError(null);
    setLoading("password");
    try {
      const { data, error: authError } = await getSupabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
      if (authError || !data.session) throw authError ?? new Error("sem sessão");
      await establishSession(data.session.access_token, remember);
      finish();
    } catch (err) {
      setError(authErrorMessage(err));
      setLoading(null);
    }
  };

  /** Acesso rápido: o servidor cria a sessão do usuário escolhido (dispensa a senha). */
  const handleQuickAccess = async (user: QuickAccessUser) => {
    if (loading) return;
    setError(null);
    setEmail(user.email);
    setPassword("");
    setLoading("quick");
    setQuickId(user.id);
    try {
      const result = await demoSignInAction({ userId: user.id });
      if (!result.ok) throw new SessionError(result.error);
      finish();
    } catch (err) {
      setError(authErrorMessage(err));
      setLoading(null);
      setQuickId(null);
    }
  };

  /** Microsoft: redireciona para o Supabase Auth (provedor azure); o retorno cai em /login/microsoft. */
  const handleMicrosoft = async () => {
    if (loading) return;
    setError(null);
    setLoading("microsoft");
    try {
      if (!(await microsoftEnabled())) throw new SessionError(MICROSOFT_DISABLED);
      const back = new URL("/login/microsoft", window.location.origin);
      if (next) back.searchParams.set("next", next);
      if (!remember) back.searchParams.set("lembrar", "0");
      const { error: authError } = await getSupabaseBrowser().auth.signInWithOAuth({
        provider: "azure",
        options: { redirectTo: back.toString(), scopes: "email", queryParams: { prompt: "select_account" } },
      });
      if (authError) throw authError;
    } catch (err) {
      setError(authErrorMessage(err));
      setLoading(null);
    }
  };

  return (
    <>
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


      <ForgotPasswordDialog key={forgotOpen ? "aberto" : "fechado"} open={forgotOpen} onOpenChange={setForgotOpen} initialEmail={email} />
    </AuthCard>
    <QuickAccess users={quickAccessUsers} pendingId={quickId} disabled={loading !== null} onSelect={handleQuickAccess} className="lg:col-span-2" />
    </>
  );
}
