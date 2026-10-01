/**
 * Escopo de execução das automações (AsyncLocalStorage com a cadeia de regras e a profundidade).
 *
 * Módulo sem dependências do Firestore: o motor de eventos (`emitEvent`) lê o escopo para gravar, NA CRIAÇÃO do
 * evento, `meta.automation` (regra de origem + profundidade) — o payload continua imutável (D29) e o motor de
 * automações não precisa reescrever o evento depois.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface AutomationScope {
  chain: string[];
  depth: number;
}

const holder = globalThis as unknown as { __interosAutomationScope?: AsyncLocalStorage<AutomationScope> };

/** Instância única (sobrevive ao HMR em desenvolvimento, como o registro de handlers). */
export const automationScope: AsyncLocalStorage<AutomationScope> = holder.__interosAutomationScope ?? (holder.__interosAutomationScope = new AsyncLocalStorage<AutomationScope>());

/** Marcador da automação corrente (regra mais recente da cadeia), ou undefined fora de uma automação. */
export function currentAutomationMarker(): { ruleId: string; depth: number } | undefined {
  const scope = automationScope.getStore();
  if (!scope || scope.chain.length === 0) return undefined;
  return { ruleId: scope.chain[scope.chain.length - 1], depth: scope.depth };
}
