import { PageContainer } from "@/components/layout/page-container";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

export default function CampanhasLoading() {
  return (
    <PageContainer aria-busy>
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[76px]" />
        ))}
      </div>
      <div className="rounded-lg border border-border bg-surface p-5">
        <SkeletonRows rows={6} />
      </div>
    </PageContainer>
  );
}
