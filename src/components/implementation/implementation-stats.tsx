import { AlertTriangle, Ban, CalendarCheck, CheckCircle2, Clock, Hourglass, PauseCircle, Rocket, Timer, Zap } from "lucide-react";
import type { ImplementationOverview } from "@/server/implementation/queries";
import { formatNumber, formatPercent } from "@/lib/format";
import { StatCard, type StatTone } from "@/components/ui/stat-card";

/** Meta de referência: 90% no prazo e 80% ativados em 7 dias (deck "Excelência em Implantação"). */
function pctTone(value: number | null, target: number): StatTone {
  if (value === null) return "neutral";
  if (value >= target) return "success";
  if (value >= target - 0.1) return "warning";
  return "danger";
}

/** Indicadores da implantação. Cada card leva à lista já filtrada (drill-down). */
export function ImplementationStats({ overview, scopeParam }: { overview: ImplementationOverview; scopeParam: string }) {
  const { counts } = overview;
  const q = (params: string) => `/implantacao?${params}${scopeParam ? `&escopo=${scopeParam}` : ""}#projetos`;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <StatCard label="Aguardando início" value={formatNumber(counts.aguardandoInicio)} icon={<Hourglass />} tone={counts.aguardandoInicio > 0 ? "info" : "neutral"} href={q("status=aguardando_inicio")} compact />
      <StatCard label="Em implantação" value={formatNumber(counts.emImplantacao)} icon={<Rocket />} tone="info" href={q("status=em_implantacao")} compact />
      <StatCard label="Atrasadas" value={formatNumber(counts.atrasadas)} icon={<AlertTriangle />} tone={counts.atrasadas > 0 ? "danger" : "success"} hint="Prazo vencido e não concluídas" href={q("atrasadas=1")} compact />
      <StatCard label="Bloqueadas" value={formatNumber(counts.bloqueadas)} icon={<Ban />} tone={counts.bloqueadas > 0 ? "danger" : "neutral"} hint="Bloqueio interno" href={q("status=bloqueada")} compact />
      <StatCard label="Aguardando cliente" value={formatNumber(counts.aguardandoCliente)} icon={<PauseCircle />} tone={counts.aguardandoCliente > 0 ? "warning" : "neutral"} hint="SLA pausado" href={q("status=aguardando_cliente")} compact />
      <StatCard label="Prontas p/ go-live" value={formatNumber(counts.prontas)} icon={<CalendarCheck />} tone={counts.prontas > 0 ? "success" : "neutral"} href="/implantacao/go-live" compact />
      <StatCard label="Concluídas no mês" value={formatNumber(counts.concluidasMes)} icon={<CheckCircle2 />} tone="success" href={q("kpi=concluidas_mes")} compact />
      <StatCard
        label="Tempo médio"
        value={overview.avgDays === null ? "—" : `${overview.avgDays.toLocaleString("pt-BR")} d`}
        icon={<Clock />}
        tone="neutral"
        hint={`Início → go-live · ${overview.avgDaysBase} projeto(s) em 90 dias`}
        href={q("status=concluida")}
        compact
      />
      <StatCard
        label="% no prazo"
        value={overview.onTimePct === null ? "—" : formatPercent(overview.onTimePct)}
        icon={<Timer />}
        tone={pctTone(overview.onTimePct, 0.9)}
        hint={`Meta 90% · ${overview.onTimeBase} concluída(s)`}
        href={q("kpi=no_prazo")}
        compact
      />
      <StatCard
        label="Ativação em 7 dias"
        value={overview.activation7Pct === null ? "—" : formatPercent(overview.activation7Pct)}
        icon={<Zap />}
        tone={pctTone(overview.activation7Pct, 0.8)}
        hint={`Liberação → go-live · meta 80% · base ${overview.activationBase}`}
        href={q("kpi=ativacao_7d")}
        compact
      />
    </div>
  );
}
