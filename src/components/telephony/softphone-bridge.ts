/**
 * Ponte entre as telas e o softphone (um só, montado no layout): o softphone avisa quando está pronto e as telas pedem
 * uma ligação por evento do navegador (ex.: botão «Ligar» da conversa da Central, que liga a ligação à conversa).
 */
import * as React from "react";

export const CALL_EVENT = "interos:call";

export interface CallRequest {
  number: string;
  /** Conversa da Central de onde saiu a ligação (a ligação fica registrada nela). */
  conversationId?: string;
}

let ready = false;
const listeners = new Set<() => void>();

export function setSoftphoneReady(value: boolean) {
  if (ready === value) return;
  ready = value;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** O softphone do INTEROS está conectado e pronto para ligar? */
export function useSoftphoneReady(): boolean {
  return React.useSyncExternalStore(subscribe, () => ready, () => false);
}

export function requestSoftphoneCall(request: CallRequest) {
  window.dispatchEvent(new CustomEvent<CallRequest>(CALL_EVENT, { detail: request }));
}
