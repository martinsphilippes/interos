import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AuthBrand } from "./auth-hero";

/** Página legal simples (privacidade, termos) no tema das telas de acesso. */
export function LegalPage({ title, updatedAt, children }: { title: string; updatedAt: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
      <div className="mb-8 flex justify-center">
        <AuthBrand />
      </div>
      <article className="rounded-2xl border border-border-strong bg-surface/80 p-6 shadow-pop backdrop-blur-xl sm:p-10">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">{title}</h1>
        <p className="mt-1 text-sm text-muted">Atualizado em {updatedAt}</p>
        <div className="mt-6 flex flex-col gap-4 text-[15px] leading-relaxed text-foreground/90 [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground">{children}</div>
        <div className="mt-8 border-t border-border-strong pt-4">
          <Link href="/login" className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-brand-fg underline-offset-4 hover:underline">
            <ArrowLeft className="size-4" aria-hidden /> Voltar para o login
          </Link>
        </div>
      </article>
    </div>
  );
}
