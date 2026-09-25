import { PageContainer } from "@/components/layout/page-container";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

export default function CaixaDeEntradaLoading() {
  return (
    <PageContainer aria-busy>
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="mb-5 h-16" />
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-lg border border-border bg-surface p-5">
          <SkeletonRows rows={6} />
        </div>
        <div className="rounded-lg border border-border bg-surface p-5">
          <SkeletonRows rows={4} />
        </div>
      </div>
    </PageContainer>
  );
}
