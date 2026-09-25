import { Avatar } from "./avatar";
import { cn } from "@/lib/utils";

export interface UserChipProps {
  name: string;
  avatarUrl?: string | null;
  /** Linha secundária (cargo, departamento). */
  subtitle?: string;
  size?: "sm" | "md";
  className?: string;
}

export function UserChip({ name, avatarUrl, subtitle, size = "md", className }: UserChipProps) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <Avatar name={name} src={avatarUrl} size={size === "sm" ? "xs" : "sm"} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className={cn("truncate text-foreground", size === "sm" ? "text-xs" : "text-sm")}>{name}</span>
        {subtitle && size === "md" ? <span className="truncate text-xs text-muted">{subtitle}</span> : null}
      </span>
    </span>
  );
}
