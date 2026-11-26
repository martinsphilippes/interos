import "server-only";
/**
 * Torre de Controle do ERP (contrato v1 §12, somente leitura, `Authorization: Bearer <id>.<segredo>`). Dinheiro em
 * centavos inteiros, quantidades em milésimos, percentuais em pontos-base; `null` = não se aplica ou sem fonte
 * confiável. A Torre NÃO conhece o contrato (devolve dados de módulos não contratados): o INTEROS cruza com o estado
 * dos módulos antes de mostrar.
 */
import { erpRequest, type ErpResponse } from "./http";

const BASE = "/api/interos/v1";
const enc = encodeURIComponent;

export interface TowerMeta {
  idEmpresa: string;
  periodo: { de: string; ate: string } | null;
  unidades: string[] | null;
  fuso: string;
  geradoEm: string;
  versaoIndicadores: string;
}

export interface TowerPeriod {
  de: string;
  ate: string;
}

/** Resumo de todos os blocos no período (a consulta mais pesada da Torre). Estrutura aberta, lida com cuidado. */
export type TowerSummary = { meta: TowerMeta } & Record<string, unknown>;

export async function getTowerSummary(idEmpresa: string, period: TowerPeriod): Promise<ErpResponse<TowerSummary>> {
  return erpRequest<TowerSummary>({ api: "torre", method: "GET", path: `${BASE}/empresas/${enc(idEmpresa)}/torre/resumo`, query: { de: period.de, ate: period.ate }, timeoutMs: 30_000 });
}

export interface TowerSignal {
  em: string | null;
  fonte: string;
}

export interface TowerAdoption {
  meta: TowerMeta;
  ultimaAtividade: TowerSignal;
  ultimoAcesso: TowerSignal;
  usuarios: { total: number; ativos: number; convitesPendentes: number; convitesExpirados: number; suspensos: number; inativos: number; nuncaAcessaram: number };
  usuariosAtivos: { ultimos7Dias: number; ultimos30Dias: number; fonte: string };
  usuariosComAcesso: { ultimos7Dias: number; ultimos30Dias: number; fonte: string };
  atividadeOperacional: {
    ultimaVenda: { em: string; idUnidade: string | null; situacao: string } | null;
    ultimaAberturaCaixaEm: string | null;
    ultimoMovimentoEstoqueEm: string | null;
    ultimoDocumentoFiscalEm: string | null;
    ultimoPedidoOnlineEm: string | null;
  };
  terminais: { ativos: number; ultimaAtividadeEm: string | null };
  pendenciasIntegracao: Record<string, unknown>;
}

export async function getTowerAdoption(idEmpresa: string): Promise<ErpResponse<TowerAdoption>> {
  return erpRequest<TowerAdoption>({ api: "torre", method: "GET", path: `${BASE}/empresas/${enc(idEmpresa)}/torre/adocao` });
}
