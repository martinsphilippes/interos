import * as React from "react";
import { cn } from "@/lib/utils";

export interface FilterBarProps {
  children: React.ReactNode;
  /** Ações alinhadas à direita (ex.: botão primário da página, "Limpar filtros"). */
  actions?: React.ReactNode;
  className?: string;
}

/** Linha de filtros (período, departamento, busca...). Em telas pequenas os campos quebram linha. */
export function FilterBar({ children, actions, className }: FilterBarProps) {
  return (
    <div role="group" aria-label="Filtros" className={cn("mb-5 flex flex-wrap items-end gap-3", className)}>
      {children}
      {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export interface FilterFieldProps {
  /** Rótulo pequeno acima do controle (ex.: "Período"). */
  label?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}

/** Campo da FilterBar: rótulo muted + controle (Select, SearchInput, DateInput). */
export function FilterField({ label, htmlFor, children, className }: FilterFieldProps) {
  return (
    <div className={cn("flex min-w-[160px] flex-col gap-1.5", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="text-xs font-medium text-muted">
          {label}
        </label>
      ) : null}
      {children}
    </div>
  );
}
