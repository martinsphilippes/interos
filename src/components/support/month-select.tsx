"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";

/** Troca o mês de referência (?mes=AAAA-MM) recarregando os dados no servidor. */
export function MonthSelect({ value, options }: { value: string; options: { value: string; label: string }[] }) {
  const router = useRouter();
  return (
    <Select
      aria-label="Mês de referência"
      className="w-44"
      value={value}
      onChange={(e) => router.push(`?mes=${e.target.value}`, { scroll: false })}
      options={options}
    />
  );
}
