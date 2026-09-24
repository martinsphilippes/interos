import { PageContainer } from "@/components/layout/page-container";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer aria-busy>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-9 w-72" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px]" />
        ))}
      </div>
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-5 lg:col-span-2">
          <SkeletonRows rows={6} />
        </div>
        <Skeleton className="h-[320px]" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[300px]" />
        <Skeleton className="h-[300px]" />
      </div>
    </PageContainer>
  );
}
