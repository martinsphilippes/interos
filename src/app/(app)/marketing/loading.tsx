import { PageContainer } from "@/components/layout/page-container";
import { Skeleton } from "@/components/ui/skeleton";

export default function MarketingLoading() {
  return (
    <PageContainer aria-busy>
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-80 max-w-full" />
        <Skeleton className="mt-2 h-8 w-72" />
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[84px]" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[300px]" />
        ))}
      </div>
    </PageContainer>
  );
}
