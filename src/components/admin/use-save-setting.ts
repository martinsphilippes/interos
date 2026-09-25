"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { SettingKey } from "@/server/admin/schemas";
import { upsertSetting } from "@/server/admin/actions";
import { toast } from "@/components/ui/toast";

/** Salva uma configuração (settings/<key>) com toast e refresh; devolve o erro para o formulário. */
export function useSaveSetting(key: SettingKey) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const save = React.useCallback(
    (value: unknown, successMessage = "Configuração salva") => {
      setError(null);
      startTransition(async () => {
        const result = await upsertSetting({ key, value });
        if (!result.ok) {
          setError(result.error);
          toast.error(result.error);
          return;
        }
        toast.success(successMessage);
        router.refresh();
      });
    },
    [key, router],
  );

  return { pending, error, setError, save };
}
