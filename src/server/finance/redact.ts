/**
 * "Visualizar valores" (A13, `financeiro.valores.ver` / `financeiro.contratos.valores.ver`): sem a permissão o
 * SERVIDOR não envia números ao cliente. Estas funções puras devolvem cópias com os valores zerados (e textos livres
 * com "R$ …" mascarados); a interface mostra "Restrito" pelo sinal `hideValues`/`valuesHidden` — nunca "R$ 0,00".
 *
 * Os dados originais continuam no servidor para as regras (gate, hash do documento, cobranças): redija só o que vai
 * para a tela, DEPOIS de calcular o que depende dos valores.
 */
import type { Billing, Contract, ContractAmendment, ContractSnapshot, ProposalItem } from "@/domain/types";

/** Texto que substitui quantias em textos livres (títulos de eventos, mensagens, condições). */
export const MASKED_AMOUNT = "R$ (restrito)";

const MONEY_PATTERN = /R\$\s?-?[\d.]+(?:,\d{1,2})?(?:\s?(?:mil|mi|bi))?/gi;

/** Mascara quantias ("R$ 1.234,56") num texto livre. */
export function maskMoneyText<T extends string | undefined>(text: T): T {
  return (text ? text.replace(MONEY_PATTERN, MASKED_AMOUNT) : text) as T;
}

export function redactItems<T extends Pick<ProposalItem, "setupValue" | "monthlyValue" | "hardwareValue">>(items: readonly T[]): T[] {
  return items.map((i) => ({ ...i, setupValue: 0, monthlyValue: 0, hardwareValue: 0 }));
}

export function redactSnapshot(s: ContractSnapshot): ContractSnapshot {
  return { ...s, items: redactItems(s.items), setupTotal: 0, monthlyTotal: 0, hardwareTotal: 0, paymentCondition: maskMoneyText(s.paymentCondition) };
}

/** Contrato sem valores: itens, totais, versões anteriores e condição de pagamento (texto livre). */
export function redactContract(c: Contract): Contract {
  return {
    ...c,
    items: redactItems(c.items),
    setupTotal: 0,
    monthlyTotal: 0,
    hardwareTotal: 0,
    paymentCondition: maskMoneyText(c.paymentCondition),
    previousVersions: c.previousVersions?.map((v) => ({ ...v, snapshot: redactSnapshot(v.snapshot) })),
  };
}

/** Campos monetários de `changes` do aditivo que saem inteiros (os itens ficam só com nomes e quantidades). */
const MONEY_CHANGE_FIELDS = new Set(["setupTotal", "monthlyTotal", "hardwareTotal"]);

export function redactAmendment(a: ContractAmendment): ContractAmendment {
  const changes: ContractAmendment["changes"] = {};
  for (const [field, change] of Object.entries(a.changes ?? {})) {
    if (MONEY_CHANGE_FIELDS.has(field)) continue;
    if (field === "items") {
      const redact = (v: unknown) => (Array.isArray(v) ? redactItems(v as ProposalItem[]) : v);
      changes[field] = { from: redact(change.from), to: redact(change.to) };
    } else if (field === "paymentCondition") {
      changes[field] = { from: typeof change.from === "string" ? maskMoneyText(change.from) : change.from, to: typeof change.to === "string" ? maskMoneyText(change.to) : change.to };
    } else changes[field] = change;
  }
  return { ...a, before: redactSnapshot(a.before), after: redactSnapshot(a.after), changes, reason: maskMoneyText(a.reason) };
}

/**
 * Cobrança sem valores. A linha digitável, o código de barras e o PIX copia-e-cola codificam o valor: saem também
 * (o estado do boleto continua pelo nosso número/emissão).
 */
export function redactBilling<T extends Partial<Billing> & Pick<Billing, "amount">>(b: T): T {
  return {
    ...b,
    amount: 0,
    ...(b.paidAmount !== undefined ? { paidAmount: 0 } : {}),
    ...(b.partialPaidAmount !== undefined ? { partialPaidAmount: 0 } : {}),
    ...(b.reversedPayments ? { reversedPayments: b.reversedPayments.map((r) => ({ ...r, paidAmount: 0 })) } : {}),
    ...(b.boleto ? { boleto: { ...b.boleto, linhaDigitavel: restricted(b.boleto.linhaDigitavel), codigoBarras: restricted(b.boleto.codigoBarras) } } : {}),
    ...(b.pix ? { pix: { ...b.pix, copiaECola: restricted(b.pix.copiaECola) } } : {}),
  };
}

/** Marca "restrito" no lugar do código (mantém o "boleto emitido" de boletoState sem expor o conteúdo). */
function restricted(value: string | undefined): string | undefined {
  return value ? RESTRICTED_CODE : undefined;
}

/** Conteúdo de código de boleto/PIX ocultado (os diálogos de boleto só aparecem com "Visualizar valores"). */
export const RESTRICTED_CODE = "restrito";
