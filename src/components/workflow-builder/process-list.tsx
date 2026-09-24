import Link from "next/link";
import { Activity, ChevronRight, GitBranch, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRelative } from "@/lib/format";
import { PROCESS_STATUS_LABELS } from "@/domain/workflow-graph";
import type { ProcessSummary } from "@/server/process-engine/queries";
import { NewProcessButton } from "./new-process-button";

function triggerLabel(p: ProcessSummary): string {
  return p.trigger.type === "evento" ? p.trigger.eventType : "Manual";
}

function StatusBadges({ p }: { p: ProcessSummary }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {p.publishedVersion ? (
        <Badge size="sm" variant="success">
          Publicado v{p.publishedVersion}
        </Badge>
      ) : null}
      {p.latestStatus === "rascunho" ? (
        <Badge size="sm" variant="warning">
          {PROCESS_STATUS_LABELS.rascunho} v{p.latestVersion}
        </Badge>
      ) : null}
      {!p.publishedVersion && p.latestStatus !== "rascunho" ? (
        <Badge size="sm" variant="muted">
          {PROCESS_STATUS_LABELS[p.latestStatus]}
        </Badge>
      ) : null}
    </span>
  );
}

/** Processos com ramificações (construtor visual), agrupados por chave com as versões. */
export function ProcessList({ processes }: { processes: ProcessSummary[] }) {
  if (processes.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={<GitBranch />}
        title="Nenhum processo criado"
        description="Desenhe processos com tarefas, aprovações, condições e esperas que rodam sobre as mesmas tarefas, SLAs e notificações do sistema."
        action={<NewProcessButton />}
      />
    );
  }
  return (
    <>
      <ul className="flex flex-col gap-2 md:hidden">
        {processes.map((p) => (
          <li key={p.key} className="rounded-lg border border-border bg-surface p-3 shadow-card">
            <Link href={`/admin/workflows/processos/${p.latestId}`} className="flex min-h-[44px] items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                  <Zap className="size-3" /> {triggerLabel(p)} · {p.nodes} blocos
                </span>
              </span>
              <ChevronRight className="mt-1 size-4 shrink-0 text-muted-light" />
            </Link>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <StatusBadges p={p} />
              <Link href={`/admin/workflows/processos/${p.publishedId ?? p.latestId}/execucoes`} className="inline-flex min-h-[44px] items-center gap-1 text-xs text-secondary-fg">
                <Activity className="size-3.5" /> {p.runs.em_andamento} em andamento · {p.runs.concluido} concluída(s)
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-hidden rounded-lg border border-border bg-surface shadow-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Processo</TableHead>
              <TableHead>Gatilho</TableHead>
              <TableHead>Versões</TableHead>
              <TableHead>Blocos</TableHead>
              <TableHead>Execuções</TableHead>
              <TableHead>Atualizado</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {processes.map((p) => (
              <TableRow key={p.key}>
                <TableCell>
                  <Link href={`/admin/workflows/processos/${p.latestId}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                  {p.description ? <p className="line-clamp-1 max-w-md text-xs text-muted">{p.description}</p> : null}
                </TableCell>
                <TableCell>
                  <code className="text-xs text-muted">{triggerLabel(p)}</code>
                </TableCell>
                <TableCell>
                  <StatusBadges p={p} />
                </TableCell>
                <TableCell className="tabular-nums">{p.nodes}</TableCell>
                <TableCell>
                  <Link href={`/admin/workflows/processos/${p.publishedId ?? p.latestId}/execucoes`} className="text-sm hover:underline">
                    <span className="tabular-nums text-brand-fg">{p.runs.em_andamento}</span> ativa(s) · <span className="tabular-nums">{p.runs.concluido}</span> concluída(s)
                    {p.runs.erro ? <span className="text-danger-fg"> · {p.runs.erro} com erro</span> : null}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted">{formatRelative(p.updatedAt)}</TableCell>
                <TableCell className="text-right">
                  <Link href={`/admin/workflows/processos/${p.latestId}`} className="inline-flex min-h-[36px] items-center gap-1 whitespace-nowrap text-sm text-secondary-fg hover:underline">
                    Abrir construtor <ChevronRight className="size-4" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
