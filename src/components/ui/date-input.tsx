import * as React from "react";
import { cn } from "@/lib/utils";
import { inputClassName } from "./input";

export interface DateInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** "date" (AAAA-MM-DD) ou "datetime-local" (AAAA-MM-DDTHH:mm). */
  mode?: "date" | "datetime-local" | "time";
  invalid?: boolean;
}

/** Input de data/hora nativo estilizado. Converta ISO <-> valor local antes de usar. */
export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(({ className, mode = "date", invalid, ...props }, ref) => (
  <input ref={ref} type={mode} aria-invalid={invalid || undefined} className={cn(inputClassName, "min-w-0 tabular-nums", className)} {...props} />
));
DateInput.displayName = "DateInput";

/** ISO -> valor aceito por <input type="datetime-local"> no fuso do navegador. */
export function isoToDateTimeLocal(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO -> "AAAA-MM-DD" (fuso do navegador). */
export function isoToDateValue(iso: string | undefined | null): string {
  return isoToDateTimeLocal(iso).slice(0, 10);
}

/** Valor de input (date ou datetime-local) -> ISO. Vazio -> undefined. */
export function dateValueToIso(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const d = new Date(value.length === 10 ? `${value}T00:00` : value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
