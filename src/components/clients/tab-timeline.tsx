import type { Client360 } from "@/server/clients/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Timeline } from "@/components/timeline/timeline";
import { NoteForm } from "./note-form";

/**
 * Aba Timeline: nota rápida + linha do tempo única do cliente. `canRegister` (calculado no servidor): sem a ação de
 * registrar nota o formulário não aparece.
 */
export function TabTimeline({ data, canRegister = true }: { data: Client360; canRegister?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {canRegister ? (
        <Card>
          <CardContent className="py-4">
            <NoteForm clientId={data.client.id} />
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardContent className="py-5">
          <Timeline events={data.timeline} emptyDescription="Registre uma nota ou uma ligação para começar o histórico deste cliente." />
        </CardContent>
      </Card>
    </div>
  );
}
