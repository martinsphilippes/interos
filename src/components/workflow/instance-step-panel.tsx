"use client";

import { useRouter } from "next/navigation";
import { StepDetail } from "./step-detail";
import type { AssignableUserOption, StepDetail as StepDetailData } from "./workflow-model";

/** Detalhe da etapa dentro de /workflow/[instanceId]: ao concluir, seleciona a próxima etapa na própria página. */
export function InstanceStepPanel({ detail, users, currentUserId }: { detail: StepDetailData; users: AssignableUserOption[]; currentUserId: string }) {
  const router = useRouter();
  return (
    <StepDetail
      key={detail.step.id}
      detail={detail}
      users={users}
      currentUserId={currentUserId}
      variant="page"
      onCompleted={(nextStepId) => router.replace(nextStepId ? `/workflow/${detail.instance.id}?etapa=${nextStepId}` : `/workflow/${detail.instance.id}`, { scroll: false })}
    />
  );
}
