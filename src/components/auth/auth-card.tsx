import * as React from "react";
import { InterosMark } from "@/components/layout/logo";
import { cn } from "@/lib/utils";
import { AuthBrand } from "./auth-hero";

export interface AuthCardProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

/** Card translúcido das telas de acesso: ícone da marca, título e conteúdo. No celular mostra a marca acima. */
export function AuthCard({ title, description, children, className }: AuthCardProps) {
  return (
    <div className={cn("mx-auto w-full max-w-[460px]", className)}>
      <div className="mb-8 flex justify-center lg:hidden">
        <AuthBrand />
      </div>
      <div className="rounded-2xl border border-info/25 bg-surface/75 p-6 shadow-pop backdrop-blur-xl sm:p-8">
        <div className="flex flex-col items-center text-center">
          <span className="flex size-16 items-center justify-center rounded-2xl border border-border-strong bg-canvas/60 shadow-card" aria-hidden>
            <InterosMark className="size-9" />
          </span>
          <h2 className="mt-5 text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">{title}</h2>
          {description ? <p className="mt-1.5 text-sm text-muted sm:text-[15px]">{description}</p> : null}
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
