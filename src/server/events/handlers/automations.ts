import type { registerHandler as RegisterFn } from "../emit";

/**
 * Handler do motor de automações (src/server/automations/engine.ts), registrado para "*":
 * todo evento é conferido contra as automation_rules ativas de trigger "evento" (cache de 30s).
 * Eventos gerados por automações carregam payload.__automation e respeitam a proteção contra laço
 * (mesma regra não dispara na própria cadeia; profundidade máxima 3).
 *
 * O motor é importado dinamicamente para evitar ciclo (engine → tasks/service → events/index →
 * handlers/index → este arquivo).
 *
 * INTEGRAÇÃO: chamar `registerAutomationHandlers(registerHandler)` em src/server/events/handlers/index.ts
 * dentro de `ensureHandlersRegistered()`, de preferência por ÚLTIMO (handlers "*" rodam depois dos
 * específicos do tipo, então as regras enxergam o estado já atualizado pelos módulos).
 */
let registered = false;

export function registerAutomationHandlers(registerHandler: typeof RegisterFn): void {
  if (registered) return;
  registered = true;
  registerHandler("*", async function automationsOnEvent(event) {
    const { handleAutomationEvent } = await import("@/server/automations/engine");
    await handleAutomationEvent(event);
  });
}
