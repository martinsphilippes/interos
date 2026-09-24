import Link from "next/link";
import { ArrowDown, ArrowUp, Crown, Lock, Minus, Sparkles, Trophy, Users } from "lucide-react";
import type { Ranking, RankingRow } from "@/server/performance/ranking";
import type { AchievementCard, CampaignProgress } from "@/server/performance/queries";
import { POINT_RULES, type GamificationLevel } from "@/server/performance/schemas";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS } from "@/domain/constants";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { MedalIcon } from "./medal-icon";

export function rankingScore(row: RankingRow, ranking: Ranking): string {
  if (ranking.scope === "individual" && !ranking.normalized) return `${formatNumber(row.points)} pts`;
  return `${formatNumber(Math.round(row.score * 10) / 10)} pts${ranking.scope === "individual" ? "" : "/pessoa"}`;
}

function Delta({ row }: { row: RankingRow }) {
  if (row.delta === null) return <span className="text-xs text-muted">novo</span>;
  if (row.delta === 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted">
        <Minus className="size-3.5" aria-hidden /> 0
      </span>
    );
  const up = row.delta > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-sm font-medium tabular-nums", up ? "text-success-fg" : "text-danger-fg")} title={`Era ${row.previousPosition}º no período anterior`}>
      {up ? <ArrowUp className="size-4" aria-hidden /> : <ArrowDown className="size-4" aria-hidden />}
      {Math.abs(row.delta)}
    </span>
  );
}

const PODIUM = [
  { order: "order-2", pedestal: "h-24 bg-gradient-to-b from-warning/45 to-warning/10 border-warning/40", ring: "ring-4 ring-warning", text: "text-warning-fg", place: 1 },
  { order: "order-1", pedestal: "h-16 bg-gradient-to-b from-muted-light/40 to-muted-light/10 border-muted-light/40", ring: "ring-4 ring-muted-light", text: "text-foreground", place: 2 },
  { order: "order-3", pedestal: "h-12 bg-gradient-to-b from-brand/45 to-brand/10 border-brand/40", ring: "ring-4 ring-brand/70", text: "text-brand-fg", place: 3 },
];

/** Pódio do período (top 3 com pontos), com pedestais 1º/2º/3º. */
export function RankingPodium({ ranking, hrefFor }: { ranking: Ranking; hrefFor: (row: RankingRow) => string | null }) {
  const podium = ranking.rows.filter((r) => r.score > 0).slice(0, 3);
  if (podium.length === 0) return <EmptyState size="sm" icon={<Sparkles />} title="Ninguém pontuou neste período" description="Os pontos entram automaticamente pelos eventos do sistema (tarefas no prazo, chamados no SLA, vendas...)." />;
  return (
    <div className="grid grid-cols-3 items-end gap-2 sm:gap-4">
      {podium.map((row, i) => {
        const style = PODIUM[i];
        const href = hrefFor(row);
        const person = (
          <div className="flex flex-col items-center gap-1.5 px-1 pb-3 text-center">
            <span className={cn("inline-flex items-center gap-1 text-lg font-bold", style.text)}>
              {i === 0 ? <Crown className="size-5" aria-hidden /> : null}
              {row.position}º
            </span>
            {row.kind === "usuario" ? (
              <Avatar name={row.name} src={row.avatarUrl} size={i === 0 ? "xl" : "lg"} className={style.ring} />
            ) : (
              <span className={cn("flex size-14 items-center justify-center rounded-full bg-secondary-soft text-secondary-fg", style.ring)}>
                <Users className="size-6" aria-hidden />
              </span>
            )}
            <span className="line-clamp-2 text-sm font-semibold">{row.name}</span>
            <span className="line-clamp-1 text-xs text-muted">{row.subtitle}</span>
            <span className={cn("text-base font-bold tabular-nums", style.text)}>{rankingScore(row, ranking)}</span>
          </div>
        );
        return (
          <div key={row.id} className={cn("flex flex-col", style.order)}>
            {href ? (
              <Link href={href} className="rounded-lg transition-colors hover:bg-surface-hover">
                {person}
              </Link>
            ) : (
              person
            )}
            <div className={cn("flex items-start justify-center rounded-t-lg border border-b-0 pt-2 text-2xl font-bold text-foreground/80", style.pedestal)} aria-hidden>
              {style.place}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Classificação com evolução de posição; a linha do visitante fica destacada. */
export function RankingTable({ ranking, hrefFor, viewerId, limit }: { ranking: Ranking; hrefFor: (row: RankingRow) => string | null; viewerId?: string; limit?: number }) {
  if (ranking.rows.length === 0) return <EmptyState icon={<Trophy />} title="Ninguém para ranquear" description="Não há colaboradores ativos neste recorte." />;
  const rows = limit ? ranking.rows.slice(0, limit) : ranking.rows;
  const mine = viewerId ? ranking.rows.find((r) => r.id === viewerId) : undefined;
  const shown = mine && !rows.includes(mine) ? [...rows, mine] : rows;
  return (
    <div>
      <div className="hidden grid-cols-[56px_minmax(0,2fr)_minmax(0,1.2fr)_110px_72px_minmax(0,1fr)] gap-3 border-y border-border bg-surface-muted px-5 py-2 text-xs font-medium text-muted md:grid">
        <span>Posição</span>
        <span>{ranking.scope === "individual" ? "Colaborador" : ranking.scope === "equipe" ? "Equipe" : "Departamento"}</span>
        <span>{ranking.scope === "individual" ? "Departamento" : "Pessoas"}</span>
        <span className="text-right">Pontos</span>
        <span className="text-center">Evolução</span>
        <span>{ranking.scope === "individual" ? "Nível · medalhas" : "Medalhas"}</span>
      </div>
      <ul className="divide-y divide-border">
        {shown.map((row) => {
          const href = hrefFor(row);
          const isMe = row.id === viewerId;
          const content = (
            <div className={cn("grid min-h-[56px] grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5 md:grid-cols-[56px_minmax(0,2fr)_minmax(0,1.2fr)_110px_72px_minmax(0,1fr)]", isMe && "rounded-lg border border-brand bg-brand-soft/40")}>
              <span className={cn("text-base font-bold tabular-nums", isMe && "text-brand-fg")}>{row.position}º</span>
              <div className="flex min-w-0 items-center gap-2.5">
                {row.kind === "usuario" ? <Avatar name={row.name} src={row.avatarUrl} size="sm" /> : null}
                <div className="min-w-0">
                  <p className={cn("truncate text-sm font-medium", isMe && "text-brand-fg")}>{row.name}</p>
                  <p className="truncate text-xs text-muted md:hidden">{row.subtitle}</p>
                </div>
              </div>
              <span className="hidden truncate text-sm text-muted md:block">{row.kind === "usuario" ? (row.department ? DEPARTMENT_LABELS[row.department] : row.subtitle) : `${row.members} pessoa(s)`}</span>
              <div className="text-right">
                <p className={cn("text-sm font-semibold tabular-nums", isMe && "text-brand-fg")}>{rankingScore(row, ranking)}</p>
                {ranking.normalized && ranking.scope === "individual" ? <p className="text-xs text-muted tabular-nums">{formatNumber(row.points)} brutos</p> : null}
              </div>
              <span className="col-span-3 flex items-center gap-2 md:col-span-1 md:justify-center">
                <Delta row={row} />
              </span>
              <div className="col-span-3 flex min-w-0 flex-wrap items-center gap-1.5 md:col-span-1">
                {row.level ? (
                  <Badge variant="brand" size="sm">
                    {row.level.nome}
                  </Badge>
                ) : null}
                {row.recentMedals.slice(0, 3).map((m) => (
                  <span key={`${m.key}-${m.unlockedAt}`} title={m.name}>
                    <MedalIcon icon={m.icon} className="size-6 [&_svg]:size-3.5" />
                  </span>
                ))}
                {row.medals > 3 ? <span className="text-xs text-muted">+{row.medals - 3}</span> : null}
              </div>
            </div>
          );
          return (
            <li key={row.id} className={cn(isMe && "px-2 py-1")}>
              {href ? (
                <Link href={href} className="block transition-colors hover:bg-surface-muted">
                  {content}
                </Link>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>
      <p className="px-5 pt-3 text-xs text-muted">
        {ranking.basis} Evolução comparada a {ranking.previous.label.toLowerCase()}.
      </p>
    </div>
  );
}

function daysLeft(endDate: string, today: string): number {
  const end = Date.parse(`${endDate.slice(0, 10)}T12:00:00Z`);
  const now = Date.parse(`${today}T12:00:00Z`);
  return Math.max(0, Math.round((end - now) / 86_400_000));
}

/** Campanhas ativas: progresso (média dos participantes, ou o do visitante quando participa), prazo e prêmio. */
export function ActiveCampaigns({ items, today }: { items: CampaignProgress[]; today: string }) {
  if (items.length === 0) return <EmptyState size="sm" title="Nenhuma campanha ativa" description="Campanhas criadas pelos gestores aparecem aqui com o seu progresso." />;
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((c) => {
        const progress = c.mine?.attainment ?? c.progress;
        const pct = progress === null ? 0 : Math.min(100, progress * 100);
        const left = daysLeft(c.campaign.endDate, today);
        return (
          <li key={c.campaign.id}>
            <Link href="/performance/campanhas" className="flex items-center gap-3 rounded-lg border border-border bg-surface-muted/50 p-3 transition-colors hover:border-border-strong hover:bg-surface-hover">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning-fg">
                <Sparkles className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.campaign.name}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-track" aria-hidden>
                    <span className={cn("block h-full rounded-full", pct >= 100 ? "bg-success" : pct >= 60 ? "bg-info" : "bg-brand")} style={{ width: `${pct}%` }} />
                  </span>
                  <span className="w-11 text-right text-xs font-semibold tabular-nums">{formatPercent(progress)}</span>
                </div>
                <p className="mt-1 truncate text-xs text-muted">{c.mine ? "Seu progresso" : "Média dos participantes"} · {c.metricLabel}</p>
              </div>
              <div className="shrink-0 border-l border-border pl-3 text-right text-xs">
                <p className="text-muted">Termina em</p>
                <p className="font-medium">{left} dia(s)</p>
                {c.campaign.prize ? <p className="max-w-[110px] truncate font-semibold text-success-fg" title={c.campaign.prize}>{c.campaign.prize}</p> : null}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Minhas conquistas: todas as medalhas do sistema, desbloqueadas (coloridas) e bloqueadas (cadeado). */
export function AchievementsGrid({ items }: { items: AchievementCard[] }) {
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-3">
      {items.map((a) => (
        <li key={a.key} className="flex flex-col items-center gap-1.5 text-center" title={`${a.description}${a.unlockedAt ? ` · desbloqueada em ${formatDate(a.unlockedAt)}` : " · bloqueada"}`}>
          {a.unlocked ? (
            <span className="relative">
              <MedalIcon icon={a.icon} className="size-14 rounded-2xl bg-gradient-to-b from-brand/40 to-brand-soft [&_svg]:size-6" />
              {a.count > 1 ? <span className="absolute -right-1 -top-1 rounded-full bg-brand px-1.5 text-[10px] font-bold text-white">×{a.count}</span> : null}
            </span>
          ) : (
            <span className="inline-flex size-14 items-center justify-center rounded-2xl border border-border bg-surface-muted text-muted-light">
              <Lock className="size-5" aria-hidden />
            </span>
          )}
          <span className={cn("line-clamp-2 text-xs", a.unlocked ? "text-foreground" : "text-muted")}>{a.name}</span>
        </li>
      ))}
    </ul>
  );
}

/** Nível atual com barra até o próximo e a tabela de níveis. */
export function LevelProgress({ level, totalPoints, levels }: { level: { nome: string; next: (GamificationLevel & { missing: number }) | null; progress: number }; totalPoints: number; levels: GamificationLevel[] }) {
  const index = levels.findIndex((l) => l.nome === level.nome);
  return (
    <div className="flex items-center gap-4">
      <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b from-warning/50 to-brand/30 text-2xl font-bold text-foreground" aria-hidden>
        {index >= 0 ? index + 1 : "—"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-semibold">
            Nível {index + 1} — {level.nome}
          </span>
          <span className="truncate text-xs text-muted">{level.next ? `Nível ${index + 2} — ${level.next.nome}` : "Nível máximo"}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-track" aria-hidden>
          <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round(level.progress * 100)}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-muted">
          <span className="font-semibold text-brand-fg tabular-nums">{formatNumber(totalPoints)}</span>
          {level.next ? ` / ${formatNumber(level.next.minimo)} pts acumulados` : " pts acumulados"}
        </p>
      </div>
    </div>
  );
}

/** "Como pontuar": pontos por evento (setting "gamificacao"), multiplicadores e níveis. */
export function PointsRules({ ranking, streakRule }: { ranking: Ranking; streakRule: string }) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div>
        <p className="mb-2 text-sm font-semibold">Pontos por evento</p>
        <ul className="flex flex-col gap-1 text-sm">
          {POINT_RULES.map((r) => (
            <li key={r.key} className="flex justify-between gap-3">
              <span className="min-w-0">
                {r.label} <span className="text-xs text-muted">· {r.who}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-success-fg">+{formatNumber(ranking.settings.pontos[r.key] ?? 0)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-1 text-sm font-semibold">Sequência em dias</p>
          <p className="text-sm text-muted">{streakRule} Fins de semana e feriados não contam; o dia de hoje não quebra a sequência enquanto está em andamento.</p>
        </div>
        <div>
          <p className="mb-1 text-sm font-semibold">Níveis (pontos acumulados)</p>
          <p className="text-sm text-muted">{ranking.settings.niveis.map((n) => `${n.nome} ${formatNumber(n.minimo)}`).join(" · ")}</p>
        </div>
        <div>
          <p className="mb-1 text-sm font-semibold">Multiplicadores de equivalência (comparação entre funções)</p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {DEPARTMENT_KEYS.filter((d) => d !== "diretoria").map((d) => (
              <li key={d} className="flex justify-between gap-2">
                <span className="text-muted">{DEPARTMENT_LABELS[d]}</span>
                <span className="tabular-nums">× {formatNumber(ranking.settings.multiplicadores[d] ?? 1)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

