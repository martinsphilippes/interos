import { PRIORITY_LABELS, type Priority } from "@/domain/constants";
import { Badge, type BadgeProps } from "./badge";
import { cn } from "@/lib/utils";

const priorityVariant: Record<Priority, NonNullable<BadgeProps["variant"]>> = {
  baixa: "muted",
  media: "info",
  alta: "warning",
  critica: "danger",
};

export interface PriorityBadgeProps {
  priority: Priority;
  size?: BadgeProps["size"];
  className?: string;
}

export function PriorityBadge({ priority, size = "sm", className }: PriorityBadgeProps) {
  return (
    <Badge variant={priorityVariant[priority]} size={size} className={cn("gap-1.5", className)}>
      {priority === "critica" ? <span className="size-1.5 rounded-full bg-danger" aria-hidden /> : null}
      {PRIORITY_LABELS[priority]}
    </Badge>
  );
}
