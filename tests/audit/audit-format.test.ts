/**
 * Auditoria transversal (D29): formatação "campo: de → para", máscara de valores sensíveis/quantias, leitura do
 * formato antigo from/to e filtro do histórico do contrato (não mistura contratos do mesmo cliente).
 */
import { describe, expect, it } from "vitest";
import { auditChanges } from "@/server/audit";
import {
  MASKED_VALUE,
  RESTRICTED_VALUE,
  belongsToContractHistory,
  changeFieldLabel,
  changeLines,
  eventChanges,
  formatChangeValue,
  redactChanges,
  summarizeChanges,
} from "@/domain/audit-format";

describe("rótulos e valores", () => {
  it("usa o rótulo amigável, o do evento quando houver e o nome do campo como fallback", () => {
    expect(changeFieldLabel("billingDay")).toBe("Dia de vencimento");
    expect(changeFieldLabel("status")).toBe("Situação");
    expect(changeFieldLabel("managerId", { managerId: "gestor do departamento" })).toBe("Gestor do departamento");
    expect(changeFieldLabel("campoNovoQualquer")).toBe("campoNovoQualquer");
  });

  it("formata situação, datas, booleanos, quantias, listas de pessoas e vazio", () => {
    expect(formatChangeValue("status", "aberta")).toBe("Em aberto");
    expect(formatChangeValue("status", "cancelada")).toBe("Cancelada");
    expect(formatChangeValue("status", "pendencia")).toBe("Pendência");
    expect(formatChangeValue("firstDueDate", "2026-10-10T12:00:00.000Z")).toBe("10/10/2026");
    expect(formatChangeValue("cancelledAt", "2026-09-30T15:00:00.000Z")).toBe("30/09/2026");
    expect(formatChangeValue("autoRenew", true)).toBe("sim");
    expect(formatChangeValue("amount", 1234.5)).toMatch(/R\$\s?1\.234,50/);
    expect(formatChangeValue("billingDay", 15)).toBe("dia 15");
    expect(formatChangeValue("role", "financeiro")).toBe("Financeiro");
    expect(formatChangeValue("signers", [{ name: "Ana", email: "a@x" }, { name: "Bia", email: "b@x" }])).toBe("Ana, Bia");
    expect(formatChangeValue("signers", [])).toBe("nenhum");
    expect(formatChangeValue("pendingReason", null)).toBe("—");
    expect(formatChangeValue("pendingReason", "")).toBe("—");
  });

  it("salário nunca aparece em claro; quantias saem como Restrito sem 'Visualizar valores'", () => {
    expect(formatChangeValue("baseSalary", 8500)).toBe(MASKED_VALUE);
    expect(formatChangeValue("baseSalary", "8500")).toBe(MASKED_VALUE);
    // O serviço grava só o marcador textual — ele passa.
    expect(formatChangeValue("baseSalary", "novo valor")).toBe("novo valor");
    expect(formatChangeValue("amount", 99, { hideValues: true })).toBe(RESTRICTED_VALUE);
    expect(formatChangeValue("monthlyTotal", 99, { hideValues: true })).toBe(RESTRICTED_VALUE);
    expect(formatChangeValue("billingDay", 10, { hideValues: true })).toBe("dia 10");
  });
});

describe("linhas e resumo de → para", () => {
  const audit = auditChanges<Record<string, unknown>>({ status: "aberta", amount: 100, cancelReason: undefined }, { status: "cancelada", amount: 100, cancelReason: "Cliente desistiu" }, ["status", "amount", "cancelReason"], "Cliente desistiu");

  it("só os campos que mudaram, com rótulos e valores legíveis", () => {
    const lines = changeLines(audit.changes);
    expect(lines).toEqual([
      { field: "status", label: "Situação", from: "Em aberto", to: "Cancelada" },
      { field: "cancelReason", label: "Motivo do cancelamento", from: "—", to: "Cliente desistiu" },
    ]);
    expect(summarizeChanges(audit.changes)).toBe("Situação: Em aberto → Cancelada · Motivo do cancelamento: — → Cliente desistiu");
  });

  it("resumo limita o número de campos e indica o restante", () => {
    const many = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`f${i}`, { from: i, to: i + 1 }]));
    expect(summarizeChanges(many, { max: 2 })).toBe("f0: 0 → 1 · f1: 1 → 2 · (+3)");
  });

  it("redactChanges tira quantias do objeto e mascara sensíveis (o número não vai ao navegador)", () => {
    const red = redactChanges({ amount: { from: 100, to: null }, status: { from: "aberta", to: "paga" }, baseSalary: { from: 5000, to: 6000 } }, { hideValues: true })!;
    expect(red.amount).toEqual({ from: RESTRICTED_VALUE, to: null });
    expect(red.status).toEqual({ from: "aberta", to: "paga" });
    expect(red.baseSalary).toEqual({ from: MASKED_VALUE, to: MASKED_VALUE });
    expect(JSON.stringify(red)).not.toMatch(/5000|6000|100/);
    expect(redactChanges({ amount: { from: 100, to: 120 } }, { hideValues: false })!.amount).toEqual({ from: 100, to: 120 });
  });
});

describe("eventChanges (payload.changes ou formato antigo from/to)", () => {
  it("lê payload.changes e ignora entradas inválidas", () => {
    expect(eventChanges("billing.cancelled", { changes: { status: { from: "aberta", to: "cancelada" }, lixo: 3 } })).toEqual({ status: { from: "aberta", to: "cancelada" } });
    expect(eventChanges("contract.updated", { changes: {} })).toBeNull();
    expect(eventChanges("contract.updated", {})).toBeNull();
  });

  it("status_changed/stage_changed com from/to viram changes.status/stage", () => {
    expect(eventChanges("client.status_changed", { from: "em_implantacao", to: "ativo", reason: "x" })).toEqual({ status: { from: "em_implantacao", to: "ativo" } });
    expect(eventChanges("opportunity.stage_changed", { from: "proposta", to: "negociacao" })).toEqual({ stage: { from: "proposta", to: "negociacao" } });
    // from/to de pessoas (ids) em outros eventos não viram changes.
    expect(eventChanges("opportunity.reassigned", { from: "user_a", to: "user_b" })).toBeNull();
  });
});

describe("histórico do contrato não mistura contratos do mesmo cliente", () => {
  const related = new Set(["bill_ct1_m1", "cta_ct1_1", "proj_1", "opp_1"]);
  const belongs = (e: { type: string; entityId?: string; payload?: Record<string, unknown> }) => belongsToContractHistory(e, "ct1", related);

  it("entra: o próprio contrato, payload.contractId deste contrato, registros dele sem contractId", () => {
    expect(belongs({ type: "contract.updated", entityId: "ct1", payload: { contractId: "ct1" } })).toBe(true);
    expect(belongs({ type: "billing.cancelled", entityId: "bill_ct1_m1", payload: { contractId: "ct1" } })).toBe(true);
    expect(belongs({ type: "contract.amendment_applied", entityId: "cta_ct1_1", payload: { contractId: "ct1" } })).toBe(true);
    expect(belongs({ type: "renewal.completed", entityId: "ren_9", payload: { contractId: "ct1" } })).toBe(true);
    expect(belongs({ type: "implementation.created", entityId: "proj_1", payload: {} })).toBe(true);
    expect(belongs({ type: "opportunity.won", entityId: "opp_1" })).toBe(true);
  });

  it("não entra: outro contrato do cliente, eventos financeiros soltos e comissões/títulos (tela própria)", () => {
    expect(belongs({ type: "payment.approved", entityId: "bill_ct2_m1", payload: { contractId: "ct2" } })).toBe(false);
    // Mesmo com entityId relacionado, o contractId do payload manda.
    expect(belongs({ type: "payment.approved", entityId: "bill_ct1_m1", payload: { contractId: "ct2" } })).toBe(false);
    expect(belongs({ type: "note.added", entityId: "client_1", payload: {} })).toBe(false);
    expect(belongs({ type: "commission.calculated", entityId: "com_1", payload: { contractId: "ct1" } })).toBe(false);
    expect(belongs({ type: "payable.created", entityId: "pag_1", payload: { contractId: "ct1" } })).toBe(false);
  });
});

describe("exportação PDF (fonte padrão sem '→')", () => {
  it("troca símbolos fora do WinAnsi e corta células longas", async () => {
    const { pdfSafe } = await import("@/server/reports/export-pdf");
    expect(pdfSafe("Situação: Em aberto → Cancelada · ≥ 3 · −2")).toBe("Situação: Em aberto -> Cancelada · >= 3 · -2");
    expect(pdfSafe("x".repeat(10), 5)).toBe("xxxx…");
  });
});
