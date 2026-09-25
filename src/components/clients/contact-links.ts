/**
 * Links de contato (tel: e wa.me). Módulo puro: usado por Server Components (cabeçalho da ficha)
 * e por Client Components (diálogo de contato, card de contatos).
 */

/** Número em dígitos com DDI 55 (para tel: e wa.me). */
export function toInternationalDigits(phone: string | undefined): string {
  const d = (phone ?? "").replace(/\D/g, "");
  if (!d) return "";
  return d.length <= 11 ? `55${d}` : d;
}

export function whatsappHref(phone: string | undefined): string | null {
  const d = toInternationalDigits(phone);
  return d ? `https://wa.me/${d}` : null;
}

export function telHref(phone: string | undefined): string | null {
  const d = toInternationalDigits(phone);
  return d ? `tel:+${d}` : null;
}
