import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ChevronRight, Medal, Minus, Sparkles } from "lucide-react";
import type { MyPerformance } from "@/server/performance/queries";
import { DEPARTMENT_LABELS } from "@/domain/constants";
import { formatDate, formatNumber } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { MedalIcon } from "./medal-icon";

/** Posição no ranking, pontos do período, nível e medalhas recentes do colaborador. */
export function GamificationCard({ data, periodLabel, rankingHref }: { data: NonNullable<MyPerformance["gamification"]>; periodLabel: string; rankingHref: string }) {
  const DeltaIcon = data.delta === null || data.delta === 0 ? Minus : data.delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Ranking, pontos e medalhas</CardTitle>
          <CardDescription>{periodLabel}</CardDescription>
        </div>
        <Link href={rankingHref} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-brand hover:underline md:min-h-0">
          Ver ranking <ChevronRight className="size-4" aria-hidden />
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="label-caps">Posição</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{data.position ? `${data.position}º` : "—"}</p>
            <p className="flex items-center gap-1 text-xs text-muted">
              {data.of > 0 ? `de ${data.of} em ${DEPARTMENT_LABELS[data.department]}` : "Diretoria fora do ranking"}
            </p>
            {data.delta !== null ? (
              <p className={`mt-0.5 inline-flex items-center gap-0.5 text-xs font-medium ${data.delta > 0 ? "text-success-fg" : data.delta < 0 ? "text-danger-fg" : "text-muted"}`}>
                <DeltaIcon className="size-3.5" aria-hidden />
                {data.delta === 0 ? "mesma posição" : `${Math.abs(data.delta)} ${data.delta > 0 ? "acima" : "abaixo"} do período anterior`}
              </p>
            ) : null}
          </div>
          <div>
            <p className="label-caps">Pontos no período</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.points)}</p>
            <p className="text-xs text-muted">{formatNumber(data.totalPoints)} acumulados</p>
          </div>
          <div>
            <p className="label-caps">Nível</p>
            <p className="mt-1 text-2xl font-semibold">{data.level.nome}</p>
            <p className="text-xs text-muted">{data.level.next ? `${formatNumber(data.level.next.missing)} pts para ${data.level.next.nome}` : "Nível máximo"}</p>
          </div>
        </div>
        <Progress value={data.level.progress * 100} tone="brand" size="sm" aria-label="Progresso até o próximo nível" />

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <Medal className="size-4 text-muted" aria-hidden /> Medalhas ({data.medals.length})
          </p>
          {data.medals.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma medalha ainda. Elas são desbloqueadas automaticamente pelos seus resultados.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.medals.slice(0, 4).map((m) => (
                <li key={`${m.key}-${m.unlockedAt}`} className="flex items-center gap-3">
                  <MedalIcon icon={m.icon} />
                  <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                  <span className="shrink-0 text-xs text-muted">{formatDate(m.unlockedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="size-4 text-muted" aria-hidden /> Últimos pontos
          </p>
          {data.recentPoints.length === 0 ? (
            <EmptyState size="sm" title="Sem pontos registrados" description="Pontos entram automaticamente quando você conclui tarefas no prazo, resolve chamados no SLA, ganha negócios e outras ações." />
          ) : (
            <ul className="divide-y divide-border">
              {data.recentPoints.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <span className="w-12 shrink-0 text-sm font-semibold tabular-nums text-success-fg">+{formatNumber(p.points)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm" title={p.reason}>
                    {p.reason}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{formatDate(p.createdAt, "dd/MM")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
