"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type ParamPatch = Record<string, string | null | undefined>;

/**
 * Estado das telas de administração na URL (drawer aberto, aba, filtros).
 *
 * - `setLocal`: só troca a URL (History API); o Next sincroniza `useSearchParams` sem ir ao servidor.
 * - `navigate`: navegação real (o servidor recarrega dados), usada para abrir/fechar drawers
 *   que dependem de dados do servidor (?usuario=<id>).
 */
export function useAdminUrl() {
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
