/**
 * Registro central dos handlers de eventos.
 *
 * Cada módulo exporta uma função `register()` que chama `registerHandler(tipo, fn)`.
 * A ordem importa apenas dentro do mesmo tipo de evento. Mantenha handlers idempotentes.
 */
import { registerHandler } from "../emit";
import { registerNotificationHandlers } from "./notifications";
import { registerClientHandlers } from "./client";

let registered = false;

export function ensureHandlersRegistered(): void {
  if (registered) return;
  registered = true;
  registerNotificationHandlers(registerHandler);
  registerClientHandlers(registerHandler);
}
