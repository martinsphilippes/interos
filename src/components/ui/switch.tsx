"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export interface SwitchProps extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  size?: "sm" | "md";
}

export const Switch = React.forwardRef<React.ComponentRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  ({ className, label, description, size = "md", id, ...props }, ref) => {
    const generated = React.useId();
    const switchId = id ?? generated;
    const control = (
      <SwitchPrimitive.Root
        ref={ref}
        id={switchId}
        className={cn(
          "peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
          "focus-visible:ring-2 focus-visible:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-50",
          "data-[state=checked]:bg-brand data-[state=unchecked]:bg-border-strong",
          size === "sm" ? "h-5 w-9" : "h-6 w-11",
          !label && className,
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "pointer-events-none block rounded-full bg-white shadow-card transition-transform data-[state=unchecked]:translate-x-0",
            size === "sm" ? "size-4 data-[state=checked]:translate-x-4" : "size-5 data-[state=checked]:translate-x-5",
          )}
        />
      </SwitchPrimitive.Root>
    );
    if (!label) return control;
    return (
      <label htmlFor={switchId} className={cn("flex min-h-[44px] cursor-pointer items-center justify-between gap-3 md:min-h-0", className)}>
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium leading-tight text-foreground">{label}</span>
          {description ? <span className="text-xs text-muted">{description}</span> : null}
        </span>
        {control}
      </label>
    );
  },
);
Switch.displayName = "Switch";
