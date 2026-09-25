import { PerformanceSkeleton } from "@/components/performance/performance-skeleton";

export default function Loading() {
  return <PerformanceSkeleton cards={4} blocks={3} />;
}
