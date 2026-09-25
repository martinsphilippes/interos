import { PageContainer } from "@/components/layout/page-container";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

export default function LeadsLoading() {
  return (
    <PageContainer aria-busy>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-72 max-w-full" />
          <Skeleton className="mt-2 h-8 w-44" />
        </div>
        <Skeleton className="h-9 w-56" />
      </div>
      <div className="mb-4 flex flex-col gap-2 md:flex-row">
        <Skeleton className="h-9 w-full md:max-w-md" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="rounded-lg border border-border bg-surface p-5">
        <SkeletonRows rows={8} />
      </div>
    </PageContainer>
  );
}
