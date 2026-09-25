import { FinanceSkeleton } from "@/components/finance/finance-skeleton";

export default function Loading() {
  return <FinanceSkeleton cards={5} variant="charts" />;
}
