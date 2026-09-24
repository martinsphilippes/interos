import { PageContainer } from "@/components/layout/page-container";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer aria-busy>
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-7 w-96 max-w-full" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-lg border border-border bg-surface p-5">
          <SkeletonRows rows={8} />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-56" />
          <Skeleton className="h-72" />
        </div>
      </div>
    </PageContainer>
  );
}
