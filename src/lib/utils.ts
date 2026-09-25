import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Gera um id curto para itens embutidos (checklist, ações de plano). */
export function shortId(prefix = ""): string {
  const random = Math.random().toString(36).slice(2, 8);
  return prefix ? `${prefix}_${random}` : random;
}
