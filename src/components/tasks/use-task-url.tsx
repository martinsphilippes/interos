"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type ParamPatch = Record<string, string | null | undefined>;

/**
 * Estado da Central de Tarefas na URL (view, filtros, mês, tarefa aberta).
 *
 * - `setLocal`: só troca a URL (History API); o Next sincroniza `useSearchParams` sem ir ao servidor.
 *   Usado para filtros client-side, que ficam compartilháveis sem recarregar dados.
 * - `navigate`: navegação real (o servidor recarrega dados): view, mês do calendário, tarefa aberta.
 */
export function useTaskUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const href = React.useCallback(
    (patch: ParamPatch): string => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, searchParams],
  );

  const setLocal = React.useCallback(
    (patch: ParamPatch) => {
      window.history.replaceState(null, "", href(patch));
    },
    [href],
  );

  const navigate = React.useCallback(
    (patch: ParamPatch, options: { replace?: boolean } = {}) => {
      const url = href(patch);
      if (options.replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [href, router],
  );

  return { searchParams, href, setLocal, navigate };
}
