/**
 * Utilitários puros do workspace do Suporte (servidor e navegador): destinos de contato, links de envio
 * manual (wa.me / tel: / mailto:) e formatação dos relógios de SLA.
 */
import type { TicketDetail } from "@/server/support/queries";
import { telHref, whatsappHref } from "@/components/clients/contact-links";

export interface ContactTarget {
  name: string;
  /** Contato do chamado (ou o principal do cliente). */
  contactName?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
}

/** Contato do chamado → contato principal → dados da empresa. */
export function contactTarget(detail: Pick<TicketDetail, "contact" | "contacts" | "client">): ContactTarget {
  const contact = detail.contact ?? detail.contacts.find((c) => c.isPrimary) ?? detail.contacts[0] ?? null;
  return {
    name: detail.client?.tradeName ?? "Cliente",
    contactName: contact?.name,
    phone: contact?.phone ?? contact?.whatsapp ?? detail.client?.phone ?? detail.client?.whatsapp,
    whatsapp: contact?.whatsapp ?? contact?.phone ?? detail.client?.whatsapp ?? detail.client?.phone,
    email: contact?.email ?? detail.client?.email,
  };
}

/** wa.me com texto pré-preenchido (o atendente envia pelo app; nada sai pelo sistema). */
export function whatsappTextHref(phone: string | undefined, text?: string): string | null {
  const base = whatsappHref(phone);
  if (!base) return null;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

export function mailtoHref(email: string | undefined, subject?: string, body?: string): string | null {
  if (!email) return null;
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  const qs = params.toString().replace(/\+/g, "%20");
  return `mailto:${email}${qs ? `?${qs}` : ""}`;
}

export { telHref };

/** Gravações de ligação só existem com VoIP conectado; URLs do antigo modo simulado não são gravações reais. */
export function isRealRecording(url: string | undefined): boolean {
  return Boolean(url) && !url!.includes("mock.intercert.com.br");
}

/** Relógio de SLA no formato da central: "00h 42min", "2d 03h" ou "-01h 10min" (vencido). */
export function formatSlaClock(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `${sign}${days}d ${pad(hours)}h`;
  return `${sign}${pad(hours)}h ${pad(minutes)}min`;
}

/** Duração curta: "3min", "1h 05min", "2d 4h". */
export function formatElapsed(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}min`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Abas da fila do atendente (parâmetro ?fila= na URL, usado também pelo drill-down dos indicadores). */
export const QUEUE_TABS = [
  { key: "todos", label: "Todos" },
  { key: "novos", label: "Novos" },
  { key: "atendimento", label: "Em atendimento" },
  { key: "aguardando", label: "Aguardando cliente" },
  { key: "risco", label: "Em risco" },
  { key: "criticos", label: "Críticos" },
] as const;
export type QueueTab = (typeof QUEUE_TABS)[number]["key"];

export function isQueueTab(value: string | undefined): value is QueueTab {
  return QUEUE_TABS.some((t) => t.key === value);
}
