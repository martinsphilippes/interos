"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}

/** Paginação simples em memória: "1–20 de 137" + anterior/próxima. */
export function Pagination({ page, pageSize, total, onPageChange, className }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);
  return (
    <div className={cn("flex items-center justify-between gap-3 text-sm text-muted", className)}>
      <span className="tabular-nums">
        {from}–{to} de {total}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="size-8" onClick={() => onPageChange(current - 1)} disabled={current <= 1} aria-label="Página anterior">
          <ChevronLeft />
        </Button>
        <span className="min-w-[72px] text-center tabular-nums">
          {current} / {pages}
        </span>
        <Button variant="outline" size="icon" className="size-8" onClick={() => onPageChange(current + 1)} disabled={current >= pages} aria-label="Próxima página">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/** Fatia um array para a página atual. */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (Math.max(1, page) - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
