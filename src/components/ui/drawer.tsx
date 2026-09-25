"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Drawer para detalhes (tarefa, etapa, cliente): painel lateral direito no desktop,
 * folha inferior no mobile. Header fixo, conteúdo rolável, footer opcional.
 */
export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

const sizeClass = {
  sm: "md:max-w-md",
  md: "md:max-w-xl",
  lg: "md:max-w-3xl",
  xl: "md:max-w-5xl",
} as const;

export type DrawerSize = keyof typeof sizeClass;

export interface DrawerContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  size?: DrawerSize;
  /** Lado no desktop (padrão: direita). */
  side?: "right" | "left";
  hideClose?: boolean;
}

export const DrawerContent = React.forwardRef<React.ComponentRef<typeof DialogPrimitive.Content>, DrawerContentProps>(
  ({ className, children, size = "md", side = "right", hideClose, ...props }, ref) => (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[3px] animate-fade-in" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed z-50 flex flex-col border-border-strong bg-card-elevated text-foreground shadow-drawer focus:outline-none max-md:border-t",
          // mobile: folha inferior
          "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl animate-slide-in-bottom",
          // desktop: painel lateral
          "md:inset-y-0 md:bottom-auto md:max-h-none md:h-dvh md:w-full md:rounded-none",
          side === "right" ? "md:right-0 md:left-auto md:animate-slide-in-right md:border-l" : "md:left-0 md:right-auto md:animate-slide-in-left md:border-r",
          "md:border-border-strong",
          sizeClass[size],
          className,
        )}
        {...props}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border-strong md:hidden" aria-hidden />
        {children}
        {!hideClose ? (
          <DialogPrimitive.Close
            className="absolute right-3 top-3 inline-flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-foreground md:size-8"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  ),
);
DrawerContent.displayName = "DrawerContent";

export function DrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex shrink-0 flex-col gap-1 border-b border-border-strong/70 px-5 py-4 pr-14", className)} {...props} />;
}

export function DrawerBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 overflow-y-auto px-5 py-4 scrollbar-thin", className)} {...props} />;
}

export function DrawerFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex shrink-0 flex-col-reverse gap-2 border-t border-border-strong/70 px-5 py-3 safe-bottom sm:flex-row sm:justify-end", className)} {...props} />;
}

export const DrawerTitle = React.forwardRef<React.ComponentRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  ({ className, ...props }, ref) => <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold leading-tight tracking-tight", className)} {...props} />,
);
DrawerTitle.displayName = "DrawerTitle";

export const DrawerDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted", className)} {...props} />);
DrawerDescription.displayName = "DrawerDescription";
