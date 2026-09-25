import { PageContainer } from "@/components/layout/page-container";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer size="full" aria-busy>
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-7 w-72" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="rounded-lg border border-border bg-surface p-5">
          <SkeletonRows rows={5} />
        </div>
        <Skeleton className="h-[460px]" />
      </div>
    </PageContainer>
  );
}
