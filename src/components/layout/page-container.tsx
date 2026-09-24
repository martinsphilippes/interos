import { cn } from "@/lib/utils";

export interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** "default" 1440px · "narrow" 960px (formulários, leitura) · "full" sem limite (kanban, tabelas largas). */
  size?: "default" | "narrow" | "full";
}

/** Container padrão de página: padding responsivo e largura máxima. */
export function PageContainer({ className, size = "default", ...props }: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 py-4 md:px-6 md:py-6 lg:px-8",
        size === "default" && "max-w-[1440px]",
        size === "narrow" && "max-w-[960px]",
        className,
      )}
      {...props}
    />
  );
}
