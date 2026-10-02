"use client";

import { discardSupabaseSession } from "@/lib/supabase/client";

/** Erro com mensagem já pronta para o usuário (resposta do /api/auth/session). */
export class SessionError extends Error {}

/**
 * Troca o access token do Supabase Auth pelo cookie de sessão do INTEROS e descarta a sessão local do Supabase.
 * Lança SessionError com a mensagem do servidor quando o login não está vinculado/ativo.
 */
export async function establishSession(accessToken: string, remember = true): Promise<void> {
  const response = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ accessToken, remember }),
  });
  await discardSupabaseSession();
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new SessionError(body.error ?? "Não foi possível entrar. Tente novamente.");
  }
}

/** Tokens do fragmento (#access_token=…) do retorno do Supabase Auth (OAuth ou link de recuperação). */
export function readAuthFragment(): { accessToken?: string; refreshToken?: string; type?: string; error?: string } {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const error = params.get("error_description") ?? query.get("error_description") ?? undefined;
  return {
    accessToken: params.get("access_token") ?? undefined,
    refreshToken: params.get("refresh_token") ?? undefined,
    type: params.get("type") ?? undefined,
    error: error ?? undefined,
  };
}

/** Mensagem amigável para os erros do Supabase Auth (AuthApiError.code / status). */
export function authErrorMessage(error: unknown, fallback = "Não foi possível entrar. Tente novamente."): string {
  if (error instanceof SessionError) return error.message;
  const e = (error ?? {}) as { code?: string; status?: number; name?: string; message?: string };
  switch (e.code) {
    case "invalid_credentials":
      return "E-mail ou senha inválidos.";
    case "user_banned":
      return "Este usuário está desativado. Fale com o administrador.";
    case "email_not_confirmed":
      return "E-mail ainda não confirmado. Fale com o administrador.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
    case "weak_password":
      return "Senha fraca: use pelo menos 8 caracteres, misturando letras e números.";
    case "same_password":
      return "A nova senha precisa ser diferente da atual.";
    case "validation_failed":
      return "Informe um e-mail válido.";
  }
  if (e.name === "AuthRetryableFetchError" || e.status === 0) return "Sem conexão com o servidor de autenticação.";
  if (e.message?.includes("Configuração do Supabase")) return "Configuração do Supabase ausente neste ambiente.";
  return fallback;
}
