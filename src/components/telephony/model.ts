/** Abas do PABX (?aba=), uma por seção do catálogo comunicacao.pabx. */
export const PABX_TABS = ["ramais", "numeros", "horarios", "provedor", "qualidade", "mudancas"] as const;
export type PabxTab = (typeof PABX_TABS)[number];
