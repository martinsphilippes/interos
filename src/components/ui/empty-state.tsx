import * as React from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  /** Botão/link de ação (ex.: <Button>Nova tarefa</Button>). */
  action?: React.ReactNode;
  className?: string;
  size?: "sm" | "md";
}

export function EmptyState({ icon, title, description, action, className, size = "md" }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", size === "sm" ? "px-4 py-8" : "px-6 py-14", className)}>
      <div className={cn("flex items-center justify-center rounded-xl border border-border-strong bg-surface-hover text-muted [&_svg]:size-6", size === "sm" ? "size-11" : "size-14")}>
        {icon ?? <Inbox />}
      </div>
      <h3 className={cn("mt-4 font-semibold text-foreground", size === "sm" ? "text-sm" : "text-base")}>{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
