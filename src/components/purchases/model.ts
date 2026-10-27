/** Abas de /compras (?aba=). Só "configuracao" é uma seção do catálogo; as outras são a própria tela. */
export const PURCHASE_TABS = ["necessidades", "pedidos", "recebimentos", "configuracao"] as const;
export type PurchaseTab = (typeof PURCHASE_TABS)[number];

/** O que quem está vendo pode fazer (cada action revalida no servidor). */
export interface PurchaseCan {
  edit: boolean;
  approve: boolean;
  receive: boolean;
  configEdit: boolean;
}

export interface PurchasableItem {
  id: string;
  name: string;
  unit: string;
  serialControlled: boolean;
  avgCost: number;
}

export interface SupplierOption {
  id: string;
  name: string;
}
