"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, GraduationCap, XCircle } from "lucide-react";
import type { Training } from "@/domain/types";
import { cancelProjectTraining } from "@/server/implementation/actions";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { TRAINING_STATUS_LABELS, TRAINING_STATUS_VARIANT } from "@/components/clients/labels";
import { CompleteTrainingDialog } from "./training-dialog";
import { useImplementationAction } from "./use-implementation-action";

export interface TrainingItem extends Pick<Training, "id" | "subject" | "status" | "scheduledAt" | "completedAt" | "participants" | "materialUrl" | "evidence" | "notes" | "projectId"> {
  instructorName: string;
  productName?: string;
  clientName?: string;
  projectName?: string;
}

/** Lista de treinamentos em cards: agendados podem ser concluídos (com evidência) ou cancelados. */
export function TrainingsList({ items, canOperate, showProject, emptyDescription }: { items: TrainingItem[]; canOperate: boolean; showProject?: boolean; emptyDescription?: string }) {
  const [completing, setCompleting] = React.useState<TrainingItem | null>(null);
  const [cancelling, setCancelling] = React.useState<TrainingItem | null>(null);
  const { run } = useImplementationAction();
  const now = React.useMemo(() => new Date().toISOString(), []);

  if (items.length === 0) {
    return <EmptyState size="sm" icon={<GraduationCap />} title="Nenhum treinamento" description={emptyDescription ?? "Agende ou registre o treinamento do cliente. O go-live exige pelo menos um realizado."} />;
  }
  return (
    <>
      <ul className="flex flex-col divide-y divide-border">
        {items.map((t) => {
          const late = t.status === "agendado" && t.scheduledAt < now;
          return (
            <li key={t.id} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-start md:gap-4 md:px-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{t.subject}</p>
                  <Badge variant={late ? "warning" : TRAINING_STATUS_VARIANT[t.status]} size="sm">
                    {late ? "Agendado · data passou" : TRAINING_STATUS_LABELS[t.status]}
                  </Badge>
                  {t.productName ? (
                    <span className="rounded-sm bg-secondary-soft px-1.5 py-0.5 text-[11px] text-secondary-fg">{t.productName}</span>
                  ) : null}
                </div>
                {showProject && t.projectId ? (
                  <Link href={`/implantacao/${t.projectId}?aba=treinamentos`} className="text-sm text-secondary-fg hover:underline">
                    {t.clientName} · {t.projectName}
                  </Link>
                ) : showProject ? (
                  <p className="text-sm text-muted">{t.clientName}</p>
                ) : null}
                <p className={cn("text-sm text-muted", late && "text-warning-fg")}>
                  {formatDateTime(t.status === "realizado" ? (t.completedAt ?? t.scheduledAt) : t.scheduledAt)} · Instrutor: {t.instructorName}
                </p>
                {t.participants.length > 0 ? <p className="text-xs text-muted">Participantes: {t.participants.join(", ")}</p> : null}
                {t.evidence ? <p className="text-xs text-muted">Evidência: {t.evidence}</p> : null}
                {t.notes ? <p className="text-xs text-muted">{t.notes}</p> : null}
                {t.materialUrl ? (
                  <a href={t.materialUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-secondary-fg hover:underline">
                    <ExternalLink className="size-3" /> Material
                  </a>
                ) : null}
              </div>
              {canOperate && t.status === "agendado" ? (
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" className="h-11 md:h-8" onClick={() => setCompleting(t)}>
                    <CheckCircle2 /> Concluir
                  </Button>
                  <Button size="sm" variant="ghost" className="h-11 md:h-8" onClick={() => setCancelling(t)}>
                    <XCircle /> Cancelar
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {completing ? <CompleteTrainingDialog open onOpenChange={(v) => !v && setCompleting(null)} trainingId={completing.id} subject={completing.subject} /> : null}
      {cancelling ? (
        <ConfirmDialog
          open
          onOpenChange={(v) => !v && setCancelling(null)}
          title="Cancelar treinamento?"
          description={cancelling.subject}
          confirmLabel="Cancelar treinamento"
          cancelLabel="Voltar"
          destructive
          onConfirm={async () => {
            await run(() => cancelProjectTraining({ trainingId: cancelling.id }), "Treinamento cancelado");
          }}
        />
      ) : null}
    </>
  );
}
