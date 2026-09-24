import Link from "next/link";
import { AlertOctagon, AlertTriangle, BarChart3, ChevronRight, CircleDollarSign, Headset, Info, Rocket } from "lucide-react";
import type { Cockpit } from "@/server/management/queries";
import type { Insight } from "@/server/insights/rules";
import { DEPARTMENT_LABELS } from "@/domain/constants";
import { STATUS_LABELS, formatKpiValue } from "@/server/kpis/schemas";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { IconTile } from "@/components/ui/icon-tile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusDot } from "@/components/ui/status-dot";

function pctTone(value: number | null, ok = 0.9, warn = 0.75): string {
  if (value === null) return "text-muted";
  if (value >= ok) return "text-success-fg";
  if (value >= warn) return "text-warning-fg";
  return "text-danger-fg";
}

const STATUS_DOT = { atingida: "success", atencao: "warning", critico: "danger" } as const;
const STATUS_TEXT = { atingida: "Dentro da meta", atencao: "Atenção", critico: "Crítico" } as const;

/** "Desempenho por departamento": indicador principal (meta → realizado), atingimento, produtividade, SLA e status. */
export function DepartmentPerformanceTable({ rows }: { rows: Cockpit["departments"] }) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <Table className="min-w-[560px]">
        <TableHeader>
          <TableRow>
            <TableHead>Departamento</TableHead>
            <TableHead className="text-right">Meta</TableHead>
            <TableHead className="text-right">Realizado</TableHead>
            <TableHead className="text-right" title="Atingimento médio das metas do departamento">Ating.</TableHead>
            <TableHead className="text-right" title="Tarefas entregues no prazo">Produt.</TableHead>
            <TableHead className="text-right">SLA</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const p = r.principal;
            return (
              <TableRow key={r.department}>
                <TableCell>
                  <Link href={r.href} className="block min-w-0 hover:underline">
                    <span className="block text-sm font-medium">{r.label}</span>
                    <span className="block max-w-[150px] truncate text-xs text-muted">{p ? p.kpi.name : "Sem indicador principal"}</span>
                  </Link>
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums text-muted">{p ? formatKpiValue(p.target, p.kpi.unit, p.kpi.formulaMeta?.suffix) : "—"}</TableCell>
                <TableCell className="text-right">
                  {p ? (
                    <Link href={p.href} className={cn("text-sm font-medium tabular-nums hover:underline", p.status === "atingida" ? "text-success-fg" : p.status === "atencao" ? "text-warning-fg" : p.status === "critico" ? "text-danger-fg" : "text-foreground")}>
                      {formatKpiValue(p.value, p.kpi.unit, p.kpi.formulaMeta?.suffix)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className={cn("text-right text-sm font-medium tabular-nums", pctTone(r.attainment, 1, 0.85))}>{formatPercent(r.attainment)}</TableCell>
                <TableCell className={cn("text-right text-sm tabular-nums", pctTone(r.productivity, 0.85, 0.7))}>{formatPercent(r.productivity)}</TableCell>
                <TableCell className={cn("text-right text-sm tabular-nums", pctTone(r.sla))}>{formatPercent(r.sla)}</TableCell>
                <TableCell>
                  {r.status ? (
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
                      <StatusDot tone={STATUS_DOT[r.status]} />
                      {STATUS_TEXT[r.status]}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">Sem meta</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

const FUNNEL = [
  { key: "leads", label: "Leads", color: "bg-info" },
  { key: "qualified", label: "Qualificados", color: "bg-secondary" },
  { key: "proposals", label: "Propostas", color: "bg-brand" },
  { key: "sales", label: "Vendas", color: "bg-accent-purple" },
] as const;

/** "Funil comercial": leads → qualificados (MQL) → propostas enviadas → vendas e a conversão do período. */
export function SalesFunnel({ funnel }: { funnel: Cockpit["salesFunnel"] }) {
  const values = { leads: funnel.leads, qualified: funnel.qualified, proposals: funnel.proposals, sales: funnel.sales };
  const max = Math.max(1, ...Object.values(values).map((v) => v ?? 0));
  const hrefs = funnel.hrefs;
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {FUNNEL.map((f, i) => {
          const v = values[f.key];
          const width = Math.max(18, ((v ?? 0) / max) * 100);
          return (
            <li key={f.key}>
              <Link href={hrefs[f.key]} className="group grid grid-cols-[minmax(0,1fr)_minmax(0,7.5rem)] items-center gap-3">
                <span className="flex justify-center">
                  <span className={cn("block h-8 rounded-md opacity-90 transition-opacity group-hover:opacity-100", f.color)} style={{ width: `${width - i * 4}%`, clipPath: "polygon(0 0, 100% 0, 94% 100%, 6% 100%)" }} aria-hidden />
                </span>
                <span className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-muted">{f.label}</span>
                  <span className="font-semibold tabular-nums">{v === null ? "—" : formatNumber(v)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface-muted px-4 py-3">
        <span className="flex items-center gap-2 text-sm text-muted">
          <BarChart3 className="size-4" aria-hidden /> Conversão (vendas ÷ leads)
        </span>
        <span className="text-2xl font-semibold tabular-nums text-info-fg">{formatPercent(funnel.conversion)}</span>
      </div>
    </div>
  );
}

/** "Operação": implantação (andamento/atrasadas), suporte (chamados/SLA) e financeiro (inadimplência vs. anterior). */
export function OperationSummary({ operation }: { operation: Cockpit["operation"] }) {
  const { implementation, support, finance } = operation;
  const delinquency = finance.delinquency;
  const prev = delinquency?.trend?.value ?? null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="flex flex-col rounded-lg border border-border bg-surface-muted/50 p-3 text-center">
        <p className="flex items-center justify-center gap-2 text-sm font-medium">
          <IconTile icon={<Rocket />} tone="info" size="xs" /> Implantação
        </p>
        <Link href={implementation.href} className="mt-3 block hover:underline">
          <span className="block text-3xl font-semibold tabular-nums">{formatNumber(implementation.inProgress)}</span>
          <span className="text-xs text-muted">em andamento</span>
        </Link>
        <Link href={implementation.lateHref} className="mt-3 block border-t border-border pt-3 hover:underline">
          <span className={cn("block text-2xl font-semibold tabular-nums", implementation.late > 0 ? "text-danger-fg" : "text-success-fg")}>{formatNumber(implementation.late)}</span>
          <span className="text-xs text-muted">atrasadas</span>
        </Link>
      </div>
      <div className="flex flex-col rounded-lg border border-border bg-surface-muted/50 p-3 text-center">
        <p className="flex items-center justify-center gap-2 text-sm font-medium">
          <IconTile icon={<Headset />} tone="info" size="xs" /> Suporte
        </p>
        <Link href={support.opened?.href ?? "/suporte/chamados"} className="mt-3 block hover:underline">
          <span className="block text-3xl font-semibold tabular-nums">{support.opened?.value === null || support.opened?.value === undefined ? "—" : formatNumber(support.opened.value)}</span>
          <span className="text-xs text-muted">chamados no período · {formatNumber(support.backlog)} em aberto</span>
        </Link>
        <Link href={support.sla?.href ?? "/sla?tipo=chamado"} className="mt-3 block border-t border-border pt-3 hover:underline">
          <span className={cn("block text-2xl font-semibold tabular-nums", pctTone(support.sla?.value ?? null))}>{formatPercent(support.sla?.value ?? null)}</span>
          <span className="text-xs text-muted">SLA de solução</span>
        </Link>
      </div>
      <div className="flex flex-col rounded-lg border border-border bg-surface-muted/50 p-3 text-center">
        <p className="flex items-center justify-center gap-2 text-sm font-medium">
          <IconTile icon={<CircleDollarSign />} tone="purple" size="xs" /> Financeiro
        </p>
        <Link href={delinquency?.href ?? "/financeiro"} className="mt-3 flex flex-1 flex-col justify-center hover:underline">
          <span className="text-xs text-muted">Inadimplência</span>
          <span className={cn("block text-3xl font-semibold tabular-nums", delinquency?.status === "critico" ? "text-danger-fg" : delinquency?.status === "atencao" ? "text-warning-fg" : "text-success-fg")}>
            {formatPercent(delinquency?.value ?? null)}
          </span>
          <span className="text-xs text-muted">
            {prev !== null && delinquency?.trend ? `${delinquency.trend.period.label}: ${formatPercent(prev)}` : "sem comparação"}
            {delinquency?.status ? ` · ${STATUS_LABELS[delinquency.status]}` : ""}
          </span>
        </Link>
      </div>
    </div>
  );
}

const SEVERITY = {
  critico: { tone: "danger" as const, icon: <AlertOctagon /> },
  atencao: { tone: "warning" as const, icon: <AlertTriangle /> },
  info: { tone: "info" as const, icon: <Info /> },
};

/** "Alertas estratégicos": insights do período (regras sobre os indicadores), cada um abrindo a evidência. */
export function StrategicAlerts({ insights, limit = 5 }: { insights: Insight[]; limit?: number }) {
  if (insights.length === 0) return <EmptyState size="sm" title="Nenhum alerta estratégico" description="As regras não detectaram gargalos no período." />;
  return (
    <ul className="flex flex-col gap-2">
      {insights.slice(0, limit).map((i) => {
        const s = SEVERITY[i.severity];
        const href = i.evidence[0]?.href ?? "/gestao/cockpit";
        return (
          <li key={i.key}>
            <Link href={href} className="flex min-h-[52px] items-center gap-3 rounded-lg border border-border bg-surface-muted/50 px-3 py-2 transition-colors hover:border-border-strong hover:bg-surface-hover" title={i.explanation}>
              <IconTile icon={s.icon} tone={s.tone} size="sm" shape="circle" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{i.title}</span>
                <span className="block truncate text-xs text-muted">
                  {DEPARTMENT_LABELS[i.department]} · {i.explanation}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-light" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
