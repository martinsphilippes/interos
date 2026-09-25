import * as React from "react";
import { cn } from "@/lib/utils";

const columnsClass = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 xl:grid-cols-4",
  5: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
  6: "sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6",
} as const;

export interface KpiStripProps {
  children: React.ReactNode;
  /** Quantidade de cards na linha em telas largas (padrão 4). */
  columns?: keyof typeof columnsClass;
  /** Colunas no celular (padrão 1; use 2 com StatCard compact). */
  mobileColumns?: 1 | 2;
  className?: string;
}

/** Linha responsiva de StatCards no topo das páginas de painel. */
export function KpiStrip({ children, columns = 4, mobileColumns = 1, className }: KpiStripProps) {
  return <div className={cn("mb-5 grid gap-3 md:gap-4", mobileColumns === 2 ? "grid-cols-2" : "grid-cols-1", columnsClass[columns], className)}>{children}</div>;
}
