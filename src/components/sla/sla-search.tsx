"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchInput } from "@/components/ui/search-input";

/** Busca por cliente, protocolo, título ou responsável (?q=), com atraso para não navegar a cada tecla. */
export function SlaSearch({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = React.useTransition();
  const onChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next.trim()) params.set("q", next.trim());
    else params.delete("q");
    const query = params.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  };
  return <SearchInput value={value} onChange={onChange} debounceMs={450} placeholder="Buscar chamado, tarefa ou cliente" aria-label="Buscar SLA" className="md:[&_input]:h-9 [&_input]:h-11" />;
}
