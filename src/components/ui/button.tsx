"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors select-none " +
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4",
  {
    variants: {
      variant: {
        /* Ação principal: laranja sólido com brilho suave. Uma por área. */
        primary: "bg-brand text-white shadow-brand hover:bg-brand-hover active:bg-brand-active",
        /* Ação neutra preenchida (superfície elevada). */
        secondary: "border border-border-strong bg-surface-hover text-foreground shadow-card hover:bg-card-elevated hover:border-muted-light/50",
        /* Ação secundária: contorno claro sobre o escuro. */
        outline: "border border-border-strong bg-transparent text-foreground hover:bg-surface-hover hover:border-muted-light/60",
        ghost: "text-foreground hover:bg-surface-hover",
        destructive: "bg-danger-strong text-white shadow-card hover:bg-danger-hover",
        /* Confirmação positiva (ganho, aceite, pagamento). */
        success: "bg-success-strong text-white shadow-card hover:bg-success-hover",
        link: "text-brand-fg underline-offset-4 hover:underline h-auto px-0",
      },
      size: {
        sm: "h-8 px-3 text-[13px] [&_svg]:size-3.5",
        md: "h-9 px-4 text-sm",
        lg: "h-11 px-5 text-[15px]",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Renderiza o filho como elemento raiz (ex.: <Link>). */
  asChild?: boolean;
  /** Mostra spinner e desabilita. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? "button")}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";
