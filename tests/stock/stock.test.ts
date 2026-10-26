/**
 * Regras puras do estoque (src/domain/stock.ts): saldo nunca negativo, custo médio, reserva por origem, demanda do
 * contrato (produto → itens), números de série, preenchimento das reservas na entrada e situação da reserva.
 */
import { describe, expect, it } from "vitest";
import {
  StockRuleError,
  allocateReservation,
  applyStockMove,
  availableOf,
  averageCostAfterEntry,
  contractStockDemand,
  fillPendingReservations,
  isBelowMinimum,
  normalizeStockSettings,
  parseMoneyInput,
  parseSerials,
  reservationMissing,
  reservationPendingReturn,
  reservationState,
  serialDocId,
  stockValue,
} from "@/domain/stock";

const B = (onHand: number, reserved: number, avgCost = 100) => ({ onHand, reserved, avgCost });

describe("saldo", () => {
  it("disponível = em mãos − reservado, nunca negativo; mínimo só quando configurado", () => {
    expect(availableOf(B(10, 3))).toBe(7);
    expect(availableOf(B(2, 5))).toBe(0);
    expect(isBelowMinimum(B(10, 8), 3)).toBe(true);
    expect(isBelowMinimum(B(10, 7), 3)).toBe(false);
    expect(isBelowMinimum(B(0, 0), 0)).toBe(false);
  });

  it("custo médio ponderado na entrada; com saldo zero vale o custo da entrada", () => {
    expect(averageCostAfterEntry({ onHand: 0, avgCost: 0 }, 5, 200)).toBe(200);
    expect(averageCostAfterEntry({ onHand: 10, avgCost: 100 }, 10, 200)).toBe(150);
    expect(averageCostAfterEntry({ onHand: 3, avgCost: 100 }, 1, 0)).toBe(75);
    expect(stockValue({ onHand: 4, avgCost: 150.5 })).toBe(602);
  });

  it("entrada soma e recalcula o custo; devolução e ajuste não mexem no custo médio", () => {
    expect(applyStockMove(B(10, 0, 100), { type: "entrada", quantity: 10, unitCost: 200 })).toEqual(B(20, 0, 150));
    expect(applyStockMove(B(10, 2, 100), { type: "devolucao", quantity: 1 })).toEqual(B(11, 2, 100));
    expect(applyStockMove(B(10, 2, 100), { type: "ajuste", delta: -3 })).toEqual(B(7, 2, 100));
  });

  it("reserva só do disponível; liberação só do reservado", () => {
    expect(applyStockMove(B(5, 2), { type: "reserva", quantity: 3 })).toEqual(B(5, 5));
    expect(() => applyStockMove(B(5, 2), { type: "reserva", quantity: 4 })).toThrow(StockRuleError);
    expect(applyStockMove(B(5, 5), { type: "liberacao", quantity: 5 })).toEqual(B(5, 0));
    expect(() => applyStockMove(B(5, 1), { type: "liberacao", quantity: 2 })).toThrow(/reservada/);
  });

  it("saída: da reserva do contrato baixa o reservado; sem reserva só do disponível (não usa a reserva de outro)", () => {
    expect(applyStockMove(B(5, 3), { type: "saida", quantity: 2, fromReserved: 2 })).toEqual(B(3, 1));
    expect(applyStockMove(B(5, 3), { type: "saida", quantity: 2, fromReserved: 0 })).toEqual(B(3, 3));
    expect(() => applyStockMove(B(5, 4), { type: "saida", quantity: 2, fromReserved: 0 })).toThrow(/reservado para outros contratos/);
    // Parte da reserva + parte do disponível.
    expect(applyStockMove(B(5, 2), { type: "saida", quantity: 3, fromReserved: 2 })).toEqual(B(2, 0));
    expect(() => applyStockMove(B(1, 0), { type: "saida", quantity: 2, fromReserved: 0 })).toThrow(StockRuleError);
  });

  it("ajuste: nunca negativo nem abaixo do reservado; quantidade inteira", () => {
    expect(() => applyStockMove(B(2, 0), { type: "ajuste", delta: -3 })).toThrow(/negativo/);
    expect(() => applyStockMove(B(5, 4), { type: "ajuste", delta: -2 })).toThrow(/reservada/);
    expect(() => applyStockMove(B(5, 0), { type: "ajuste", delta: 0 })).toThrow(StockRuleError);
    expect(() => applyStockMove(B(5, 0), { type: "entrada", quantity: 1.5, unitCost: 1 })).toThrow(/Quantidade/);
    expect(() => applyStockMove(B(5, 0), { type: "entrada", quantity: 1, unitCost: -1 })).toThrow(/Custo/);
  });
});

describe("reserva por origem", () => {
  it("estoque: reserva o que há e aponta a falta (sem compra)", () => {
    expect(allocateReservation("estoque", 5, 3)).toEqual({ reserve: 3, missing: 2, toPurchase: false });
    expect(allocateReservation("estoque", 2, 10)).toEqual({ reserve: 2, missing: 0, toPurchase: false });
  });
  it("estoque e, se faltar, compra: o resto vai para compra", () => {
    expect(allocateReservation("estoque_ou_compra", 5, 3)).toEqual({ reserve: 3, missing: 2, toPurchase: true });
    expect(allocateReservation("estoque_ou_compra", 2, 2)).toEqual({ reserve: 2, missing: 0, toPurchase: false });
  });
  it("sob demanda: não reserva, tudo vai para compra", () => {
    expect(allocateReservation("sob_demanda", 4, 100)).toEqual({ reserve: 0, missing: 4, toPurchase: true });
  });
  it("disponível negativo/fracionado não reserva a mais", () => {
    expect(allocateReservation("estoque", 3, -2)).toEqual({ reserve: 0, missing: 3, toPurchase: false });
  });
});

describe("demanda do contrato", () => {
  const items = [
    { id: "cam", name: "Câmera", active: true, products: [{ productId: "kit", units: 4 }, { productId: "cam-avulsa", units: 1 }] },
    { id: "dvr", name: "DVR", active: true, products: [{ productId: "kit", units: 1 }] },
    { id: "velho", name: "Antigo", active: false, products: [{ productId: "kit", units: 1 }] },
  ];
  it("produto × quantidade × unidades por produto; itens repetidos somam; inativos e sem vínculo ficam de fora", () => {
    const d = contractStockDemand(
      [
        { productId: "kit", quantity: 2 },
        { productId: "cam-avulsa", quantity: 3 },
        { productId: "software", quantity: 1 },
      ],
      items,
    );
    expect(Object.fromEntries(d)).toEqual({ cam: 11, dvr: 2 });
  });
  it("quantidade ausente ou zero conta 1", () => {
    expect(Object.fromEntries(contractStockDemand([{ productId: "kit", quantity: 0 }], items))).toEqual({ cam: 4, dvr: 1 });
  });
});

describe("números de série", () => {
  it("normaliza, separa por linha/vírgula e aponta repetidos", () => {
    expect(parseSerials(" sn1 \nSN2, sn1;  ab  c ")).toEqual({ serials: ["SN1", "SN2", "AB C"], duplicates: ["SN1"] });
    expect(parseSerials(["x1", "X1"]).duplicates).toEqual(["X1"]);
  });
  it("id do documento é por item, seguro para id e sem colisão entre séries diferentes", () => {
    expect(serialDocId("item1", "ab-12")).toBe("item1__AB-12");
    expect(serialDocId("item1", "AB/12 C")).toBe(serialDocId("item1", "ab/12 c"));
    const ids = ["SN.01", "SN 01", "SN_01", "SN01"].map((x) => serialDocId("i", x));
    expect(new Set(ids).size).toBe(4);
  });
});

describe("valor em reais", () => {
  it("vírgula decimal, ponto de milhar e ponto decimal", () => {
    expect(parseMoneyInput("1.234,56")).toBe(1234.56);
    expect(parseMoneyInput("1234,5")).toBe(1234.5);
    expect(parseMoneyInput("1.500")).toBe(1500);
    expect(parseMoneyInput("12.50")).toBe(12.5);
    expect(parseMoneyInput("R$ 2.000,00")).toBe(2000);
    expect(parseMoneyInput("0")).toBe(0);
    expect(Number.isNaN(parseMoneyInput("abc"))).toBe(true);
    expect(Number.isNaN(parseMoneyInput("1,234.56"))).toBe(true);
    expect(Number.isNaN(parseMoneyInput(""))).toBe(true);
  });
});

describe("reservas", () => {
  it("falta, devolução pendente e situação", () => {
    expect(reservationMissing({ quantity: 5, reserved: 2, delivered: 1 })).toBe(2);
    expect(reservationState({ quantity: 5, reserved: 0, delivered: 0, status: "ativa" })).toBe("aguardando");
    expect(reservationState({ quantity: 5, reserved: 2, delivered: 0, status: "ativa" })).toBe("parcial");
    expect(reservationState({ quantity: 5, reserved: 5, delivered: 0, status: "ativa" })).toBe("separada");
    expect(reservationState({ quantity: 5, reserved: 0, delivered: 5, status: "atendida" })).toBe("atendida");
    expect(reservationPendingReturn({ delivered: 3, returned: 1, status: "cancelada" })).toBe(2);
    expect(reservationPendingReturn({ delivered: 3, returned: 0, status: "ativa" })).toBe(0);
    expect(reservationState({ quantity: 5, reserved: 0, delivered: 3, returned: 1, status: "cancelada" })).toBe("devolucao_pendente");
    expect(reservationState({ quantity: 5, reserved: 0, delivered: 3, returned: 3, status: "cancelada" })).toBe("cancelada");
  });

  it("entrada preenche as reservas com falta, das mais antigas para as mais novas", () => {
    const rs = [
      { id: "b", createdAt: "2026-10-02", quantity: 3, reserved: 0, delivered: 0 },
      { id: "a", createdAt: "2026-10-01", quantity: 2, reserved: 1, delivered: 0 },
      { id: "c", createdAt: "2026-10-03", quantity: 1, reserved: 1, delivered: 0 },
    ];
    expect(fillPendingReservations(rs, 3)).toEqual([
      { id: "a", add: 1 },
      { id: "b", add: 2 },
    ]);
    expect(fillPendingReservations(rs, 0)).toEqual([]);
  });
});

describe("configuração", () => {
  it("padrões: Administrativo, reserva na assinatura e aviso de mínimo ligados", () => {
    expect(normalizeStockSettings(null)).toEqual({ responsibleDepartment: "administrativo", reserveOnSign: true, notifyLowStock: true, stored: false });
    expect(normalizeStockSettings({ responsibleDepartment: "financeiro", reserveOnSign: false })).toMatchObject({ responsibleDepartment: "financeiro", reserveOnSign: false, notifyLowStock: true, stored: true });
  });
});
