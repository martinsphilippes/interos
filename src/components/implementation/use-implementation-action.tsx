"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/domain/types";
import { toast } from "@/components/ui/toast";

/**
 * Executa uma Server Action da Implantação com useTransition: toast de erro/sucesso e router.refresh()
 * no sucesso. `run` devolve true quando a action deu certo (útil para fechar diálogos).
 */
export function useImplementationAction() {
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
