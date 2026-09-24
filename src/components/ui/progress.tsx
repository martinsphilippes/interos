"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

export type ProgressTone = "brand" | "success" | "warning" | "danger" | "info" | "secondary";

const toneClass: Record<ProgressTone, string> = {
  brand: "bg-brand",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  secondary: "bg-secondary",
};

export interface ProgressProps extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  /** 0 a 100. */
  value?: number;
  tone?: ProgressTone;
  size?: "sm" | "md";
  /** Mostra o percentual à direita. */
  showValue?: boolean;
}

export const Progress = React.forwardRef<React.ComponentRef<typeof ProgressPrimitive.Root>, ProgressProps>(
  ({ className, value = 0, tone = "brand", size = "md", showValue, ...props }, ref) => {
    const pct = Math.max(0, Math.min(100, value));
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <ProgressPrimitive.Root
          ref={ref}
          value={pct}
          className={cn("relative w-full overflow-hidden rounded-full bg-surface-hover", size === "sm" ? "h-1.5" : "h-2")}
          {...props}
        >
          <ProgressPrimitive.Indicator className={cn("h-full rounded-full transition-[width] duration-300", toneClass[tone])} style={{ width: `${pct}%` }} />
        </ProgressPrimitive.Root>
        {showValue ? <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted">{Math.round(pct)}%</span> : null}
      </div>
    );
  },
);
Progress.displayName = "Progress";
