import type { Client360 } from "@/server/clients/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Timeline } from "@/components/timeline/timeline";
import { NoteForm } from "./note-form";

/** Aba Timeline: nota rápida + linha do tempo única do cliente. */
export function TabTimeline({ data }: { data: Client360 }) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="py-4">
          <NoteForm clientId={data.client.id} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-5">
          <Timeline events={data.timeline} emptyDescription="Registre uma nota ou uma ligação para começar o histórico deste cliente." />
        </CardContent>
      </Card>
    </div>
  );
}
