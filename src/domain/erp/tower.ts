/**
 * Torre de Controle no INTEROS: os blocos de indicadores do ERP (contrato v1 §12) interpretados pelo catálogo e pela
 * licença da empresa. A Torre do ERP não conhece o contrato (devolve números até de módulo não contratado), então cada
 * bloco é ligado às unidades comerciais que o produzem e ganha um estado:
 * - ativo (com movimento) · sem movimento (ligado, contagens zeradas no período);
 * - desativado (com a data e se o contrato mantém consulta histórica) · não contratado · indisponível (sem dado).
 * Módulo puro: valores em centavos/milésimos/pontos-base como o ERP manda; a tela formata.
 */

export type TowerBlockKey = "vendas" | "pdv" | "devolucoes" | "estoque" | "compras" | "financeiro" | "fiscal" | "comercioDigital";

export interface TowerBlockDef {
  key: TowerBlockKey;
  label: string;
  /** Unidades comerciais do catálogo v2 que produzem os números do bloco. */
  units: readonly string[];
}

/** Bloco da Torre → unidades que o produzem (vendas do PDV e documentos comerciais, caixa, devoluções...). */
export const TOWER_BLOCKS: readonly TowerBlockDef[] = [
  { key: "vendas", label: "Vendas", units: ["07.01", "06.01"] },
  { key: "pdv", label: "Caixa (PDV)", units: ["07.02"] },
  { key: "devolucoes", label: "Trocas e devoluções", units: ["08.04"] },
  { key: "estoque", label: "Estoque", units: ["10.01"] },
  { key: "compras", label: "Compras", units: ["05.04", "05.06"] },
  { key: "financeiro", label: "Financeiro", units: ["18.01", "18.02"] },
  { key: "fiscal", label: "Fiscal", units: ["04.01", "04.02", "04.03"] },
  { key: "comercioDigital", label: "Comércio digital", units: ["12.01"] },
];

export type TowerUnitState = { code: string; on: boolean; contracted: boolean; offSince: string | null; history: "read" | "none" | null };

export type TowerBlockState = "ativo" | "sem_movimento" | "desativado" | "nao_contratado" | "indisponivel";

export const TOWER_BLOCK_STATE_LABELS: Record<TowerBlockState, string> = {
  ativo: "Ativo",
  sem_movimento: "Sem movimento no período",
  desativado: "Módulo desativado",
  nao_contratado: "Não contratado",
  indisponivel: "Dados indisponíveis",
};

export interface TowerIndicator {
  label: string;
  value: number | null;
  unit: "centavos" | "quantidade" | "bps" | "milesimos" | "texto";
  text?: string | null;
  /** Variação contra o período anterior (pontos-base), quando o ERP informa. */
  deltaBps?: number | null;
}

export interface TowerBlockView {
  key: TowerBlockKey;
  label: string;
  state: TowerBlockState;
  /** Desligado desde (quando desativado). */
  offSince: string | null;
  /** O contrato mantém consulta aos períodos anteriores à desativação. */
  historyReadable: boolean;
  indicators: TowerIndicator[];
  note: string | null;
}

type Obj = Record<string, unknown>;
const get = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Obj)[k] : undefined), o);
const num = (o: unknown, path: string): number | null => {
  const v = get(o, path);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

function indicatorsOf(key: TowerBlockKey, block: unknown): { indicators: TowerIndicator[]; movement: boolean | null; note: string | null } {
  if (!block || typeof block !== "object") return { indicators: [], movement: null, note: null };
  switch (key) {
    case "vendas":
      return {
        indicators: [
          { label: "Receita líquida", value: num(block, "receitaLiquidaCentavos"), unit: "centavos", deltaBps: num(block, "variacao.receitaLiquidaBps") },
          { label: "Vendas", value: num(block, "quantidadeVendas"), unit: "quantidade", deltaBps: num(block, "variacao.quantidadeVendasBps") },
          { label: "Ticket médio", value: num(block, "ticketMedioCentavos"), unit: "centavos", deltaBps: num(block, "variacao.ticketMedioBps") },
          { label: "Margem bruta", value: num(block, "margemBrutaBps"), unit: "bps" },
        ],
        movement: (num(block, "quantidadeVendas") ?? 0) > 0 || (num(block, "quantidadeDevolucoes") ?? 0) > 0,
        note: null,
      };
    case "pdv":
      return {
        indicators: [
          { label: "Caixas abertos no período", value: num(block, "noPeriodo.caixasAbertos"), unit: "quantidade" },
          { label: "Caixas com diferença", value: num(block, "noPeriodo.caixasComDiferenca"), unit: "quantidade" },
          { label: "Diferença total", value: num(block, "noPeriodo.diferencaTotalCentavos"), unit: "centavos" },
          { label: "Caixas em aberto agora", value: num(block, "posicaoAtual.caixasEmAberto"), unit: "quantidade" },
          { label: "Terminais ativos", value: num(block, "posicaoAtual.terminaisAtivos"), unit: "quantidade" },
        ],
        movement: (num(block, "noPeriodo.caixasAbertos") ?? 0) > 0 || (num(block, "posicaoAtual.caixasEmAberto") ?? 0) > 0,
        note: null,
      };
    case "devolucoes":
      return {
        indicators: [
          { label: "Valor devolvido", value: num(block, "valorCentavos"), unit: "centavos" },
          { label: "Documentos", value: num(block, "quantidadeDocumentos"), unit: "quantidade" },
        ],
        movement: (num(block, "quantidadeDocumentos") ?? 0) > 0,
        note: null,
      };
    case "estoque":
      return {
        indicators: [
          { label: "Valor em estoque", value: num(block, "posicaoAtual.valorCentavos"), unit: "centavos" },
          { label: "Abaixo do mínimo", value: num(block, "posicaoAtual.abaixoDoMinimo"), unit: "quantidade" },
          { label: "Rupturas", value: num(block, "posicaoAtual.rupturas"), unit: "quantidade" },
          { label: "Saldos negativos", value: num(block, "posicaoAtual.saldosNegativos"), unit: "quantidade" },
        ],
        movement: (num(block, "posicaoAtual.saldos") ?? 0) > 0,
        note: "Posição atual (sem período).",
      };
    case "compras":
      return {
        indicators: [
          { label: "Pedidos criados", value: num(block, "noPeriodo.pedidosCriados.quantidade"), unit: "quantidade" },
          { label: "Valor dos pedidos", value: num(block, "noPeriodo.pedidosCriados.valorCentavos"), unit: "centavos" },
          { label: "Aguardando aprovação", value: num(block, "posicaoAtual.aguardandoAprovacao.quantidade"), unit: "quantidade" },
          { label: "A receber", value: num(block, "posicaoAtual.aReceber.quantidade"), unit: "quantidade" },
        ],
        movement: (num(block, "noPeriodo.pedidosCriados.quantidade") ?? 0) > 0 || (num(block, "noPeriodo.recebimentosConfirmados.quantidade") ?? 0) > 0 || (num(block, "posicaoAtual.aReceber.quantidade") ?? 0) > 0,
        note: null,
      };
    case "financeiro":
      return {
        indicators: [
          { label: "Recebido no período", value: num(block, "noPeriodo.recebido.valorCentavos"), unit: "centavos" },
          { label: "Pago no período", value: num(block, "noPeriodo.pago.valorCentavos"), unit: "centavos" },
          { label: "A receber vencido", value: num(block, "posicaoAtual.aReceber.vencido.valorCentavos"), unit: "centavos" },
          { label: "Saldo das contas", value: num(block, "posicaoAtual.saldoContasCentavos"), unit: "centavos" },
        ],
        movement: (num(block, "noPeriodo.recebido.quantidadeBaixas") ?? 0) > 0 || (num(block, "noPeriodo.pago.quantidadeBaixas") ?? 0) > 0 || (num(block, "posicaoAtual.aReceber.emAberto.quantidade") ?? 0) > 0,
        note: null,
      };
    case "fiscal": {
      const simulated = num(block, "noPeriodo.simuladas.quantidade") ?? 0;
      return {
        indicators: [
          { label: "Autorizadas", value: num(block, "noPeriodo.autorizadas.quantidade"), unit: "quantidade" },
          { label: "Faturamento fiscal líquido", value: num(block, "noPeriodo.faturamentoFiscal.liquidoCentavos"), unit: "centavos" },
          { label: "Rejeições", value: num(block, "noPeriodo.rejeicoes"), unit: "quantidade" },
          { label: "Pendentes", value: num(block, "noPeriodo.pendentesEntreEmitidos.quantidade"), unit: "quantidade" },
        ],
        movement: (num(block, "noPeriodo.documentosEmitidos") ?? 0) > 0,
        note: simulated > 0 ? `${simulated} documento(s) em simulação (não são notas reais).` : null,
      };
    }
    case "comercioDigital": {
      const created = get(block, "lojaCriada");
      return {
        indicators: [
          { label: "Situação da loja", value: null, unit: "texto", text: created === false ? "Loja não criada" : String(get(block, "situacaoLoja") ?? "—") },
          { label: "Pedidos pagos", value: num(block, "noPeriodo.pedidosPagos.quantidade"), unit: "quantidade" },
          { label: "Valor pago", value: num(block, "noPeriodo.pedidosPagos.valorCentavos"), unit: "centavos" },
          { label: "Aguardando pagamento", value: num(block, "posicaoAtual.aguardandoPagamento"), unit: "quantidade" },
        ],
        movement: created === false ? false : (num(block, "noPeriodo.pedidosCriados.quantidade") ?? 0) > 0,
        note: created === false ? "A empresa ainda não criou a loja virtual." : null,
      };
    }
  }
}

/**
 * Estado de cada bloco: primeiro o contrato (unidades ligadas, desligadas com data ou nunca contratadas), depois o dado
 * (bloco ausente ou leitura da Torre falhou = indisponível; contagens zeradas = sem movimento).
 */
export function towerBlocks(summary: Obj | null, units: ReadonlyMap<string, TowerUnitState>): TowerBlockView[] {
  return TOWER_BLOCKS.map((def) => {
    const states = def.units.map((c) => units.get(c)).filter((s): s is TowerUnitState => Boolean(s));
    const on = states.some((s) => s.on);
    const everContracted = states.some((s) => s.contracted || s.offSince);
    const offSince = on ? null : (states.map((s) => s.offSince).filter((d): d is string => Boolean(d)).sort().at(-1) ?? null);
    const historyReadable = states.some((s) => s.history !== "none");
    const block = summary ? summary[def.key] : undefined;
    const { indicators, movement, note } = indicatorsOf(def.key, block);
    let state: TowerBlockState;
    if (!on && everContracted) state = "desativado";
    else if (!on) state = "nao_contratado";
    else if (!summary || block === undefined || block === null) state = "indisponivel";
    else state = movement ? "ativo" : "sem_movimento";
    const showData = state === "ativo" || state === "sem_movimento" || (state === "desativado" && historyReadable);
    return {
      key: def.key,
      label: def.label,
      state,
      offSince,
      historyReadable,
      indicators: showData ? indicators : [],
      note:
        state === "desativado"
          ? historyReadable
            ? `Desligado${offSince ? ` em ${offSince.slice(0, 10).split("-").reverse().join("/")}` : ""}: os números abaixo são consulta histórica; períodos anteriores à desativação continuam consultáveis.`
            : "Desligado sem consulta histórica pelo contrato."
          : state === "nao_contratado"
            ? "A empresa não contratou este módulo: a Torre não é usada para ele."
            : state === "indisponivel"
              ? "O ERP não devolveu este bloco agora (sem fonte confiável ou leitura indisponível)."
              : note,
    };
  });
}
