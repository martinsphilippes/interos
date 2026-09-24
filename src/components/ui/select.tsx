import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { FormField } from "./form-field";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  options?: SelectOption[];
  placeholder?: string;
  invalid?: boolean;
  size?: "sm" | "md";
}

/** Select nativo estilizado. Use `options` ou passe <option> como filhos. */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, placeholder, invalid, size = "md", children, ...props }, ref) => (
    <div className={cn("relative w-full", className)}>
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "w-full appearance-none rounded-lg border border-border bg-surface pl-3 pr-9 text-sm text-foreground shadow-xs transition-colors",
          "hover:border-border-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25",
          "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70 aria-invalid:border-danger",
          size === "sm" ? "h-8 text-[13px]" : "h-9",
        )}
        {...props}
      >
        {placeholder !== undefined ? (
          <option value="" disabled={props.required}>
            {placeholder}
          </option>
        ) : null}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
    </div>
  ),
);
Select.displayName = "Select";

export interface SelectFieldProps extends SelectProps {
  label: string;
  error?: string;
  hint?: string;
  fieldClassName?: string;
}

/** Select com rótulo, dica e erro (usa FormField). */
export const SelectField = React.forwardRef<HTMLSelectElement, SelectFieldProps>(({ label, error, hint, id, required, fieldClassName, ...props }, ref) => {
  const generated = React.useId();
  const selectId = id ?? generated;
  return (
    <FormField label={label} htmlFor={selectId} error={error} hint={hint} required={required} className={fieldClassName}>
      <Select ref={ref} id={selectId} invalid={Boolean(error)} required={required} {...props} />
    </FormField>
  );
});
SelectField.displayName = "SelectField";
