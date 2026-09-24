import { InterosLogo } from "@/components/layout/sidebar";

/** Layout de autenticação: painel navy à esquerda (desktop) e formulário à direita. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col lg:flex-row">
      {/* Painel da marca (desktop) */}
      <aside className="relative hidden overflow-hidden bg-navy-900 text-white lg:flex lg:w-[46%] lg:max-w-[640px] lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='64' viewBox='0 0 56 64'%3E%3Cpolygon points='28,2 54,17 54,47 28,62 2,47 2,17' fill='none' stroke='%23ffffff' stroke-width='1.5'/%3E%3C/svg%3E\")",
            backgroundSize: "56px 64px",
          }}
        />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-40 size-[520px] rounded-full bg-brand/20 blur-3xl" />
        <InterosLogo className="relative" />
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Processos, pessoas e resultados em um só lugar.</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-navy-200">
            O sistema operacional da Intercert conecta Marketing, Vendas, Financeiro, Implantação, CS e Suporte em uma linha do tempo única por cliente.
          </p>
        </div>
        <p className="relative text-xs text-navy-200/70">© {new Date().getFullYear()} Intercert · INTEROS</p>
      </aside>

      {/* Formulário */}
      <main className="flex flex-1 flex-col bg-canvas">
        <div className="flex items-center justify-center bg-navy-900 py-5 lg:hidden">
          <InterosLogo />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
      </main>
    </div>
  );
}
