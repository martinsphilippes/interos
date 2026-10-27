/**
 * Regras puras de compras (src/domain/purchases.ts): necessidade (falta dos contratos + mínimo − disponível − já
 * pedido), aprovação acima do valor, situação pelo recebido, total e vencimento do título.
 */
import { describe, expect, it } from "vitest";
import { needsApproval, normalizePurchaseSettings, orderTotal, payableDueDate, purchaseNeed, statusAfterReceipt } from "@/domain/purchases";

const base = { itemId: "i", name: "Câmera", active: true, onHand: 0, reserved: 0, minQuantity: 0, missing: 0, ordered: 0 };

describe("necessidade de compra", () => {
  it("cobre a falta dos contratos e volta ao mínimo, descontando disponível e já pedido", () => {
    expect(purchaseNeed({ ...base, missing: 3 })).toMatchObject({ suggested: 3, reasons: ["contratos"] });
    expect(purchaseNeed({ ...base, onHand: 5, reserved: 4, minQuantity: 3 })).toMatchObject({ available: 1, suggested: 2, reasons: ["minimo"] });
    expect(purchaseNeed({ ...base, missing: 2, minQuantity: 2, ordered: 1 })).toMatchObject({ suggested: 3, reasons: ["contratos", "minimo"] });
    expect(purchaseNeed({ ...base, missing: 2, ordered: 5 }).suggested).toBe(0);
    expect(purchaseNeed({ ...base, onHand: 10, minQuantity: 3 }).suggested).toBe(0);
  });
  it("item desativado não entra", () => {
    expect(purchaseNeed({ ...base, active: false, missing: 4 }).suggested).toBe(0);
  });
});

describe("aprovação", () => {
  it("desligada: nunca; ligada: só ACIMA do valor", () => {
    expect(needsApproval({ approvalEnabled: false, approvalThreshold: 0 }, 1_000_000)).toBe(false);
    expect(needsApproval({ approvalEnabled: true, approvalThreshold: 5000 }, 5000)).toBe(false);
    expect(needsApproval({ approvalEnabled: true, approvalThreshold: 5000 }, 5000.01)).toBe(true);
    expect(needsApproval({ approvalEnabled: true, approvalThreshold: 0 }, 1)).toBe(true);
  });
  it("padrões: sem aprovação, limite R$ 5.000, categoria fornecedor, 30 dias", () => {
    expect(normalizePurchaseSettings(null)).toEqual({ approvalEnabled: false, approvalThreshold: 5000, payableCategory: "fornecedor", paymentDays: 30, stored: false });
    expect(normalizePurchaseSettings({ approvalEnabled: true, approvalThreshold: -1, paymentDays: 999 })).toMatchObject({ approvalEnabled: true, approvalThreshold: 5000, paymentDays: 30, stored: true });
  });
});

describe("pedido", () => {
  it("total, situação pelo recebido e vencimento", () => {
    expect(orderTotal([{ quantity: 3, unitCost: 10.1 }, { quantity: 1, unitCost: 0.2 }])).toBe(30.5);
    expect(statusAfterReceipt([{ quantity: 2, received: 0 }])).toBe("aprovado");
    expect(statusAfterReceipt([{ quantity: 2, received: 1 }, { quantity: 1, received: 1 }])).toBe("parcial");
    expect(statusAfterReceipt([{ quantity: 2, received: 2 }, { quantity: 1, received: 1 }])).toBe("recebido");
    expect(payableDueDate("2026-10-27", 30)).toBe("2026-11-26");
    expect(payableDueDate("2026-12-15", 0)).toBe("2026-12-15");
  });
});
