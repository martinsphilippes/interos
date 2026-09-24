/**
 * Ponto de entrada do motor de eventos. Importe `emitEvent` daqui, nunca de `./emit` diretamente,
 * para garantir que os handlers estejam registrados.
 */
import { emitEvent as rawEmit, type EmitEventInput } from "./emit";
import { ensureHandlersRegistered } from "./handlers";
import type { DomainEvent } from "@/domain/types";

export type { EmitEventInput };

export async function emitEvent(input: EmitEventInput): Promise<DomainEvent> {
  ensureHandlersRegistered();
  return rawEmit(input);
}
