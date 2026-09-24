import Link from "next/link";
import { FolderKanban } from "lucide-react";
import type { ProjectRow } from "@/server/implementation/queries";
import { formatDate } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { SlaBadge } from "@/components/ui/sla-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IMPLEMENTATION_PHASE_LABELS, IMPLEMENTATION_STATUS_LABELS, IMPLEMENTATION_STATUS_VARIANT } from "@/components/clients/labels";
import { cn } from "@/lib/utils";

export function progressTone(row: Pick<ProjectRow, "status" | "overdue">): "danger" | "warning" | "success" | "brand" {
  if (row.status === "bloqueada" || row.overdue) return "danger";
  if (row.status === "aguardando_cliente") return "warning";
  if (row.status === "concluida" || row.status === "pronta_para_go_live") return "success";
  return "brand";
}

export function ProductChips({ products, max = 3 }: { products: ProjectRow["products"]; max?: number }) {
  return (
    <div className="flex flex-wrap gap-1">
      {products.slice(0, max).map((p) => (
        <span key={p.id} className="rounded-sm bg-secondary-soft px-1.5 py-0.5 text-[11px] text-secondary-fg">
          {p.name}
        </span>
      ))}
      {products.length > max ? <span className="text-[11px] text-muted">+{products.length - max}</span> : null}
    </div>
  );
}

function Delay({ row }: { row: ProjectRow }) {
  if (row.internalDelayDays === 0 && row.externalDelayDays === 0) return <span className="text-muted">—</span>;
  return (
    <span className="text-xs tabular-nums leading-tight">
      <span className={cn(row.internalDelayDays > 0 && "text-danger-fg")}>Int. {row.internalDelayDays.toLocaleString("pt-BR")}d</span>
      <span className="text-muted"> · </span>
      <span className={cn(row.externalDelayDays > 0 && "text-warning-fg")}>Ext. {row.externalDelayDays.toLocaleString("pt-BR")}d</span>
    </span>
  );
}

function DueCell({ row }: { row: ProjectRow }) {
  return (
    <span className={cn("whitespace-nowrap tabular-nums", row.overdue && "font-medium text-danger-fg")}>
      {formatDate(row.dueDate)}
      {row.status === "concluida" && row.onTime !== undefined ? (
        <span className={cn("block text-xs font-normal", row.onTime ? "text-success-fg" : "text-warning-fg")}>{row.onTime ? "No prazo" : `${row.daysLate}d após o prazo`}</span>
      ) : row.overdue ? (
        <span className="block text-xs font-normal">{row.daysLate}d de atraso</span>
      ) : null}
    </span>
  );
}

/** Lista de projetos: tabela no desktop, cards no celular. Linha/card leva ao projeto. */
export function ProjectsTable({ rows, emptyDescription }: { rows: ProjectRow[]; emptyDescription?: string }) {
  if (rows.length === 0) {
    return <EmptyState icon={<FolderKanban />} title="Nenhum projeto encontrado" description={emptyDescription ?? "Ajuste os filtros. Projetos são criados quando o Financeiro libera o contrato."} />;
  }
  return (
    <>
      <div className="hidden md:block">
        <Table className="min-w-[1080px]">
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Produtos</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Fase</TableHead>
              <TableHead className="w-[140px]">Progresso</TableHead>
              <TableHead>Início</TableHead>
              <TableHead>Prazo</TableHead>
              <TableHead>SLA</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Atraso</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="relative">
                <TableCell className="max-w-[220px]">
                  <Link href={`/implantacao/${r.id}`} className="font-medium after:absolute after:inset-0 hover:underline">
                    {r.clientName}
                  </Link>
                  {r.waitingReason || r.blockedReason ? <p className="truncate text-xs text-muted" title={r.waitingReason ?? r.blockedReason}>{r.waitingReason ?? r.blockedReason}</p> : null}
                  {r.activationDays !== undefined ? <p className="text-xs text-muted">Ativado em {r.activationDays.toLocaleString("pt-BR")}d após a liberação</p> : null}
                </TableCell>
                <TableCell className="max-w-[200px]">
                  <ProductChips products={r.products} />
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <Avatar name={r.ownerName} src={r.ownerAvatarUrl} size="xs" />
                    {r.ownerName}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap">{IMPLEMENTATION_PHASE_LABELS[r.currentPhase]}</TableCell>
                <TableCell>
                  <Progress value={r.progress} showValue size="sm" tone={progressTone(r)} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted">{formatDate(r.startDate)}</TableCell>
                <TableCell>
                  <DueCell row={r} />
                </TableCell>
                <TableCell>{r.sla ? <SlaBadge state={r.sla.state} remainingMs={r.sla.remainingMs} /> : <span className="text-muted">—</span>}</TableCell>
                <TableCell>
                  <Badge variant={IMPLEMENTATION_STATUS_VARIANT[r.status]} size="sm">
                    {IMPLEMENTATION_STATUS_LABELS[r.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Delay row={r} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="flex flex-col divide-y divide-border md:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/implantacao/${r.id}`} className="flex min-h-[44px] flex-col gap-2 px-4 py-3 active:bg-surface-hover">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.clientName}</p>
                  <p className="text-xs text-muted">
                    {IMPLEMENTATION_PHASE_LABELS[r.currentPhase]} · {r.ownerName}
                  </p>
                </div>
                <Badge variant={IMPLEMENTATION_STATUS_VARIANT[r.status]} size="sm">
                  {IMPLEMENTATION_STATUS_LABELS[r.status]}
                </Badge>
              </div>
              <ProductChips products={r.products} />
              <Progress value={r.progress} showValue size="sm" tone={progressTone(r)} />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="text-muted">Prazo</span>
                <DueCell row={r} />
                {r.sla ? <SlaBadge state={r.sla.state} remainingMs={r.sla.remainingMs} /> : null}
                <Delay row={r} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
