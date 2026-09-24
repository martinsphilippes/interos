import { isFirebaseConfigured, missingFirebaseEnvVars } from "@/lib/firebase";

type CheckStatus = "ok" | "pending";

type Check = {
  label: string;
  status: CheckStatus;
  detail: string;
};

function buildChecks(): Check[] {
  const firebaseOk = isFirebaseConfigured();
  const missing = missingFirebaseEnvVars();
  return [
    {
      label: "Aplicação Next.js",
      status: "ok",
      detail: "App Router, TypeScript e Tailwind prontos.",
    },
    {
      label: "Deploy na Vercel",
      status: process.env.VERCEL ? "ok" : "pending",
      detail: process.env.VERCEL
        ? `Ambiente ${process.env.VERCEL_ENV ?? "desconhecido"}.`
        : "Executando fora da Vercel.",
    },
    {
      label: "Configuração do Firebase",
      status: firebaseOk ? "ok" : "pending",
      detail: firebaseOk
        ? "Todas as variáveis públicas estão definidas."
        : `Faltam: ${missing.join(", ")}.`,
    },
  ];
}

export default function Home() {
  const checks = buildChecks();

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <section className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">
          Interos
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Ambiente pronto para desenvolvimento
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Esta página substitui o boilerplate e mostra o estado da infraestrutura.
          Remova quando a primeira funcionalidade entrar.
        </p>

        <ul className="mt-8 space-y-4">
          {checks.map((check) => (
            <li key={check.label} className="flex items-start gap-3">
              <span
                aria-hidden
                className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                  check.status === "ok" ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              <div>
                <p className="font-medium">
                  {check.label}
                  <span className="ml-2 text-xs font-normal text-zinc-500">
                    {check.status === "ok" ? "ok" : "pendente"}
                  </span>
                </p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {check.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-8 font-mono text-xs text-zinc-500">
          Health check em <code>/api/health</code>
        </p>
      </section>
    </main>
  );
}
