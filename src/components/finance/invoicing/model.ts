/** Abas de /financeiro/faturamento (?aba=). Só "configuracao" é uma seção do catálogo; as outras são a própria tela. */
export const INVOICING_TABS = ["a-faturar", "proximas", "notas", "dispensadas", "configuracao"] as const;
export type InvoicingTab = (typeof INVOICING_TABS)[number];
