/**
 * Exibição de valores com "Visualizar valores" (A13): sem a permissão, o servidor zera os números antes de enviar e
 * marca o dado como restrito; a interface mostra "Restrito" no lugar do valor (nunca "R$ 0,00").
 */
import { formatCurrency } from "@/lib/format";

export const RESTRICTED_LABEL = "Restrito";
export const RESTRICTED_HINT = "Seu perfil não tem a permissão Visualizar valores.";

/** Valor em reais, ou "Restrito" quando os valores estão ocultos. */
export function money(value: number, hidden: boolean | undefined, compact?: boolean): string {
  return hidden ? RESTRICTED_LABEL : formatCurrency(value, compact);
}
