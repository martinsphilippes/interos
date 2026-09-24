"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputClassName } from "./input";

export interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "size"> {
  value: string;
  onChange: (value: string) => void;
  /** Atraso (ms) para chamar onChange (0 = imediato). */
  debounceMs?: number;
  size?: "sm" | "md";
}

/** Campo de busca com ícone, limpar e debounce opcional. */
export function SearchInput({ value, onChange, debounceMs = 0, placeholder = "Buscar…", className, size = "md", ...props }: SearchInputProps) {
  const [inner, setInner] = React.useState(value);
  const [prevValue, setPrevValue] = React.useState(value);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sincroniza com o valor controlado externo (padrão "ajustar estado durante a renderização").
  if (value !== prevValue) {
    setPrevValue(value);
    setInner(value);
  }

  const emit = (next: string) => {
    setInner(next);
    if (timer.current) clearTimeout(timer.current);
    if (debounceMs > 0) timer.current = setTimeout(() => onChange(next), debounceMs);
    else onChange(next);
  };

  return (
    <div className={cn("relative w-full", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        value={inner}
        onChange={(e) => emit(e.target.value)}
        placeholder={placeholder}
        className={cn(inputClassName, "pl-9 pr-8 [&::-webkit-search-cancel-button]:hidden", size === "sm" && "h-8 text-[13px]")}
        {...props}
      />
      {inner ? (
        <button
          type="button"
          onClick={() => emit("")}
          className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted hover:bg-surface-hover hover:text-foreground"
          aria-label="Limpar busca"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
