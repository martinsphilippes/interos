import { PageContainer } from "@/components/layout/page-container";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer size="narrow" aria-busy>
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-96" />
    </PageContainer>
  );
}
