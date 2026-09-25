import { PageContainer } from "@/components/layout/page-container";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer aria-busy>
      <div className="mb-5 flex flex-col gap-3">
        <Skeleton className="h-3 w-48" />
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-9 w-52" />
        </div>
        <Skeleton className="h-6 w-56" />
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[108px]" />
        ))}
      </div>
      <div className="mb-5 grid gap-5 xl:grid-cols-[2fr_1fr]">
        <Skeleton className="h-[330px]" />
        <Skeleton className="h-[330px]" />
      </div>
      <div className="rounded-lg border border-border bg-surface p-5">
        <SkeletonRows rows={8} />
      </div>
    </PageContainer>
  );
}
