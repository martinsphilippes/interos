"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Rocket } from "lucide-react";
import type { GoLiveCandidate } from "@/server/implementation/queries";
import type { GoLiveCheck } from "@/server/implementation/schemas";
import { approveProjectGoLive } from "@/server/implementation/actions";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Progress } from "@/components/ui/progress";
import { SlaBadge } from "@/components/ui/sla-badge";
import { GateChecklist } from "./go-live-panel";
import { ProductChips, progressTone } from "./projects-table";
import { useImplementationAction } from "./use-implementation-action";

/** Aba do projeto onde cada exigência do gate é resolvida. */
const FIX_TAB: Record<GoLiveCheck["key"], string> = { status: "pendencias", checklist: "checklist", tarefas: "plano", treinamento: "treinamentos", validacao: "go-live", aceite: "go-live" };

/** Card de um candidato a go-live: gate com o que falta e aprovação direta quando tudo está atendido. */
export function GoLiveCandidateCard({ candidate, canOperate }: { candidate: GoLiveCandidate; canOperate: boolean }) {
  const { row, gate, canApprove } = candidate;
  const { run } = useImplementationAction();
  const [confirm, setConfirm] = React.useState(false);
  const firstMissing = gate.checks.find((c) => !c.ok);
  return (
    <article className={cn("flex flex-col gap-3 rounded-lg border bg-surface p-4 shadow-card", gate.ok ? "border-success/50" : "border-border")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/implantacao/${row.id}?aba=go-live`} className="font-semibold hover:underline">
            {row.clientName}
          </Link>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Avatar name={row.ownerName} src={row.ownerAvatarUrl} size="xs" /> {row.ownerName} · prazo <span className={cn(row.overdue && "font-medium text-danger-fg")}>{formatDate(row.dueDate)}</span>
          </p>
        </div>
        {row.sla ? <SlaBadge state={row.sla.state} remainingMs={row.sla.remainingMs} timeOnly /> : null}
      </div>
      <ProductChips products={row.products} />
      <Progress value={row.progress} showValue size="sm" tone={progressTone(row)} />
      <GateChecklist gate={gate} compact />
      <div className="mt-auto flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm" className="h-11 md:h-8">
          <Link href={`/implantacao/${row.id}?aba=${firstMissing ? FIX_TAB[firstMissing.key] : "go-live"}`}>
            {gate.ok ? "Abrir go-live" : "Resolver pendências"} <ArrowRight />
          </Link>
        </Button>
        {canOperate && gate.ok && canApprove ? (
          <Button size="sm" className="h-11 md:h-8" onClick={() => setConfirm(true)}>
            <Rocket /> Aprovar go-live
          </Button>
        ) : null}
      </div>
      {confirm ? (
        <ConfirmDialog
          open
          onOpenChange={setConfirm}
          title={`Aprovar go-live de ${row.clientName}?`}
          description="O projeto será concluído, os produtos ativados e o cliente entregue ao Customer Success."
          confirmLabel="Aprovar go-live"
          onConfirm={async () => {
            await run(() => approveProjectGoLive({ projectId: row.id }), (d) => `Go-live aprovado! Handoff para ${d.csOwnerName}.`);
          }}
        />
      ) : null}
    </article>
  );
}
