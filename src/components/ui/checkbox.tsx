"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps extends React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  label?: React.ReactNode;
  description?: React.ReactNode;
}

export const Checkbox = React.forwardRef<React.ComponentRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(
  ({ className, label, description, id, ...props }, ref) => {
    const generated = React.useId();
    const checkboxId = id ?? generated;
    const box = (
      <CheckboxPrimitive.Root
        ref={ref}
        id={checkboxId}
        className={cn(
          "peer size-4 shrink-0 rounded-xs border border-border-strong bg-surface shadow-xs transition-colors",
          "hover:border-brand focus-visible:ring-2 focus-visible:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-50",
          "data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-white",
          "data-[state=indeterminate]:border-brand data-[state=indeterminate]:bg-brand data-[state=indeterminate]:text-white",
          !label && className,
        )}
        {...props}
      >
        <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
          {props.checked === "indeterminate" ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    );
    if (!label) return box;
    return (
      <label htmlFor={checkboxId} className={cn("flex min-h-[44px] cursor-pointer items-start gap-2.5 py-2 md:min-h-0 md:py-0", className)}>
        <span className="mt-0.5 flex">{box}</span>
        <span className="flex flex-col gap-0.5">
          <span className="text-sm leading-tight text-foreground">{label}</span>
          {description ? <span className="text-xs text-muted">{description}</span> : null}
        </span>
      </label>
    );
  },
);
Checkbox.displayName = "Checkbox";
