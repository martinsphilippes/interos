import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/server/auth/session";
import { getRun } from "@/server/process-engine/store";

type Params = Promise<{ runId: string }>;

/** Link curto de uma execução (usado por tarefas e notificações): leva à tela de execuções do processo. */
export default async function ProcessRunRedirectPage({ params }: { params: Params }) {
  await requireRole("admin");
  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) notFound();
  redirect(`/admin/workflows/processos/${run.definitionId}/execucoes?run=${run.id}`);
}
