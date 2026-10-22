/**
 * Troca de versão com a tela aberta (a Vercel Hobby não tem Skew Protection): a aba carregada na versão anterior chama
 * uma Server Action que a versão nova não conhece; o Next responde 404 e o cliente lança `UnrecognizedActionError`.
 * Em vez de "Algo deu errado", a tela recarrega (error.tsx) e, antes disso, o VersionWatcher avisa quando o deploy no
 * ar (/api/versao) é outro. BUILD_ID vem de NEXT_PUBLIC_BUILD_ID (next.config.ts: id do deploy da Vercel; "local" fora dela).
 */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "local";

/** Erro de Server Action de outro deploy (nome da classe do Next ou a mensagem, para o caso de ela chegar serializada). */
export function isNewVersionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "UnrecognizedActionError") return true;
  return typeof message === "string" && /Server Action .* was not found|Failed to find Server Action/i.test(message);
}
