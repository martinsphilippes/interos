import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "./label";

export interface FormFieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
  /** Layout lado a lado (rótulo à esquerda) em telas médias+. */
  inline?: boolean;
}

/** Wrapper de campo: rótulo + controle + dica/erro. */
export function FormField({ label, htmlFor, required, error, hint, className, children, inline }: FormFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", inline && "md:grid md:grid-cols-[180px_1fr] md:items-start md:gap-4", className)}>
      {label ? (
        <Label htmlFor={htmlFor} required={required} className={cn(inline && "md:pt-2.5")}>
          {label}
        </Label>
      ) : null}
      <div className="flex flex-col gap-1.5">
        {children}
        {error ? (
          <p className="text-xs text-danger-fg" role="alert">
            {error}
          </p>
        ) : hint ? (
          <p className="text-xs text-muted">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}
