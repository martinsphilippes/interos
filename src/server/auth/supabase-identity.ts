import "server-only";
import { getSupabaseConfig } from "@/lib/supabase";

/** Identidade confirmada pelo Supabase Auth para um access token. */
export interface VerifiedIdentity {
  /** Id do usuário no INTEROS (app_metadata.interos_uid); sem vínculo, o id do Supabase (não existe em `users`). */
  uid: string;
  email?: string;
  /** "email", "azure"… */
  provider?: string;
}

export class IdentityError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "IdentityError";
  }
}

/**
 * Confere o access token no próprio Supabase Auth (GET /auth/v1/user): token expirado, adulterado ou de sessão
 * encerrada é recusado na origem, sem depender de chaves locais.
 */
export async function verifyAccessToken(accessToken: string): Promise<VerifiedIdentity> {
  const { url, publishableKey } = getSupabaseConfig();
  let response: Response;
  try {
    response = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: publishableKey, Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error("[auth] Supabase Auth indisponível", error);
    throw new IdentityError("Serviço de autenticação indisponível. Tente novamente.", 503);
  }
  if (response.status === 401 || response.status === 403) throw new IdentityError("Sessão de login inválida ou expirada. Entre novamente.", 401);
  if (!response.ok) throw new IdentityError("Serviço de autenticação indisponível. Tente novamente.", 503);
  const user = (await response.json()) as { id: string; email?: string; app_metadata?: { provider?: string; interos_uid?: string } };
  return {
    uid: user.app_metadata?.interos_uid || user.id,
    email: user.email,
    provider: user.app_metadata?.provider,
  };
}
