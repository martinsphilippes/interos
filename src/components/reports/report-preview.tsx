import Link from "next/link";
import { Download, FileSpreadsheet, FileText, Info, Table2 } from "lucide-react";
import type { ReportData } from "@/server/reports/build";
import { filtersToQuery, formatReportValue, type ColumnType, type ReportColumn, type ReportValue } from "@/server/reports/definitions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const PREVIEW_LIMIT = 300;
const NUMERIC: ColumnType[] = ["numero", "moeda", "percentual", "dias", "horas", "minutos", "nota"];
const STATUS_VARIANT: Record<string, "success" | "warning" | "danger"> = { Atingida: "success", Atenção: "warning", Crítico: "danger" };

function Cell({ col, value }: { col: ReportColumn; value: ReportValue | undefined }) {
  if (col.type === "status" && typeof value === "string" && STATUS_VARIANT[value]) {
    return (
      <Badge variant={STATUS_VARIANT[value]} size="sm">
        {value}
      </Badge>
    );
  }
  return <>{formatReportValue(value ?? null, col.type)}</>;
}

/** Botões de exportação: baixam o mesmo relatório (mesmos filtros) em CSV, XLSX ou PDF. */
export function ExportButtons({ data }: { data: ReportData }) {
  const query = filtersToQuery(data.effective);
  const href = (format: string) => `/api/relatorios/${data.definition.key}?formato=${format}${query ? `&${query}` : ""}`;
  return (
    <div className="flex flex-wrap gap-2">
      {(
        [
          ["csv", "CSV", <Download key="i" />],
          ["xlsx", "XLSX", <FileSpreadsheet key="i" />],
          ["pdf", "PDF", <FileText key="i" />],
        ] as const
      ).map(([format, label, icon]) => (
        <Button key={format} asChild variant="outline" className="h-11 md:h-9">
          <a href={href(format)} download>
            {icon} {label}
          </a>
        </Button>
      ))}
    </div>
  );
}

/** Prévia do relatório na página: tabela (cards no celular) com totais, filtros aplicados e observações. */
export function ReportPreview({ data }: { data: ReportData }) {
  const { columns } = data.definition;
  const rows = data.rows.slice(0, PREVIEW_LIMIT);
  if (data.rows.length === 0) {
    return <EmptyState icon={<Table2 />} title="Nenhum registro" description="Não há dados para os filtros aplicados. Ajuste o período ou remova filtros." />;
  }
  const [first, ...rest] = columns;
  return (
    <div className="flex flex-col gap-3">
      <div className="hidden md:block">
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key} className={cn("whitespace-nowrap", NUMERIC.includes(c.type) && "text-right")}>
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={i}>
                {columns.map((c, j) => (
                  <TableCell key={c.key} className={cn("tabular-nums", NUMERIC.includes(c.type) && "text-right", c.type === "texto" && "max-w-[260px] truncate")}>
                    {j === 0 && row.href ? (
                      <Link href={row.href} className="font-medium text-foreground hover:underline">
                        <Cell col={c} value={row.cells[c.key]} />
                      </Link>
                    ) : (
                      <Cell col={c} value={row.cells[c.key]} />
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          {data.totals ? (
            <TableFooter>
              <TableRow>
                {columns.map((c) => (
                  <TableCell key={c.key} className={cn("tabular-nums font-semibold", NUMERIC.includes(c.type) && "text-right")}>
                    {data.totals![c.key] === undefined ? "" : <Cell col={c} value={data.totals![c.key]} />}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </div>

      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((row, i) => (
          <li key={i} className="rounded-lg border border-border bg-surface p-3 shadow-card">
            {row.href ? (
              <Link href={row.href} className="block min-h-[32px] font-medium text-foreground hover:underline">
                <Cell col={first} value={row.cells[first.key]} />
              </Link>
            ) : (
              <p className="font-medium text-foreground">
                <Cell col={first} value={row.cells[first.key]} />
              </p>
            )}
            <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              {rest.map((c) => (
                <div key={c.key} className="min-w-0">
                  <dt className="truncate text-muted">{c.label}</dt>
                  <dd className="truncate tabular-nums text-foreground">
                    <Cell col={c} value={row.cells[c.key]} />
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
        {data.totals ? (
          <li className="rounded-lg border border-border bg-surface-muted p-3 text-xs">
            <p className="font-semibold">{String(data.totals[first.key] ?? "Total")}</p>
            <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
              {rest
                .filter((c) => data.totals![c.key] !== undefined)
                .map((c) => (
                  <div key={c.key}>
                    <dt className="text-muted">{c.label}</dt>
                    <dd className="font-semibold tabular-nums">
                      <Cell col={c} value={data.totals![c.key]} />
                    </dd>
                  </div>
                ))}
            </dl>
          </li>
        ) : null}
      </ul>

      {data.rows.length > PREVIEW_LIMIT ? (
        <p className="text-xs text-muted">
          Prévia com as primeiras {PREVIEW_LIMIT} de {data.rows.length} linhas; a exportação traz todas.
        </p>
      ) : null}
      {data.notes.length > 0 || data.definition.statusRule ? (
        <div className="flex flex-col gap-1 rounded-lg bg-info-soft p-3 text-xs text-info-fg">
          {data.definition.statusRule ? (
            <p className="flex gap-1.5">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> <span>Status: {data.definition.statusRule}</span>
            </p>
          ) : null}
          {data.notes.map((n) => (
            <p key={n} className="flex gap-1.5">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> <span>{n}</span>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
