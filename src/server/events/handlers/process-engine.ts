import type { registerHandler as RegisterFn } from "../emit";

/**
 * Handler do motor de PROCESSOS (src/server/process-engine/engine.ts), registrado para "*":
 * - task.completed de tarefa com processId "<runId>#<nodeId>" avança a execução;
 * - evento gatilho de um processo PUBLICADO inicia uma execução (idempotente por definição + entidade);
 * - execuções com espera por evento avançam quando o evento chega (mesmo cliente).
 *
 * O motor é importado dinamicamente para evitar ciclo (engine → tasks/service → events/index → handlers).
 *
 * Registrado em handlers/index.ts logo ANTES das automações: os módulos já atualizaram o estado e as
 * automações continuam por último.
 */
let registered = false;

export function registerProcessEngineHandlers(registerHandler: typeof RegisterFn): void {
  if (registered) return;
  registered = true;
  registerHandler("*", async function processEngineOnEvent(event) {
    const { handleProcessEvent } = await import("@/server/process-engine/engine");
    await handleProcessEvent(event);
  });
}
