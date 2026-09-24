/**
 * Campos aditivos do módulo de Marketing ainda não promovidos a `src/domain/types.ts`.
 * O integrador deve mover estes campos para `ProspectList` (todos opcionais, sem migração).
 */
import type { ProspectList } from "./types";

export interface ProspectListPlanning {
  /** Objetivo da lista (ex.: "Gerar reuniões qualificadas para apresentação de soluções"). */
  objective?: string;
  /** Início e término do período da ação (AAAA-MM-DD). */
  startDate?: string;
  endDate?: string;
  /** Lista respeita opt-out (contatos que pediram para não receber abordagem são excluídos). */
  optOut?: boolean;
}

export type ProspectListExtended = ProspectList & ProspectListPlanning;
