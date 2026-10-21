/**
 * Identidade de telefone e e-mail usada para reconhecer o mesmo contato em qualquer canal (Central de Atendimento,
 * Caixa de Entrada, cadastro de leads). Puro: sem servidor.
 *
 * Brasil: o WhatsApp entrega muitos celulares SEM o 9 inicial ("55 88 9811-2040" em vez de "55 88 9 9811-2040"), e o
 * cadastro pode ter qualquer um dos dois. A chave canônica é DDD + os 8 últimos dígitos, o que une as duas formas
 * (fixo e celular de 8 dígitos já estão nesse formato).
 */

/** Só os dígitos. */
export function digitsOnly(value: string | undefined | null): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Número nacional (sem o DDI 55 e sem o zero de discagem), só dígitos. */
export function nationalNumber(value: string | undefined | null): string {
  let d = digitsOnly(value);
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if ((d.length === 11 || d.length === 12) && d.startsWith("0")) d = d.slice(1);
  return d;
}

/**
 * Chave canônica do telefone: DDD + 8 últimos dígitos ("8898112040"). Números sem DDD (8 ou 9 dígitos) ficam só com
 * os 8 últimos. Vazio quando não há dígitos suficientes para identificar alguém (menos de 8).
 */
export function phoneIdentity(value: string | undefined | null): string {
  const d = nationalNumber(value);
  if (d.length < 8) return "";
  if (d.length === 10 || d.length === 11) return `${d.slice(0, 2)}${d.slice(-8)}`;
  return d.slice(-8);
}

/** Os dois telefones são o mesmo número (com ou sem DDI, com ou sem o 9 extra)? */
export function samePhoneNumber(a: string | undefined | null, b: string | undefined | null): boolean {
  const ka = phoneIdentity(a);
  const kb = phoneIdentity(b);
  if (!ka || !kb) return false;
  // Um dos lados sem DDD: compara só os 8 últimos dígitos.
  if (ka.length !== kb.length) return ka.slice(-8) === kb.slice(-8);
  return ka === kb;
}

/** E-mail comparável (minúsculo, sem espaços). Vazio se não parece e-mail. */
export function emailIdentity(value: string | undefined | null): string {
  const v = (value ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : "";
}

/** Chave de contato da conversa: `p:<telefone canônico>` ou `e:<e-mail>`. */
export function contactKeyOf(channel: "whatsapp" | "email", address: string): string {
  if (channel === "email") {
    const e = emailIdentity(address);
    return e ? `e:${e}` : "";
  }
  const p = phoneIdentity(address);
  return p ? `p:${p}` : "";
}

/** Telefone mascarado para registros técnicos: "(88) •••••-2040". */
export function maskPhone(value: string | undefined | null): string {
  const d = nationalNumber(value);
  if (d.length < 4) return "•••";
  const ddd = d.length >= 10 ? `(${d.slice(0, 2)}) ` : "";
  return `${ddd}•••••-${d.slice(-4)}`;
}

/** E-mail mascarado: "jo•••@agropet.com.br". */
export function maskEmail(value: string | undefined | null): string {
  const v = (value ?? "").trim();
  const at = v.indexOf("@");
  if (at < 1) return "•••";
  return `${v.slice(0, Math.min(2, at))}•••${v.slice(at)}`;
}

/** Telefone para exibir: "(88) 99811-2040" (nacional, com máscara); sem dígitos suficientes, o próprio valor. */
export function displayPhone(value: string | undefined | null): string {
  const d = nationalNumber(value);
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return value ?? "";
}

/**
 * Celular no formato com o 9 (11 dígitos nacionais, com máscara): "(88) 99811-2040". Número de 10 dígitos cujo
 * primeiro dígito depois do DDD é 6–9 (celular antigo, como o WhatsApp entrega) ganha o 9; fixo e já-11 ficam como
 * estão.
 */
export function withNinthDigit(value: string | undefined | null): string {
  const d = nationalNumber(value);
  if (d.length === 10 && /^[6-9]$/.test(d[2])) return displayPhone(`${d.slice(0, 2)}9${d.slice(2)}`);
  return displayPhone(value);
}
