import * as React from "react";
import { cn } from "@/lib/utils";

export const inputClassName =
  "flex h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground shadow-xs transition-colors " +
  "hover:border-border-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 " +
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70 " +
  "aria-invalid:border-danger aria-invalid:focus:ring-danger/25 file:border-0 file:bg-transparent file:text-sm file:font-medium";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Ícone à esquerda (lucide). */
  leadingIcon?: React.ReactNode;
  /** Elemento à direita (ícone, botão pequeno). */
  trailing?: React.ReactNode;
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, leadingIcon, trailing, invalid, type = "text", ...props }, ref) => {
  if (!leadingIcon && !trailing) {
    return <input ref={ref} type={type} aria-invalid={invalid || undefined} className={cn(inputClassName, className)} {...props} />;
  }
  return (
    <div className="relative w-full">
      {leadingIcon ? (
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted [&_svg]:size-4">{leadingIcon}</span>
      ) : null}
      <input
        ref={ref}
        type={type}
        aria-invalid={invalid || undefined}
        className={cn(inputClassName, leadingIcon && "pl-9", trailing && "pr-9", className)}
        {...props}
      />
      {trailing ? <span className="absolute inset-y-0 right-0 flex items-center pr-2 text-muted [&_svg]:size-4">{trailing}</span> : null}
    </div>
  );
});
Input.displayName = "Input";
