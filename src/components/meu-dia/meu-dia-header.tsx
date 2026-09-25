import Link from "next/link";
import { AlertTriangle, ClipboardCheck, Clock, Target, Users, User } from "lucide-react";
import { KpiStrip } from "@/components/ui/kpi-strip";
import { formatPercent } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import type { MeuDiaData, PriorityFilter } from "./model";
import { cn } from "@/lib/utils";

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function meuDiaHref(scope: MeuDiaData["scope"], filter: PriorityFilter): string {
  const params = new URLSearchParams();
  if (scope === "equipe") params.set("escopo", "equipe");
  if (filter !== "todas") params.set("filtro", filter);
  const qs = params.toString();
  return qs ? `/meu-dia?${qs}#prioridades` : "/meu-dia#prioridades";
}

/** Alternador Eu / Minha equipe (links, para a URL ficar compartilhável). */
function ScopeToggle({ scope, teamSize }: { scope: MeuDiaData["scope"]; teamSize: number }) {
  const options: { value: MeuDiaData["scope"]; label: string; icon: React.ReactNode; href: string }[] = [
    { value: "eu", label: "Eu", icon: <User />, href: "/meu-dia" },
    { value: "equipe", label: "Minha equipe", icon: <Users />, href: "/meu-dia?escopo=equipe" },
  ];
  return (
    <div role="radiogroup" aria-label="Escopo do Meu Dia" className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-muted p-0.5">
      {options.map((opt) => {
        const active = opt.value === scope;
        return (
          <Link
            key={opt.value}
            href={opt.href}
            role="radio"
            aria-checked={active}
            className={cn(
              "inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors [&_svg]:size-4",
              active ? "bg-brand text-white shadow-brand" : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
          >
            {opt.icon}
            {opt.label}
            {opt.value === "equipe" && active ? <span className="rounded-full bg-surface-hover px-1.5 text-xs tabular-nums text-muted">{teamSize}</span> : null}
          </Link>
        );
      })}
    </div>
  );
}

export function MeuDiaHeader({ data, filter }: { data: MeuDiaData; filter: PriorityFilter }) {
  const { stats, scope } = data;
  const team = scope === "equipe";
  return (
    <>
      <PageHeader
        title={`${data.greeting}, ${data.user.firstName}`}
        description={
          <>
            <span className="block">{capitalize(data.todayLabel)}</span>
            <span className="mt-0.5 block font-medium text-foreground">
              {team ? "Sua equipe: " : ""}
              {data.summaryLine}
            </span>
          </>
        }
        actions={data.canToggleScope ? <ScopeToggle scope={scope} teamSize={data.teamSize} /> : undefined}
      />
      <KpiStrip columns={4} mobileColumns={2} className="mb-6">
        <StatCard
          label="Tarefas"
          value={stats.tasksInProgress}
          icon={<ClipboardCheck />}
          tone="info"
          href={team ? "/tarefas?view=equipe" : "/tarefas?view=minha"}
          hint={stats.overdueTasks > 0 ? `${stats.overdueTasks} atrasada${stats.overdueTasks === 1 ? "" : "s"}` : "Em andamento"}
          compact
        />
        <StatCard
          label="Pendências"
          value={stats.pendingOnYou}
          icon={<Clock />}
          tone={stats.pendingOnYou > 0 ? "warning" : "neutral"}
          href={meuDiaHref(scope, "pendencias")}
          hint={team ? "Aguardando a equipe" : "Aguardando você"}
          compact
          className={cn(filter === "pendencias" && "border-brand")}
        />
        <StatCard label="SLA em risco" value={stats.slaAtRisk} icon={<AlertTriangle />} tone={stats.slaAtRisk > 0 ? "danger" : "success"} href={meuDiaHref(scope, "sla")} hint="Exigem atenção" compact className={cn(filter === "sla" && "border-brand")} />
        <StatCard
          label="Meta"
          value={stats.goalAttainment === null ? "—" : formatPercent(stats.goalAttainment)}
          icon={<Target />}
          tone={stats.goalAttainment === null ? "neutral" : stats.goalAttainment >= 0.9 ? "success" : stats.goalAttainment >= 0.7 ? "warning" : "danger"}
          href="/performance"
          hint={stats.goalAttainment === null ? "Sem metas no mês" : "do objetivo"}
          progress={stats.goalAttainment === null ? undefined : Math.min(100, stats.goalAttainment * 100)}
          compact
        />
      </KpiStrip>
    </>
  );
}
