"use client";

/**
 * Contexto das capacidades de Vendas (calculadas no servidor pela página). Só esconde/desabilita controles; nunca
 * autoriza nada — as Server Actions revalidam a permissão e o escopo em toda chamada.
 */
import * as React from "react";
import { NO_SALES_CAPABILITIES, type SalesCapabilities } from "./access-model";

const SalesAccessContext = React.createContext<SalesCapabilities>(NO_SALES_CAPABILITIES);

export function SalesAccessProvider({ value, children }: { value: SalesCapabilities; children: React.ReactNode }) {
  return <SalesAccessContext.Provider value={value}>{children}</SalesAccessContext.Provider>;
}

/** Capacidades do usuário na tela atual (sem provedor: tudo negado). */
export function useSalesAccess(): SalesCapabilities {
  return React.useContext(SalesAccessContext);
}
