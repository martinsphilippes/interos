/** Abas de /estoque (?aba=). Só "configuracao" é uma seção do catálogo; as outras são a própria tela. */
export const STOCK_TABS = ["itens", "reservas", "movimentacoes", "series", "configuracao"] as const;
export type StockTab = (typeof STOCK_TABS)[number];

/** O que quem está vendo pode fazer na tela (cada action revalida no servidor). */
export interface StockCan {
  costs: boolean;
  editItems: boolean;
  entry: boolean;
  exit: boolean;
  reservations: boolean;
  adjust: boolean;
  configEdit: boolean;
}
