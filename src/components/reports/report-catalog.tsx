import Link from "next/link";
import { ChevronRight, FileBarChart2, ListOrdered } from "lucide-react";
import { REPORT_GROUP_LABELS, type ReportDefinition, type ReportKey } from "@/server/reports/definitions";
import { cn } from "@/lib/utils";

/** Catálogo de relatórios acessíveis, agrupado em departamentais e operacionais. */
export function ReportCatalog({ reports, selected }: { reports: ReportDefinition[]; selected: ReportKey }) {
  const groups = (["departamental", "operacional"] as const).map((g) => ({ group: g, items: reports.filter((r) => r.group === g) })).filter((g) => g.items.length > 0);
  return (
    <nav aria-label="Catálogo de relatórios" className="flex flex-col gap-4">
      {groups.map(({ group, items }) => (
        <div key={group}>
          <p className="label-caps mb-1.5 flex items-center gap-1.5 [&_svg]:size-3.5">
            {group === "departamental" ? <FileBarChart2 aria-hidden /> : <ListOrdered aria-hidden />} {REPORT_GROUP_LABELS[group]}
          </p>
          <ul className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin lg:flex-col lg:overflow-visible">
            {items.map((r) => {
              const active = r.key === selected;
              return (
                <li key={r.key} className="shrink-0">
                  <Link
                    href={`/gestao/relatorios?tipo=${r.key}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-[44px] items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                      active ? "border-brand bg-brand-soft font-medium text-brand-fg" : "border-border bg-surface text-foreground hover:border-border-strong hover:bg-surface-muted",
                    )}
                  >
                    <span className="flex flex-col leading-tight">
                      <span>{r.title}</span>
                      <span className="hidden text-xs font-normal text-muted lg:line-clamp-1">{r.description}</span>
                    </span>
                    <ChevronRight className="hidden size-4 shrink-0 text-muted-light lg:block" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
