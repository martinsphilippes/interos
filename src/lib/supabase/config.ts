/**
 * Leitura e validação da configuração pública do Supabase.
 *
 * As variáveis NEXT_PUBLIC_* são substituídas em tempo de build pelo Next.js, por isso cada uma precisa ser
 * referenciada literalmente (sem acesso dinâmico a process.env). A chave publicável é pública por design: o banco
 * do INTEROS não é exposto pela Data API e só o servidor acessa os dados (ver docs/arquitetura.md).
 */
export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

const rawConfig = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
} as const;

const ENV_NAMES = { url: "NEXT_PUBLIC_SUPABASE_URL", publishableKey: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" } as const;

/** Nomes das variáveis de ambiente obrigatórias que estão vazias. */
export function missingSupabaseEnvVars(): string[] {
  return (Object.keys(ENV_NAMES) as (keyof typeof ENV_NAMES)[]).filter((key) => !rawConfig[key]).map((key) => ENV_NAMES[key]);
}

/** Verdadeiro quando todas as variáveis obrigatórias estão preenchidas. */
export function isSupabaseConfigured(): boolean {
  return missingSupabaseEnvVars().length === 0;
}

/**
 * Retorna a configuração validada ou lança um erro descritivo listando o que falta.
 * Chame apenas onde o Supabase é de fato necessário, para que páginas que não dependem dele continuem funcionando
 * em builds sem as variáveis.
 */
export function getSupabaseConfig(): SupabasePublicConfig {
  const missing = missingSupabaseEnvVars();
  if (missing.length > 0) {
    throw new Error(`Configuração do Supabase incompleta. Defina: ${missing.join(", ")}. Veja .env.example para o modelo.`);
  }
  return { url: rawConfig.url!.replace(/\/+$/, ""), publishableKey: rawConfig.publishableKey! };
}
