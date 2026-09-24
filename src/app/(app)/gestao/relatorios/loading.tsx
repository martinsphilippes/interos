import { PageContainer } from "@/components/layout/page-container";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer size="full" className="max-w-[1600px]" aria-busy>
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
        <div className="flex flex-col gap-5">
          <Skeleton className="h-[180px]" />
          <div className="rounded-lg border border-border bg-surface p-5">
            <SkeletonRows rows={8} />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
