import { PageContainer } from "@/components/layout/page-container";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer aria-busy>
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="mb-5 flex flex-wrap gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-44" />
        ))}
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[96px]" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="rounded-xl border border-border bg-surface p-5">
          <SkeletonRows rows={7} />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-[220px]" />
          <Skeleton className="h-[200px]" />
        </div>
      </div>
    </PageContainer>
  );
}
