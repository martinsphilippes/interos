import { PageContainer } from "@/components/layout/page-container";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer aria-busy>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-44" />
      </div>
      <Skeleton className="mb-2 h-9 w-full" />
      <Skeleton className="mb-4 h-6 w-64" />
      <div className="rounded-lg border border-border bg-surface p-5">
        <SkeletonRows rows={10} />
      </div>
    </PageContainer>
  );
}
