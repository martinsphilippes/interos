import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronRight, Crown, Minus, Sparkles, Trophy, Users } from "lucide-react";
import type { Ranking, RankingRow } from "@/server/performance/ranking";
import { POINT_RULES } from "@/server/performance/schemas";
import { DEPARTMENT_KEYS, DEPARTMENT_LABELS } from "@/domain/constants";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MedalIcon } from "./medal-icon";

function score(row: RankingRow, ranking: Ranking): string {
  if (ranking.scope === "individual" && !ranking.normalized) return `${formatNumber(row.points)} pts`;
  return `${formatNumber(Math.round(row.score * 10) / 10)} pts${ranking.scope === "individual" ? " (norm.)" : "/pessoa"}`;
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
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", up ? "text-success-fg" : "text-danger-fg")} title={`Era ${row.previousPosition}º no período anterior`}>
      {up ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />}
      {Math.abs(row.delta)}
    </span>
  );
}

const PODIUM_STYLE = [
  { order: "sm:order-2", height: "sm:pt-2", ring: "ring-2 ring-warning", label: "1º" },
  { order: "sm:order-1", height: "sm:pt-8", ring: "ring-2 ring-border-strong", label: "2º" },
  { order: "sm:order-3", height: "sm:pt-12", ring: "ring-2 ring-brand/40", label: "3º" },
];

/** Pódio (top 3) e tabela do ranking; cada linha leva ao desempenho do colaborador quando o visitante pode vê-lo. */
export function RankingBoard({ ranking, hrefFor }: { ranking: Ranking; hrefFor: (row: RankingRow) => string | null }) {
  const scored = ranking.rows.filter((r) => r.score > 0);
  if (ranking.rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Trophy />} title="Ninguém para ranquear" description="Não há colaboradores ativos neste recorte." />
      </Card>
    );
  }
  const podium = scored.slice(0, 3);
  return (
    <div className="flex flex-col gap-6">
      {podium.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
          {podium.map((row, i) => {
            const style = PODIUM_STYLE[i];
            const href = hrefFor(row);
            const body = (
              <div className={cn("flex flex-col items-center gap-2 rounded-lg border border-border bg-surface p-4 text-center shadow-card", href && "transition-colors hover:border-border-strong hover:bg-surface-muted")}>
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-muted">
                  {i === 0 ? <Crown className="size-4 text-warning" aria-hidden /> : null}
                  {row.position}º lugar
                </span>
                {row.kind === "usuario" ? (
                  <Avatar name={row.name} src={row.avatarUrl} size="lg" className={style.ring} />
                ) : (
                  <span className={cn("flex size-12 items-center justify-center rounded-full bg-secondary-soft text-secondary-fg", style.ring)}>
                    <Users className="size-5" aria-hidden />
                  </span>
                )}
                <span className="line-clamp-2 text-sm font-semibold">{row.name}</span>
                <span className="text-xs text-muted">{row.subtitle}</span>
                <span className="text-lg font-bold tabular-nums">{score(row, ranking)}</span>
                {row.level ? <Badge variant="brand" size="sm">{row.level.nome}</Badge> : null}
              </div>
            );
            return (
              <div key={row.id} className={cn(style.order, style.height)}>
                {href ? <Link href={href}>{body}</Link> : body}
              </div>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState size="sm" icon={<Sparkles />} title="Ninguém pontuou neste período" description="Os pontos entram automaticamente pelos eventos do sistema (tarefas no prazo, chamados no SLA, vendas...)." />
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Classificação</CardTitle>
          <CardDescription>{ranking.basis} Variação comparada a {ranking.previous.label.toLowerCase()}.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-2 pt-0">
          <div className="hidden grid-cols-[48px_minmax(0,2fr)_110px_120px_minmax(0,1.2fr)_24px] gap-3 border-y border-border bg-surface-muted px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted md:grid">
            <span>#</span>
            <span>{ranking.scope === "individual" ? "Colaborador" : ranking.scope === "equipe" ? "Equipe" : "Departamento"}</span>
            <span className="text-right">Pontos</span>
            <span>{ranking.scope === "individual" ? "Nível" : "Pessoas"}</span>
            <span>Medalhas</span>
            <span />
          </div>
          <ul className="divide-y divide-border">
            {ranking.rows.map((row) => {
              const href = hrefFor(row);
              const content = (
                <div className="grid min-h-[56px] grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5 md:grid-cols-[48px_minmax(0,2fr)_110px_120px_minmax(0,1.2fr)_24px]">
                  <div className="flex flex-col items-start">
                    <span className="text-base font-bold tabular-nums">{row.position}º</span>
                    <Delta row={row} />
                  </div>
                  <div className="flex min-w-0 items-center gap-2.5">
                    {row.kind === "usuario" ? <Avatar name={row.name} src={row.avatarUrl} size="sm" /> : null}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <p className="truncate text-xs text-muted">{row.subtitle}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">{score(row, ranking)}</p>
                    {ranking.normalized && ranking.scope === "individual" ? <p className="text-xs text-muted tabular-nums">{formatNumber(row.points)} brutos</p> : null}
                    {ranking.scope !== "individual" ? <p className="text-xs text-muted tabular-nums">{formatNumber(row.points)} no total</p> : null}
                  </div>
                  <div className="col-span-3 flex items-center gap-2 md:col-span-1">
                    {row.level ? (
                      <>
                        <Badge variant="brand" size="sm">
                          {row.level.nome}
                        </Badge>
                        <span className="text-xs text-muted tabular-nums">{formatNumber(row.totalPoints ?? 0)} acum.</span>
                      </>
                    ) : (
                      <span className="text-xs text-muted">{row.members} pessoa(s)</span>
                    )}
                  </div>
                  <div className="col-span-3 flex items-center gap-1.5 md:col-span-1">
                    {row.recentMedals.map((m) => (
                      <span key={`${m.key}-${m.unlockedAt}`} title={m.name}>
                        <MedalIcon icon={m.icon} className="size-7" />
                      </span>
                    ))}
                    <span className="text-xs text-muted">{row.medals > 0 ? `${row.medals} medalha(s)` : "sem medalhas"}</span>
                  </div>
                  <span className="hidden md:block">{href ? <ChevronRight className="size-4 text-muted-light" aria-hidden /> : null}</span>
                </div>
              );
              return (
                <li key={row.id}>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Como os pontos são calculados</CardTitle>
          <CardDescription>Valores do setting “gamificacao”. Níveis pelo total acumulado: {ranking.settings.niveis.map((n) => `${n.nome} ${formatNumber(n.minimo)}`).join(" · ")}.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 pt-0 md:grid-cols-2">
          <ul className="flex flex-col gap-1 text-sm">
            {POINT_RULES.map((r) => (
              <li key={r.key} className="flex justify-between gap-3">
                <span className="min-w-0">
                  {r.label} <span className="text-xs text-muted">· {r.who}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">+{formatNumber(ranking.settings.pontos[r.key] ?? 0)}</span>
              </li>
            ))}
          </ul>
          <div>
            <p className="mb-1 text-sm font-medium">Multiplicadores de equivalência (comparação entre funções)</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {DEPARTMENT_KEYS.filter((d) => d !== "diretoria").map((d) => (
                <li key={d} className="flex justify-between gap-2">
                  <span className="text-muted">{DEPARTMENT_LABELS[d]}</span>
                  <span className="tabular-nums">× {formatNumber(ranking.settings.multiplicadores[d] ?? 1)}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
