import { PageContainer } from "@/components/layout/page-container";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

/** Esqueleto das telas de Performance: cabeçalho com filtros, linha de indicadores e blocos. */
export function PerformanceSkeleton({ cards = 4, blocks = 2 }: { cards?: number; blocks?: number }) {
  return (
    <PageContainer aria-busy>
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-52" />
          <Skeleton className="h-9 w-44" />
        </div>
      </div>
      {cards > 0 ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: cards }).map((_, i) => (
            <Skeleton key={i} className="h-[92px]" />
          ))}
        </div>
      ) : null}
      <div className="flex flex-col gap-4">
        {Array.from({ length: blocks }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-5">
            <Skeleton className="mb-4 h-5 w-56" />
            <SkeletonRows rows={5} />
          </div>
        ))}
      </div>
    </PageContainer>
  );
}
