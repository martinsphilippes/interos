/**
 * Erros de autorização e o tratamento único de falhas de Server Actions (A5).
 */
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

/** Mensagem padrão de acesso negado (sem revelar o que existe do outro lado). */
export const ACCESS_DENIED_MESSAGE = "Acesso negado: seu perfil não tem permissão para esta operação.";

/** Negação de permissão em Server Action (requirePermission). A mensagem é segura para o usuário. */
export class PermissionError extends Error {
  readonly key?: string;
  constructor(message: string = ACCESS_DENIED_MESSAGE, key?: string) {
    super(message);
    this.name = "PermissionError";
    this.key = key;
  }
}

/** Sem sessão válida numa Server Action ou API. */
export class AuthenticationError extends Error {
  constructor(message = "Sua sessão expirou. Entre novamente.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/** Mensagens técnicas que nunca chegam ao usuário (ficam no log). */
const TECHNICAL = /firestore|firebase|ECONN|deadline|permission denied|undefined|null|NEXT_/i;

function zodText(error: z.ZodError): string {
  return error.issues.map((i) => i.message).join(" · ") || "Dados inválidos";
}

/**
 * Converte um erro de Server Action no formato ActionResult `{ ok: false, error }`.
 * - Erros internos do Next (redirect, notFound…) são relançados com `unstable_rethrow` (chamado no topo do catch).
 * - ZodError → mensagens de validação; PermissionError/AuthenticationError → a própria mensagem.
 * - Erros de regra de negócio em português passam; erros técnicos viram `fallback` e vão para o log.
 */
export function failAction(error: unknown, fallback: string, tag = "action"): { ok: false; error: string } {
  unstable_rethrow(error);
  if (error instanceof z.ZodError) return { ok: false, error: zodText(error) };
  if (error instanceof PermissionError || error instanceof AuthenticationError) return { ok: false, error: error.message };
  if (error instanceof Error && error.message && !TECHNICAL.test(error.message)) return { ok: false, error: error.message };
  console.error(`[${tag}] ${fallback}`, error);
  return { ok: false, error: fallback };
}
