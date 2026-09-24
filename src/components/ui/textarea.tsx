import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, invalid, ...props }, ref) => (
  <textarea
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(
      "flex min-h-[88px] w-full rounded-lg border border-border-strong bg-surface-muted px-3 py-2 text-sm text-foreground transition-colors",
      "hover:border-muted-light/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25",
      "disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger aria-invalid:focus:ring-danger/25",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
