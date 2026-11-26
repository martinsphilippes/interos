/** Abas de /admin/produtos (?aba=): o catálogo de produtos e a Gestão de Produtos (módulos, pacotes, simulador). */
export const PRODUCT_TABS = ["produtos", "modulos", "pacotes", "simulador"] as const;
export type ProductTab = (typeof PRODUCT_TABS)[number];
