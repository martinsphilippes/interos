import { PageContainer } from "@/components/layout/page-container";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer size="full" aria-busy>
      <div className="mb-4 flex flex-col gap-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[156px_minmax(0,1fr)_340px]">
        <Skeleton className="h-24 lg:h-[600px]" />
        <Skeleton className="h-[420px] lg:h-[600px]" />
        <Skeleton className="h-64 lg:h-[600px]" />
      </div>
    </PageContainer>
  );
}
