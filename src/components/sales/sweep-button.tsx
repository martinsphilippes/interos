"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { runFollowupSweep } from "@/server/sales/actions";

/** "Executar varredura" (gestor/admin): follow-ups vencidos viram tarefas; paradas notificam o gestor. */
export function SweepButton() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const run = () =>
    startTransition(async () => {
      const result = await runFollowupSweep();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { scanned, followupTasksCreated, stalledFlagged } = result.data;
      toast.success(`Varredura concluída: ${scanned} oportunidades, ${followupTasksCreated} tarefas de follow-up, ${stalledFlagged} paradas sinalizadas`);
      router.refresh();
    });
  return (
    <Button variant="outline" onClick={run} loading={pending} className="min-h-[44px] md:min-h-0">
      {!pending ? <RefreshCw /> : null} Executar varredura
    </Button>
  );
}
