"use client";

import * as React from "react";
import { Building2, Check, ChevronsUpDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchInput } from "@/components/ui/search-input";
import { cn } from "@/lib/utils";
import type { ClientOption } from "./task-model";

export interface ClientComboboxProps {
  clients: ClientOption[];
  value?: string;
  onChange: (clientId: string | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  id?: string;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Seleção de cliente com busca simples por nome (lista carregada do servidor). */
export function ClientCombobox({ clients, value, onChange, placeholder = "Sem cliente", disabled, size = "md", className, id }: ClientComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const selected = value ? clients.find((c) => c.id === value) : undefined;
  const q = normalize(query.trim());
  const matches = (q ? clients.filter((c) => normalize(c.tradeName).includes(q)) : clients).slice(0, 60);

  const choose = (clientId: string | undefined) => {
    onChange(clientId);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg border border-border bg-surface pl-3 pr-2 text-left text-sm shadow-xs transition-colors",
            "hover:border-border-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-70",
            size === "sm" ? "h-8 text-[13px]" : "h-9",
            className,
          )}
        >
          <Building2 className="size-4 shrink-0 text-muted" aria-hidden />
          <span className={cn("flex-1 truncate", !selected && "text-muted-light")}>{selected?.tradeName ?? placeholder}</span>
          {selected && !disabled ? (
            <span
              role="button"
              tabIndex={0}
              aria-label="Limpar cliente"
              onClick={(e) => {
                e.stopPropagation();
                choose(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  choose(undefined);
                }
              }}
              className="inline-flex size-6 items-center justify-center rounded-sm text-muted hover:bg-surface-hover hover:text-foreground"
            >
              <X className="size-3.5" />
            </span>
          ) : (
            <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[260px] p-2">
        <SearchInput value={query} onChange={setQuery} placeholder="Buscar cliente…" size="sm" autoFocus />
        <ul role="listbox" className="mt-2 max-h-64 overflow-y-auto scrollbar-thin">
          <li>
            <button
              type="button"
              role="option"
              aria-selected={!selected}
              onClick={() => choose(undefined)}
              className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted hover:bg-surface-hover md:min-h-[34px]"
            >
              <span className="size-4" />
              {placeholder}
            </button>
          </li>
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={c.id === value}
                onClick={() => choose(c.id)}
                className="flex min-h-[40px] w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-surface-hover md:min-h-[34px]"
              >
                {c.id === value ? <Check className="size-4 text-brand" /> : <span className="size-4" />}
                <span className="flex-1 truncate">{c.tradeName}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 ? <li className="px-2 py-6 text-center text-sm text-muted">Nenhum cliente encontrado</li> : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
