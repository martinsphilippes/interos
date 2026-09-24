"use client";

import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { StepDetail } from "./step-detail";
import { useWorkflowUrl } from "./use-workflow-url";
import type { AssignableUserOption, StepDetail as StepDetailData } from "./workflow-model";

export interface StepDrawerProps {
  detail: StepDetailData | null;
  users: AssignableUserOption[];
  currentUserId: string;
}

/**
 * Drawer da etapa (?etapa=<stepId>). Recebe tudo do servidor; cada ação chama uma Server Action e
 * faz router.refresh(). Ao concluir, abre a próxima etapa no mesmo drawer.
 */
export function StepDrawer({ detail, users, currentUserId }: StepDrawerProps) {
  const { navigate } = useWorkflowUrl();
  const close = () => navigate({ etapa: null }, { replace: true });
  return (
    <Drawer open={Boolean(detail)} onOpenChange={(open) => !open && close()}>
      <DrawerContent size="lg">
        {detail ? (
          <>
            <DrawerTitle className="sr-only">
              Etapa {detail.stage.name} de {detail.client.tradeName}
            </DrawerTitle>
            <DrawerDescription className="sr-only">Detalhe da etapa do workflow com gate, tarefas, histórico e ações.</DrawerDescription>
            <DrawerBody className="pt-5">
              <StepDetail
                key={detail.step.id}
                detail={detail}
                users={users}
                currentUserId={currentUserId}
                variant="drawer"
                onCompleted={(nextStepId) => (nextStepId ? navigate({ etapa: nextStepId }, { replace: true }) : close())}
              />
            </DrawerBody>
          </>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
