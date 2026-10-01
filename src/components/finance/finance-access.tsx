"use client";

/**
 * Contexto das capacidades do Financeiro (calculadas no servidor pela página). Só esconde/desabilita controles; nunca
 * autoriza nada — as Server Actions revalidam a permissão e o escopo em toda chamada.
 */
import * as React from "react";
import { NO_FINANCE_CAPABILITIES, type FinanceCapabilities } from "./access-model";

const FinanceAccessContext = React.createContext<FinanceCapabilities>(NO_FINANCE_CAPABILITIES);

export function FinanceAccessProvider({ value, children }: { value: FinanceCapabilities; children: React.ReactNode }) {
  return <FinanceAccessContext.Provider value={value}>{children}</FinanceAccessContext.Provider>;
}

/** Capacidades do usuário na tela atual (sem provedor: tudo negado). */
export function useFinanceAccess(): FinanceCapabilities {
  return React.useContext(FinanceAccessContext);
}
