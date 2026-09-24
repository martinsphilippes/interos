import { PageContainer } from "@/components/layout/page-container";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

/** Esqueleto do workspace da Central de Vendas (fila | oportunidade | contexto). */
export default function Loading() {
  return (
    <PageContainer size="full" aria-busy>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-80 max-md:hidden" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[84px]" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[290px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_320px] 2xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        <div className="rounded-xl border border-border bg-surface p-4">
          <SkeletonRows rows={6} />
        </div>
        <Skeleton className="h-[600px] max-lg:hidden" />
        <div className="flex flex-col gap-4 max-xl:hidden">
          <Skeleton className="h-[180px]" />
          <Skeleton className="h-[160px]" />
          <Skeleton className="h-[240px]" />
        </div>
      </div>
    </PageContainer>
  );
}
