import { PageContainer } from "@/components/layout/page-container";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

/** Esqueleto das telas do Financeiro (usado pelos loading.tsx das rotas). */
export function FinanceSkeleton({ cards = 8, variant = "list" }: { cards?: number; variant?: "list" | "detail" | "charts" }) {
  return (
    <PageContainer aria-busy>
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-60" />
        <Skeleton className="h-4 w-72" />
      </div>
      {cards > 0 ? (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: cards }).map((_, i) => (
            <Skeleton key={i} className="h-[88px]" />
          ))}
        </div>
      ) : null}
      {variant === "detail" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-4 lg:col-span-2">
            <Skeleton className="h-[260px]" />
            <Skeleton className="h-[200px]" />
            <Skeleton className="h-[260px]" />
          </div>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-[220px]" />
            <Skeleton className="h-[260px]" />
            <Skeleton className="h-[160px]" />
          </div>
        </div>
      ) : variant === "charts" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[300px]" />
          <Skeleton className="h-[300px]" />
          <div className="rounded-lg border border-border bg-surface p-5 lg:col-span-2">
            <SkeletonRows rows={6} />
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface p-5">
          <Skeleton className="mb-4 h-9 w-full max-w-2xl" />
          <SkeletonRows rows={8} />
        </div>
      )}
    </PageContainer>
  );
}
