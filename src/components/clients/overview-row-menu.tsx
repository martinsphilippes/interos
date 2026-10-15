"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, Headset, ListChecks, MoreVertical } from "lucide-react";
import { completeTask } from "@/server/tasks/actions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";

function MenuTrigger({ label, disabled }: { label: string; disabled?: boolean }) {
  return (
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon" className="size-9 md:size-8" aria-label={label} disabled={disabled}>
        <MoreVertical />
      </Button>
    </DropdownMenuTrigger>
  );
}

/** Ações rápidas de uma tarefa na Visão geral do Cliente 360º (concluir só aparece com a permissão; o servidor revalida). */
export function TaskRowMenu({ taskId, title, clientId, canComplete }: { taskId: string; title: string; clientId: string; canComplete: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const complete = () =>
    startTransition(async () => {
      const result = await completeTask({ id: taskId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Tarefa concluída");
      router.refresh();
    });
  return (
    <DropdownMenu>
      <MenuTrigger label={`Ações da tarefa ${title}`} disabled={pending} />
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/tarefas?tarefa=${taskId}`}>
            <ExternalLink /> Abrir tarefa
          </Link>
        </DropdownMenuItem>
        {canComplete ? (
          <DropdownMenuItem onSelect={complete}>
            <CheckCircle2 /> Concluir tarefa
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href={`/clientes/${clientId}?aba=tarefas`}>
            <ListChecks /> Todas as tarefas do cliente
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Ações rápidas de um chamado na Visão geral do Cliente 360º. */
export function TicketRowMenu({ ticketId, number, clientId }: { ticketId: string; number: string; clientId: string }) {
  return (
    <DropdownMenu>
      <MenuTrigger label={`Ações do chamado ${number}`} />
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/suporte/chamados/${ticketId}`}>
            <ExternalLink /> Abrir chamado
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/clientes/${clientId}?aba=suporte`}>
            <Headset /> Todos os atendimentos do cliente
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
