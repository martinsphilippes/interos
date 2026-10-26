import { dateKey } from "@/lib/format";
import type { Contract } from "@/domain/types";

/**
 * Data que conta o reajuste anual (AAAA-MM-DD, fuso de São Paulo): a ASSINATURA do contrato (dia em que todos
 * assinaram); contrato sem assinatura registrada no sistema (antigo, ou liberado sem assinatura), o início da vigência.
 * As datas-base são os aniversários dela (+12, 24, 36… meses).
 */
export function readjustmentBaseDate(contract: Pick<Contract, "signedAt" | "startDate">): string | null {
  const value = contract.signedAt || contract.startDate;
  return value ? dateKey(value) : null;
}

/** De onde vem a data-base, para a tela: "assinatura" ou "início da vigência". */
export function readjustmentBaseLabel(contract: Pick<Contract, "signedAt" | "startDate">): "assinatura" | "início da vigência" | null {
  if (contract.signedAt) return "assinatura";
  return contract.startDate ? "início da vigência" : null;
}
