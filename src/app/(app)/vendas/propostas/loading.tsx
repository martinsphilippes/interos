import { PageContainer } from "@/components/layout/page-container";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer aria-busy>
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="mb-4 h-9 w-full" />
      <div className="rounded-lg border border-border bg-surface p-5">
        <SkeletonRows rows={8} />
      </div>
    </PageContainer>
  );
}
