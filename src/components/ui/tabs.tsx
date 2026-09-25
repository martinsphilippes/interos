"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

/** Lista de abas. `variant="line"` (padrão, sublinhado e texto laranja) ou `variant="pills"` (pílula laranja preenchida). */
export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { variant?: "line" | "pills" }
>(({ className, variant = "line", ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    data-variant={variant}
    className={cn(
      "group/tabs inline-flex max-w-full items-center overflow-x-auto scrollbar-none",
      variant === "line" ? "gap-1 border-b border-border" : "gap-1 rounded-lg border border-border bg-surface-muted p-1",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<React.ComponentRef<typeof TabsPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
  ({ className, ...props }, ref) => (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap text-sm font-medium text-muted transition-colors",
        "hover:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
        // line
        "group-data-[variant=line]/tabs:-mb-px group-data-[variant=line]/tabs:border-b-2 group-data-[variant=line]/tabs:border-transparent group-data-[variant=line]/tabs:px-3",
        "group-data-[variant=line]/tabs:data-[state=active]:border-brand group-data-[variant=line]/tabs:data-[state=active]:text-brand-fg",
        // pills
        "group-data-[variant=pills]/tabs:min-h-8 group-data-[variant=pills]/tabs:rounded-md group-data-[variant=pills]/tabs:px-3",
        "group-data-[variant=pills]/tabs:data-[state=active]:bg-brand group-data-[variant=pills]/tabs:data-[state=active]:text-white group-data-[variant=pills]/tabs:data-[state=active]:shadow-brand",
        className,
      )}
      {...props}
    />
  ),
);
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<React.ComponentRef<typeof TabsPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(
  ({ className, ...props }, ref) => <TabsPrimitive.Content ref={ref} className={cn("mt-4 focus-visible:outline-none", className)} {...props} />,
);
TabsContent.displayName = "TabsContent";
