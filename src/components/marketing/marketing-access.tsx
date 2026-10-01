"use client";

/**
 * Contexto das capacidades de Marketing (calculadas no servidor pela página). Só esconde/desabilita controles; nunca
 * autoriza nada — as Server Actions revalidam a permissão em toda chamada.
 */
import * as React from "react";
import { NO_MARKETING_CAPABILITIES, type MarketingCapabilities } from "./access-model";

const MarketingAccessContext = React.createContext<MarketingCapabilities>(NO_MARKETING_CAPABILITIES);

export function MarketingAccessProvider({ value, children }: { value: MarketingCapabilities; children: React.ReactNode }) {
  return <MarketingAccessContext.Provider value={value}>{children}</MarketingAccessContext.Provider>;
}

/** Capacidades do usuário na tela atual (sem provedor: tudo negado). */
export function useMarketingAccess(): MarketingCapabilities {
  return React.useContext(MarketingAccessContext);
}
