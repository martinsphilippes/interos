import type { registerHandler as RegisterFn } from "../emit";
import { update } from "../../db";
import { COLLECTIONS, type Client } from "@/domain/types";

/** Mantém `lastInteractionAt` do cliente sincronizado com qualquer evento na sua timeline. */
export function registerClientHandlers(registerHandler: typeof RegisterFn): void {
  registerHandler("*", async (event) => {
    if (!event.clientId) return;
    if (event.type === "client.created" || event.type === "client.updated") return;
    await update<Client>(COLLECTIONS.clients, event.clientId, { lastInteractionAt: event.occurredAt });
  });
}
