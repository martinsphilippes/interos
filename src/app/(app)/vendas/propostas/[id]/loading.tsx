import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-6" aria-busy>
      <Skeleton className="mb-4 h-9 w-full" />
      <Skeleton className="h-[720px] w-full" />
    </div>
  );
}
