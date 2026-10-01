/**
 * Máscara de dinheiro em CENTAVOS (etapa CP/CR 4) — regras puras usadas pelo `MoneyInput` (src/components/ui) e pelos
 * testes. O usuário digita só números e a vírgula entra sozinha: "1250" → "12,50"; "125000" → "1.250,00". O valor real
 * (número em reais com centavos, ex.: 12.5) é o que vai para o servidor; o texto formatado é só exibição.
 *
 * - Qualquer caractere que não seja dígito é ignorado (colar "R$ 1.250,00" dá 1.250,00 — os dígitos formam os centavos).
 * - Com `allowNegative`, um "-" em qualquer posição do texto digitado deixa o valor negativo (ex.: saldo inicial de
 *   cartão); digitar "-" de novo volta a positivo (o texto exibido já traz o sinal, então o "-" extra some).
 * - Vazio (sem dígitos, ou só zeros) = null (campo não preenchido). Um valor 0 vindo de fora é exibido "0,00"; quem
 *   precisa de zero (saldo inicial) trata null como 0 ao salvar.
 */

/** Máximo de dígitos aceitos (até 99.999.999.999,99): evita números fora da precisão segura. */
export const MONEY_MAX_DIGITS = 13;

/** Formata um valor em reais para o campo: 1250.5 → "1.250,50"; -3 → "-3,00"; null → "". */
export function formatMoneyInput(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const cents = Math.round(Math.abs(value) * 100);
  const int = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const dec = String(cents % 100).padStart(2, "0");
  return `${value < 0 && cents > 0 ? "-" : ""}${int},${dec}`;
}

/**
 * Interpreta o texto digitado (já com a formatação anterior) como centavos. `previousNegative` é o sinal do valor antes
 * desta digitação (o "-" que já estava no texto não conta como um novo "-").
 */
export function parseMoneyInput(text: string, options: { allowNegative?: boolean; previousNegative?: boolean } = {}): number | null {
  const digits = text.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, MONEY_MAX_DIGITS);
  let negative = false;
  if (options.allowNegative) {
    const minus = (text.match(/-/g) ?? []).length;
    // O texto anterior já tinha um "-" (valor negativo): um "-" a mais desfaz o sinal; nenhum (apagado) também.
    negative = options.previousNegative ? minus === 1 : minus % 2 === 1;
  }
  if (!digits) return null;
  const cents = Number(digits);
  // Só zeros (ex.: apagar "0,05" até "0,0") esvazia o campo: o próximo dígito recomeça dos centavos.
  if (!Number.isFinite(cents) || cents === 0) return null;
  const value = cents / 100;
  return negative && value !== 0 ? -value : value;
}

/**
 * Um passo de digitação no campo (o que o `MoneyInput` faz a cada tecla): devolve o novo valor e se há um "-" pendente
 * (campo vazio com o sinal digitado antes dos números — o próximo dígito já nasce negativo).
 */
export function moneyInputStep(text: string, state: { value: number | null; negativeDraft?: boolean }, options: { allowNegative?: boolean } = {}): { value: number | null; negativeDraft: boolean } {
  const previousNegative = Boolean(state.negativeDraft) || (state.value !== null && state.value < 0);
  const value = parseMoneyInput(text, { allowNegative: options.allowNegative, previousNegative });
  if (value !== null || !options.allowNegative) return { value, negativeDraft: false };
  // Sem dígitos: guarda o sinal (texto "-" puro liga; "--" ou apagar desliga).
  const minus = (text.match(/-/g) ?? []).length;
  return { value: null, negativeDraft: previousNegative ? minus === 1 : minus % 2 === 1 };
}

/** Texto exibido no campo (com o "-" pendente quando o campo está vazio). */
export function moneyInputText(value: number | null, negativeDraft = false): string {
  return value === null && negativeDraft ? "-" : formatMoneyInput(value);
}

/** Arredonda em centavos (mesma regra dos serviços). */
export function moneyCents(value: number): number {
  return Math.round(value * 100);
}
