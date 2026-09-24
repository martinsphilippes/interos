import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-medium leading-none [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-navy-900 text-white",
        success: "border-transparent bg-success-soft text-success-fg",
        warning: "border-transparent bg-warning-soft text-warning-fg",
        danger: "border-transparent bg-danger-soft text-danger-fg",
        info: "border-transparent bg-info-soft text-info-fg",
        brand: "border-transparent bg-brand-soft text-brand-fg",
        outline: "border-border-strong bg-surface text-foreground",
        muted: "border-transparent bg-surface-hover text-muted",
      },
      size: {
        sm: "h-5 px-2 text-[11px]",
        md: "h-6 px-2.5 text-xs",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}
