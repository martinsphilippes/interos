import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const sizeClass = { sm: "size-4", md: "size-6", lg: "size-8" } as const;

export function Spinner({ className, size = "md", label }: { className?: string; size?: keyof typeof sizeClass; label?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2 text-muted", className)}>
      <Loader2 className={cn("animate-spin", sizeClass[size])} aria-hidden />
      {label ? <span className="text-sm">{label}</span> : <span className="sr-only">Carregando</span>}
    </span>
  );
}

/** Spinner centralizado ocupando a área (para loading.tsx e painéis). */
export function LoadingBlock({ label = "Carregando…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex min-h-[240px] w-full items-center justify-center", className)}>
      <Spinner label={label} />
    </div>
  );
}
