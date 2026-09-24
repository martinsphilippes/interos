import Link from "next/link";
import { ShieldCheck } from "lucide-react";

/**
 * Layout das telas públicas de acesso (login, ativar conta, privacidade, termos): fundo escuro com brilhos
 * laranja/azul e grade de pontos, selo "Ambiente seguro" no canto e rodapé com os links legais.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-1 flex-col overflow-hidden bg-canvas">
      {/* Fundo */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-dot-grid opacity-40 [mask-image:radial-gradient(ellipse_at_30%_40%,black,transparent_70%)]" />
        <div className="absolute -left-40 top-1/3 size-[560px] rounded-full bg-info/15 blur-[120px]" />
        <div className="absolute -bottom-48 left-1/3 size-[520px] rounded-full bg-brand/15 blur-[120px]" />
        <div className="absolute -right-32 -top-32 size-[420px] rounded-full bg-info/10 blur-[110px]" />
      </div>

      <header className="relative z-10 flex justify-end px-4 pt-4 sm:px-6 sm:pt-5">
        <span className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface/70 px-3.5 py-1.5 text-xs font-medium text-foreground backdrop-blur">
          <ShieldCheck className="size-4 text-info-fg" aria-hidden />
          Ambiente seguro
          <span className="size-2 rounded-full bg-success" aria-hidden />
        </span>
      </header>

      <div className="relative z-10 flex flex-1 flex-col">{children}</div>

      <footer className="relative z-10 flex flex-col items-center gap-1 px-4 pb-6 pt-4 text-xs text-muted">
        <nav aria-label="Links legais" className="flex items-center gap-3">
          <Link href="/privacidade" className="transition-colors hover:text-foreground">
            Privacidade
          </Link>
          <span aria-hidden className="text-muted-light">
            |
          </span>
          <Link href="/termos" className="transition-colors hover:text-foreground">
            Termos de uso
          </Link>
        </nav>
        <p>© 2026 Intercert. Todos os direitos reservados.</p>
      </footer>
    </div>
  );
}
