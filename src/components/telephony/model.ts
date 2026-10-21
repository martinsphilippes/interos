/** Abas do PABX (?aba=), uma por seção do catálogo comunicacao.pabx. */
export const PABX_TABS = ["ramais", "numeros", "horarios", "provedor", "qualidade", "mudancas", "gravacoes"] as const;
export type PabxTab = (typeof PABX_TABS)[number];

/** Evento do navegador: a Central de Comando pede ao softphone para entrar na supervisão de uma ligação. */
export const MONITOR_CALL_EVENT = "interos:monitor-call";
export interface MonitorCallDetail {
  id: string;
  /** «Fulana com Cliente X», para o painel do softphone. */
  label: string;
}
