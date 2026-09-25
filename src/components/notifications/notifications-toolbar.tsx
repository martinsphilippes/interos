"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { NOTIFICATION_KINDS, type NotificationKind } from "@/domain/constants";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { markAllRead } from "@/server/notifications/actions";
import { NOTIFICATION_KIND_LABELS, type ReadFilter } from "./model";

export type { ReadFilter } from "./model";

export interface NotificationsToolbarProps {
  readFilter: ReadFilter;
  kindFilter?: NotificationKind;
  totals: { all: number; unread: number };
}

/** Filtros (todas / não lidas, tipo) na URL e ação "marcar todas como lidas". */
export function NotificationsToolbar({ readFilter, kindFilter, totals }: NotificationsToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const setParams = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === "todas") next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const markAll = () => {
    startTransition(async () => {
      const result = await markAllRead();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.data.count > 0 ? `${result.data.count} notificação${result.data.count === 1 ? "" : "ões"} marcada${result.data.count === 1 ? "" : "s"} como lida${result.data.count === 1 ? "" : "s"}` : "Nenhuma notificação pendente");
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl<ReadFilter>
          aria-label="Filtrar por leitura"
          value={readFilter}
          onChange={(value) => setParams({ filtro: value })}
          options={[
            { value: "todas", label: `Todas (${totals.all})` },
            { value: "nao-lidas", label: `Não lidas (${totals.unread})` },
          ]}
        />
        <Select
          aria-label="Filtrar por tipo"
          value={kindFilter ?? ""}
          onChange={(e) => setParams({ tipo: e.target.value || undefined })}
          className="w-44"
          options={[{ value: "", label: "Todos os tipos" }, ...NOTIFICATION_KINDS.map((k) => ({ value: k, label: NOTIFICATION_KIND_LABELS[k] }))]}
        />
      </div>
      <Button variant="outline" onClick={markAll} loading={pending} disabled={totals.unread === 0} className="min-h-[44px] md:min-h-9">
        <CheckCheck /> Marcar todas como lidas
      </Button>
    </div>
  );
}
