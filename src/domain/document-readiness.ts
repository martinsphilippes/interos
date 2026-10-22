/**
 * Pendências do modelo no contrato agrupadas por ONDE se corrige (painel do cartão Assinatura): cada grupo vira um
 * item com um botão que leva ao lugar exato — ou resolve ali mesmo (CPF do representante). Só regra, sem tela.
 */
import type { TemplateDataGap } from "./contract-templates";

/**
 * - `representante`: quem assina pelo cliente e o CPF dele (signatários do contrato / contato do cliente);
 * - `cliente`: razão social, CNPJ/CPF, e-mail e endereço (cartão «Cliente e faturamento» do contrato);
 * - `itens`: produtos e valores (cartão de itens); `condicoes`: prazo, vencimento, pagamento (cartão de condições);
 * - `intercert`: quem assina pela Intercert (Assinaturas › Configuração);
 * - `modelo`: variável sem ligação ou com dado que só existe depois da liberação (Assinaturas › Modelos).
 */
export type FixTarget = "representante" | "cliente" | "itens" | "condicoes" | "intercert" | "modelo";

export interface FixGroup {
  target: FixTarget;
  gaps: TemplateDataGap[];
}

const ORDER: FixTarget[] = ["representante", "cliente", "itens", "condicoes", "intercert", "modelo"];

/** Onde se corrige uma pendência. */
export function fixTargetOf(gap: TemplateDataGap): FixTarget {
  if (gap.reason !== "sem_dado") return "modelo";
  switch (gap.source) {
    case "signatario":
    case "contato":
      return "representante";
    case "cliente":
      return "cliente";
    case "intercert":
      return "intercert";
    case "contrato":
      return gap.field === "contrato.itens" || gap.field === "contrato.produto" || gap.field?.startsWith("valores.") ? "itens" : "condicoes";
    default:
      return "modelo";
  }
}

/** Pendências agrupadas por onde se corrigem, na ordem em que o painel mostra (quem assina primeiro). */
export function groupReadinessGaps(gaps: TemplateDataGap[]): FixGroup[] {
  const groups = new Map<FixTarget, TemplateDataGap[]>();
  for (const gap of gaps) {
    const target = fixTargetOf(gap);
    groups.set(target, [...(groups.get(target) ?? []), gap]);
  }
  return ORDER.filter((t) => groups.has(t)).map((target) => ({ target, gaps: groups.get(target)! }));
}
