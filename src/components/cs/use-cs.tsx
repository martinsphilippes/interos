"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ActionResult } from "@/domain/types";
import { toast } from "@/components/ui/toast";

export type ParamPatch = Record<string, string | null | undefined>;

/**
 * Estado das telas de CS na URL (escopo, filtros, drawers).
 * `navigate` faz navegação real (o servidor recarrega os dados), usada para filtros e drawers.
 */
export function useCsUrl() {
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

  const navigate = React.useCallback(
    (patch: ParamPatch, options: { replace?: boolean } = {}) => {
      const url = href(patch);
      if (options.replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [href, router],
  );

  return { searchParams, href, navigate };
}

/**
 * Executa uma Server Action com useTransition: toast de erro/sucesso e router.refresh() no sucesso.
 * `run` resolve true quando deu certo (útil para fechar diálogos).
 */
export function useCsAction() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const run = React.useCallback(
    <T,>(action: () => Promise<ActionResult<T>>, success: string | ((data: T) => string), after?: (data: T) => void): Promise<boolean> =>
      new Promise((resolve) => {
        startTransition(async () => {
          const result = await action();
          if (!result.ok) {
            toast.error(result.error);
            resolve(false);
            return;
          }
          toast.success(typeof success === "function" ? success(result.data) : success);
          after?.(result.data);
          router.refresh();
          resolve(true);
        });
      }),
    [router],
  );

  return { pending, run };
}
