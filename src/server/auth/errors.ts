/**
 * Erros de autorização e o tratamento único de falhas de Server Actions (A5).
 */
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { AuthenticationError, BusinessError, PermissionError } from "./error-classes";

export { ACCESS_DENIED_MESSAGE, AuthenticationError, BusinessError, PermissionError } from "./error-classes";

/** Mensagens técnicas que nunca chegam ao usuário (ficam no log). */
const TECHNICAL = /firestore|firebase|ECONN|deadline|permission denied|undefined|null|NEXT_/i;
/** Prefixo de erro gRPC do Firestore/Google Cloud ("5 NOT_FOUND: …", "10 ABORTED: …"). */
const GRPC_PREFIX = /^\d+ [A-Z_]+:/;
/** Erros de rede/sistema e trechos de infraestrutura (hosts, caminhos de recurso, URLs). */
const SYSTEM_TEXT = /getaddrinfo|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EHOSTUNREACH|socket hang up|fetch failed|certificate|https?:\/\/|projects\/[^\s]+\/databases|\bpath </i;
/** Classes nativas que indicam defeito de programa, nunca regra de negócio. */
const PROGRAM_ERRORS = [TypeError, RangeError, ReferenceError, SyntaxError, URIError, EvalError];

/**
 * O erro pode ter a mensagem mostrada ao usuário? Lista branca: PermissionError/AuthenticationError/BusinessError
 * sempre; demais Error só quando não há sinal técnico — sem `code`/`errno`/`syscall`/`details` (erros do Firestore,
 * do Firebase Auth e do Node trazem esses campos), fora das classes nativas de defeito e sem texto de infraestrutura.
 */
export function isUserFacingError(error: unknown): error is Error {
  if (error instanceof PermissionError || error instanceof AuthenticationError || error instanceof BusinessError) return true;
  if (!(error instanceof Error) || !error.message) return false;
  if (PROGRAM_ERRORS.some((cls) => error instanceof cls)) return false;
  const fields = error as Error & { code?: unknown; errno?: unknown; syscall?: unknown; details?: unknown };
  if (fields.code !== undefined || fields.errno !== undefined || fields.syscall !== undefined || fields.details !== undefined) return false;
  const message = error.message;
  return !GRPC_PREFIX.test(message) && !TECHNICAL.test(message) && !SYSTEM_TEXT.test(message);
}

function zodText(error: z.ZodError): string {
  return error.issues.map((i) => i.message).join(" · ") || "Dados inválidos";
}

/**
 * Converte um erro de Server Action no formato ActionResult `{ ok: false, error }`.
 * - Erros internos do Next (redirect, notFound…) são relançados com `unstable_rethrow` (chamado no topo do catch).
 * - ZodError → mensagens de validação; PermissionError/AuthenticationError/BusinessError → a própria mensagem.
 * - Erros de regra de negócio em português passam; erros técnicos (gRPC, rede, código de sistema, classes nativas de
 *   defeito) viram `fallback` e vão para o log.
 */
export function failAction(error: unknown, fallback: string, tag = "action"): { ok: false; error: string } {
  unstable_rethrow(error);
  if (error instanceof z.ZodError) return { ok: false, error: zodText(error) };
  if (isUserFacingError(error)) return { ok: false, error: error.message };
  console.error(`[${tag}] ${fallback}`, error);
  return { ok: false, error: fallback };
}
