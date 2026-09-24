"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Lê um parâmetro de URL usado como gatilho (ex.: ?novo=1 das ações rápidas) e oferece `clear()` para
 * removê-lo sem perder os demais parâmetros. Use junto com o padrão "ajustar estado durante a renderização"
 * para abrir um diálogo quando o gatilho aparece.
 */
export function useUrlFlag(name: string, value = "1"): { active: boolean; clear: () => void } {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const active = searchParams.get(name) === value;
  const clear = React.useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete(name);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [name, pathname, router, searchParams]);
  return { active, clear };
}
