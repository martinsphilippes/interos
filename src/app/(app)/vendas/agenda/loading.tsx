import { PageContainer } from "@/components/layout/page-container";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <PageContainer size="full" aria-busy>
      <div className="mb-5 flex flex-col gap-3">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-9 w-full max-w-2xl" />
      </div>
      <div className="grid gap-2 md:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-[220px]" />
        ))}
      </div>
    </PageContainer>
  );
}
