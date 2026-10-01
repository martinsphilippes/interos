/**
 * Acesso rápido da fase de testes (cards de login com um clique), ligado por NEXT_PUBLIC_DEMO_MODE=true.
 * Função pura, sem dependências: usada pelo acesso rápido (src/server/auth/demo.ts) e pelo /api/health,
 * que precisa responder mesmo quando o Firebase Admin não inicializa.
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}
