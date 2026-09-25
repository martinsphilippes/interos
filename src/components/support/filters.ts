/** Estado dos filtros da lista de chamados (lido no servidor a partir da URL e usado no cliente). */

/** Filtros na URL (parâmetros em português). */
export interface TicketFilterState {
  q: string;
  status: string; // lista separada por vírgula ou "abertos"
  prioridade: string;
  fila: string;
  atendente: string; // id, "meus" ou "sem"
  canal: string;
  produto: string;
  sla: string; // em_risco | violado | atencao
  resposta: string; // pendente
  periodo: string; // hoje | 7d | 30d | mes | 90d | ""
  reaberto: string; // "1"
  ordem: string; // fila | recentes | antigos | resolvidos
}

export const EMPTY_FILTERS: TicketFilterState = { q: "", status: "", prioridade: "", fila: "", atendente: "", canal: "", produto: "", sla: "", resposta: "", periodo: "", reaberto: "", ordem: "" };

export function readTicketFilters(params: Record<string, string | string[] | undefined>): TicketFilterState {
  const out = { ...EMPTY_FILTERS };
  for (const key of Object.keys(EMPTY_FILTERS) as (keyof TicketFilterState)[]) {
    const v = params[key];
    out[key] = (Array.isArray(v) ? v[0] : v) ?? "";
  }
  return out;
}
