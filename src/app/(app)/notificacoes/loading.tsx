import { PageContainer } from "@/components/layout/page-container";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer size="narrow" aria-busy>
      <div className="mb-5 flex flex-col gap-3">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64" />
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-48" />
        </div>
      </div>
      <div className="rounded-lg border border-border bg-surface p-4">
        <Skeleton className="mb-3 h-3 w-16" />
        <SkeletonRows rows={4} />
        <Skeleton className="mb-3 mt-6 h-3 w-16" />
        <SkeletonRows rows={4} />
      </div>
    </PageContainer>
  );
}
