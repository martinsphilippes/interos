import * as React from "react";
import { cn } from "@/lib/utils";

/** Em telas pequenas o wrapper rola horizontalmente. */
export const Table = React.forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement> & { wrapperClassName?: string }>(
  ({ className, wrapperClassName, ...props }, ref) => (
    <div className={cn("relative w-full overflow-x-auto scrollbar-thin", wrapperClassName)}>
      <table ref={ref} className={cn("w-full min-w-[640px] caption-bottom border-separate border-spacing-0 text-sm", className)} {...props} />
    </div>
  ),
);
Table.displayName = "Table";

/** Cabeçalho discreto: fundo um tom abaixo da superfície, texto muted. */
export const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("bg-surface-muted [&_th]:border-b [&_th]:border-border", className)} {...props} />
));
TableHeader.displayName = "TableHeader";

export const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child>td]:border-b-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

export const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <tfoot ref={ref} className={cn("bg-surface-muted font-medium [&_td]:border-t [&_td]:border-border", className)} {...props} />
));
TableFooter.displayName = "TableFooter";

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  clickable?: boolean;
  /** Linha selecionada: fundo laranja translúcido e contorno laranja (padrão das referências). */
  selected?: boolean;
}

export const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(({ className, clickable, selected, ...props }, ref) => (
  <tr
    ref={ref}
    data-state={selected ? "selected" : undefined}
    className={cn(
      "transition-colors [&>td]:border-b [&>td]:border-border",
      "data-[state=selected]:bg-brand-soft data-[state=selected]:[&>td]:border-y data-[state=selected]:[&>td]:border-brand/70",
      "data-[state=selected]:[&>td:first-child]:border-l data-[state=selected]:[&>td:last-child]:border-r",
      "data-[state=selected]:[&>td:first-child]:rounded-l-lg data-[state=selected]:[&>td:last-child]:rounded-r-lg",
      clickable ? "cursor-pointer hover:bg-surface-hover" : "hover:bg-surface-hover/60",
      className,
    )}
    {...props}
  />
));
TableRow.displayName = "TableRow";

export const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn("h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-medium text-muted first:pl-4 last:pr-4 [&:has([role=checkbox])]:pr-0", className)}
    {...props}
  />
));
TableHead.displayName = "TableHead";

export const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn("px-3 py-2.5 align-middle first:pl-4 last:pr-4 [&:has([role=checkbox])]:pr-0", className)} {...props} />
));
TableCell.displayName = "TableCell";

export const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("mt-3 text-xs text-muted", className)} {...props} />
));
TableCaption.displayName = "TableCaption";
