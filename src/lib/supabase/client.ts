"use client";

/**
 * Cliente do Supabase Auth para o navegador.
 *
 * - Só autenticação: confere senha, envia o e-mail de redefinição e faz o OAuth (Microsoft). Dados nunca são lidos
 *   daqui — o banco não é exposto pela Data API; tudo passa pelo servidor do Next.
 * - Depois que o Supabase confirma a identidade, o access token é trocado por um cookie httpOnly do INTEROS
 *   (/api/auth/session) e a sessão local do Supabase é descartada.
 * - Singleton e lazy: nada é criado até a primeira chamada.
 * - Fluxo implicit: o link de redefinição de senha e o retorno do OAuth trazem o token no fragmento (#) da URL, então
 *   funcionam mesmo abertos em outro aparelho (com PKCE o link só valeria no navegador que o pediu).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";

let cached: SupabaseClient | undefined;

export function getSupabaseBrowser(): SupabaseClient {
  if (cached) return cached;
  const { url, publishableKey } = getSupabaseConfig();
  cached = createClient(url, publishableKey, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return cached;
}

/** Descarta a sessão do Supabase guardada no navegador (o INTEROS usa o próprio cookie). */
export async function discardSupabaseSession(): Promise<void> {
  try {
    await getSupabaseBrowser().auth.signOut({ scope: "local" });
  } catch {
    // Sem configuração ou já sem sessão: nada a fazer.
  }
}
