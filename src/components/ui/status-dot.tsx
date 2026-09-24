import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "info" | "muted" | "brand" | "secondary";

const toneClass: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  muted: "bg-muted-light",
  brand: "bg-brand",
  secondary: "bg-secondary",
};

export interface StatusDotProps {
  tone: StatusTone;
  label?: React.ReactNode;
  /** Anel pulsante (para "ao vivo"/crítico). */
  pulse?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function StatusDot({ tone, label, pulse, size = "md", className }: StatusDotProps) {
  const dot = (
    <span className="relative inline-flex shrink-0">
      {pulse ? <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", toneClass[tone])} /> : null}
      <span className={cn("relative inline-flex rounded-full", size === "sm" ? "size-1.5" : "size-2", toneClass[tone])} />
    </span>
  );
  if (!label) return <span className={cn("inline-flex", className)}>{dot}</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm text-foreground", className)}>
      {dot}
      {label}
    </span>
  );
}
