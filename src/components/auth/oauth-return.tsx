"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { AuthCard } from "./auth-card";
import { authErrorMessage, establishSession, readAuthFragment } from "./session-client";

/** Só caminhos internos (mesma regra do safeNext do login). */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || raw.startsWith("/login")) return "/meu-dia";
  return raw;
}

/** Retorno do login com Microsoft: troca o token do Supabase Auth pelo cookie do INTEROS e segue para o sistema. */
export function OAuthReturn() {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    const fragment = readAuthFragment();
    const query = new URLSearchParams(window.location.search);
    window.history.replaceState(null, "", window.location.pathname);
    if (!fragment.accessToken) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(fragment.error ? "Login com Microsoft cancelado ou recusado." : "Retorno do login inválido. Tente novamente.");
      return;
    }
    establishSession(fragment.accessToken, query.get("lembrar") !== "0")
      .then(() => {
        router.replace(safeNext(query.get("next")));
        router.refresh();
      })
      .catch((err: unknown) => setError(authErrorMessage(err)));
  }, [router]);

  return (
    <AuthCard title="Entrar com Microsoft" description={error ? "Não foi possível concluir o login." : "Concluindo o login…"}>
      {error ? (
        <p role="alert" className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2 text-sm text-danger-fg">
          {error}
        </p>
      ) : (
        <div className="flex justify-center py-6" aria-live="polite">
          <Spinner />
        </div>
      )}
      <div className="mt-6 border-t border-border-strong pt-4 text-center">
        <Link href="/login" className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-brand-fg underline-offset-4 hover:underline">
          <ArrowLeft className="size-4" aria-hidden /> Voltar para o login
        </Link>
      </div>
    </AuthCard>
  );
}
