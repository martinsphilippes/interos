import { PageContainer } from "@/components/layout/page-container";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

/** Esqueleto do workspace da Central de Suporte (indicadores + fila | chamado | contexto). */
export default function Loading() {
  return (
    <PageContainer size="full" aria-busy>
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[92px]" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_300px] 2xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="hidden rounded-xl border border-border bg-surface p-5 lg:block">
          <SkeletonRows rows={8} />
        </div>
        <div className="hidden flex-col gap-3 xl:flex">
          <Skeleton className="h-44" />
          <Skeleton className="h-40" />
          <Skeleton className="h-32" />
        </div>
      </div>
    </PageContainer>
  );
}
