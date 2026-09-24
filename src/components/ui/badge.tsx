import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-md border font-medium leading-none [&_svg]:size-3",
  {
    variants: {
      /* Tingido com borda fina: fundo -soft, borda da cor a ~30%, texto -fg (legível no escuro). */
      variant: {
        default: "border-border-strong bg-surface-hover text-foreground",
        success: "border-success/30 bg-success-soft text-success-fg",
        warning: "border-warning/30 bg-warning-soft text-warning-fg",
        danger: "border-danger/35 bg-danger-soft text-danger-fg",
        info: "border-info/35 bg-info-soft text-info-fg",
        brand: "border-brand/35 bg-brand-soft text-brand-fg",
        purple: "border-accent-purple/35 bg-accent-purple-soft text-accent-purple-fg",
        secondary: "border-secondary/35 bg-secondary-soft text-secondary-fg",
        outline: "border-border-strong bg-transparent text-foreground",
        muted: "border-border bg-surface-hover text-muted",
        /* Sólido laranja (contador, "Novo"): texto branco sobre a cor. */
        solid: "border-transparent bg-brand text-white",
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
