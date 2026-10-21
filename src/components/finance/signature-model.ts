/** Abas da tela Financeiro › Assinaturas (?aba=). Cada aba é uma seção do catálogo financeiro.assinaturas. */
export const ASSINATURAS_TABS = ["fila", "entrada", "modelos", "configuracao"] as const;
export type AssinaturasTab = (typeof ASSINATURAS_TABS)[number];

export const ASSINATURAS_TAB_LABELS: Record<AssinaturasTab, string> = {
  fila: "Fila de assinatura",
  entrada: "Caixa de entrada",
  modelos: "Modelos de contrato",
  configuracao: "Configuração",
};
