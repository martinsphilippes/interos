/**
 * Modelo do formulário de regras de comissão (cliente): formulário vazio, conversão para o payload das actions e os
 * rótulos "COM.xx" que resumem o que a regra combina. Sem regra de negócio de valor: quem calcula é o servidor.
 */
import type { RuleRow } from "@/server/commissions/queries";
import type { CommissionTrigger } from "@/domain/types";

export type RuleForm = RuleRow["form"];
export type RuleScope = RuleRow["scope"];

/** Gatilhos de adesão/hardware; recorrência escolhe só entre faturamento e pagamento (com ou sem carência). */
export const ONE_OFF_TRIGGERS: CommissionTrigger[] = ["venda", "contrato_assinado", "faturamento", "primeiro_pagamento", "pagamento", "permanencia", "pagamento_e_permanencia", "mensalidade_n"];
export const RECURRING_TRIGGERS: CommissionTrigger[] = ["pagamento", "pagamento_e_permanencia", "faturamento", "mensalidade_n"];

export function emptyRuleForm(scope: RuleScope = "padrao"): RuleForm {
  return {
    id: "",
    name: "",
    scope,
    revenueType: "setup",
    mode: "percentual",
    value: 10,
    trigger: "pagamento",
    baseSource: "contratado",
    minTenureDays: 0,
    recurringCompetences: 12,
    releaseInstallment: 1,
    overridesDefault: true,
    active: true,
    priority: null,
    baseKind: "liquido",
    deductions: [],
    referenceValue: null,
    baseCap: null,
    amountCap: null,
    installments: [],
    reverseOnCancel: false,
  };
}

/** "1, 3 e 6" / "1;3;6" / "1 3 6" → [1, 3, 6] (únicos, ordenados; ignora o que não é número). */
export function parseInstallments(text: string): number[] {
  return Array.from(new Set((text.match(/\d+/g) ?? []).map(Number).filter((n) => n >= 1 && n <= 120))).sort((a, b) => a - b);
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Formulário → entrada de saveCommissionRuleAction / rascunho do simulador. */
export function rulePayload(f: RuleForm, extra: { applyToPending?: boolean; installmentsMode?: "lista" | "faixa"; competencesText?: string } = {}) {
  const recurring = f.revenueType === "recorrencia";
  const list = recurring && extra.installmentsMode !== "faixa" ? f.installments : [];
  const trigger = recurring && !RECURRING_TRIGGERS.includes(f.trigger) ? "pagamento" : f.trigger;
  return {
    ...f,
    id: f.id || undefined,
    userId: f.scope === "vendedor" ? f.userId : undefined,
    contractId: f.scope === "contrato" ? f.contractId : undefined,
    trigger: list.length && trigger === "mensalidade_n" ? "pagamento" : trigger,
    recurringCompetences: recurring && !list.length ? (extra.competencesText?.trim() ? Number(extra.competencesText) : null) : null,
    releaseInstallment: Number(f.releaseInstallment) || 1,
    installments: list,
    value: Number(f.value),
    minTenureDays: Number(f.minTenureDays) || 0,
    priority: num(f.priority),
    referenceValue: f.baseKind === "referencia" ? num(f.referenceValue) : null,
    baseCap: f.mode === "percentual" ? num(f.baseCap) : null,
    amountCap: num(f.amountCap),
    deductions: f.baseKind === "liquido" ? f.deductions.filter((d) => d.label.trim() && Number(d.value) > 0).map((d) => ({ ...d, value: Number(d.value) })) : [],
    applyToPending: Boolean(extra.applyToPending),
  };
}

/** Rótulos COM.xx do que a regra combina (lista e formulário). */
export function ruleTags(f: Pick<RuleForm, "revenueType" | "baseCap" | "amountCap" | "installments" | "baseKind" | "deductions" | "productId" | "planId" | "scope">, isService: (productId: string) => boolean): string[] {
  const tags: string[] = [];
  if (f.revenueType === "setup") tags.push("COM.01 Adesão");
  if (f.baseCap) tags.push("COM.02 Teto da base");
  if (f.revenueType === "recorrencia" && f.installments.length) tags.push("COM.03 Mensalidade específica");
  if (f.baseKind !== "liquido" || f.deductions.length) tags.push(`COM.04 Base ${f.baseKind === "bruto" ? "bruta" : f.baseKind === "referencia" ? "de referência" : "líquida"}`);
  if (f.productId) tags.push(isService(f.productId) ? "COM.06 Serviço" : "COM.05 Produto");
  if (f.planId) tags.push("COM.07 Plano");
  if (f.scope === "vendedor") tags.push("COM.08 Vendedor");
  if (f.amountCap) tags.push("Teto da comissão");
  return tags;
}
