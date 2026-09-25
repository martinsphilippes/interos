import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumbs?: Breadcrumb[];
  /** Botões à direita (ex.: <Button>Nova tarefa</Button>). */
  actions?: React.ReactNode;
  /** Conteúdo abaixo do título (abas, filtros, segmented-control). */
  children?: React.ReactNode;
  /** Ícone/badge ao lado do título. */
  badge?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, breadcrumbs, actions, children, badge, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-5 flex flex-col gap-3", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Navegação estrutural" className="flex items-center gap-1 text-xs text-muted">
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={`${crumb.label}-${i}`}>
              {i > 0 ? <ChevronRight className="size-3.5 text-muted-light" aria-hidden /> : null}
              {crumb.href ? (
                <Link href={crumb.href} className="truncate transition-colors hover:text-foreground">
                  {crumb.label}
                </Link>
              ) : (
                <span className="truncate text-foreground">{crumb.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[22px] font-semibold leading-tight tracking-tight text-foreground md:text-[28px] md:leading-9">{title}</h1>
            {badge}
          </div>
          {description ? <p className="mt-1 text-sm text-muted md:text-[15px]">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
