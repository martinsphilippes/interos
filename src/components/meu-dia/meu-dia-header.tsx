import Link from "next/link";
import { AlertTriangle, Bell, Building2, CalendarCheck, PhoneOutgoing, Timer, Users, User } from "lucide-react";
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
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        <StatCard label="Tarefas hoje" value={stats.tasksToday} icon={<CalendarCheck />} tone={stats.tasksToday > 0 ? "info" : "neutral"} href={team ? "/tarefas?view=equipe&prazo=hoje" : "/tarefas?view=minha&prazo=hoje"} compact />
        <StatCard label="Atrasadas" value={stats.overdueTasks} icon={<AlertTriangle />} tone={stats.overdueTasks > 0 ? "danger" : "success"} href={team ? "/tarefas?view=atrasadas" : "/tarefas?view=atrasadas&mine=1"} compact />
        <StatCard label="Follow-ups vencidos" value={stats.followupsOverdue} icon={<PhoneOutgoing />} tone={stats.followupsOverdue > 0 ? "warning" : "neutral"} href={meuDiaHref(scope, "followups")} compact className={cn(filter === "followups" && "border-brand")} />
        <StatCard label="SLAs em risco" value={stats.slaAtRisk} icon={<Timer />} tone={stats.slaAtRisk > 0 ? "danger" : "success"} href={meuDiaHref(scope, "sla")} hint="Em risco ou violados" compact className={cn(filter === "sla" && "border-brand")} />
        <StatCard label="Clientes em atenção" value={stats.clientsAttention} icon={<Building2 />} tone={stats.clientsAttention > 0 ? "warning" : "neutral"} href={meuDiaHref(scope, "clientes")} compact className={cn(filter === "clientes" && "border-brand")} />
        <StatCard label="Não lidas" value={stats.unreadNotifications} icon={<Bell />} tone={stats.unreadNotifications > 0 ? "info" : "neutral"} href="/notificacoes?filtro=nao-lidas" hint="Notificações" compact />
      </div>
    </>
  );
}
