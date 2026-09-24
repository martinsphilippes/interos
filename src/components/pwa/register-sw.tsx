"use client";

import { useEffect } from "react";

/** Registra /sw.js em produção (ou em dev com NEXT_PUBLIC_ENABLE_SW=true). Não renderiza nada. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const enabled = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_SW === "true";
    if (!enabled) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      console.warn("[pwa] falha ao registrar service worker", error);
    });
  }, []);
  return null;
}

export type PushPermissionResult = "granted" | "denied" | "default" | "unsupported";

/** Pede permissão para notificações push. Use a partir de uma interação do usuário. */
export async function requestPushPermission(): Promise<PushPermissionResult> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/** Registro atual do service worker (ou null se ainda não houver). */
export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration("/")) ?? null;
}
