import { PageContainer } from "@/components/layout/page-container";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

/** Esqueleto das telas de CS (loading.tsx de cada rota). */
export function CsSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <PageContainer aria-busy>
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="rounded-lg border border-border bg-surface p-5">
        <SkeletonRows rows={6} />
      </div>
    </PageContainer>
  );
}
