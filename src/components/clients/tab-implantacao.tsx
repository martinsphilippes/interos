import { AlertTriangle, CheckCircle2, Circle, GraduationCap, Rocket } from "lucide-react";
import type { Client360 } from "@/server/clients/queries";
import { IMPLEMENTATION_PHASES, type ImplementationPhase } from "@/domain/types";
import { TASK_STATUS_LABELS } from "@/domain/constants";
import { formatDate, formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { SectionTitle } from "@/components/ui/section-title";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { UserCell } from "./client-badges";
import { IMPLEMENTATION_PHASE_LABELS, IMPLEMENTATION_STATUS_LABELS, IMPLEMENTATION_STATUS_VARIANT, TRAINING_STATUS_LABELS, TRAINING_STATUS_VARIANT } from "./labels";

/** Aba Implantação (somente leitura): projetos, fase, checklist, tarefas por fase e treinamentos. */
export function TabImplantacao({ data }: { data: Client360 }) {
  const { projects, implementationTasks, trainings, users } = data;
  const now = new Date().toISOString();

  return (
    <div className="flex flex-col gap-5">
      {projects.length === 0 ? (
        <Card>
          <EmptyState size="sm" icon={<Rocket />} title="Nenhum projeto de implantação" description="O projeto é criado quando o Financeiro libera o cliente." />
        </Card>
      ) : (
        projects.map((project) => {
          const tasks = implementationTasks.filter((t) => t.projectId === project.id);
          const overdue = !project.completedAt && project.dueDate < now;
          const phases = IMPLEMENTATION_PHASES.filter((ph) => tasks.some((t) => t.phase === ph));
          const currentIdx = IMPLEMENTATION_PHASES.indexOf(project.currentPhase);
          return (
            <Card key={project.id}>
              <CardHeader className="gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2">
                    {project.name}
                    <Badge variant={IMPLEMENTATION_STATUS_VARIANT[project.status]} size="sm">
                      {IMPLEMENTATION_STATUS_LABELS[project.status]}
                    </Badge>
                  </CardTitle>
                  <UserCell users={users} id={project.ownerId} size="md" withSubtitle />
                </div>
                {project.scope ? <p className="text-sm text-muted">{project.scope}</p> : null}
              </CardHeader>
              <CardContent className="flex flex-col gap-5 pt-0">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="sm:col-span-2">
                    <p className="label-caps mb-1.5">Progresso</p>
                    <Progress value={project.progress} showValue tone={project.status === "bloqueada" ? "danger" : project.status === "aguardando_cliente" ? "warning" : project.status === "concluida" ? "success" : "brand"} />
                  </div>
                  <div>
                    <p className="label-caps">Prazo</p>
                    <p className={cn("mt-1 text-sm font-medium", overdue && "text-danger-fg")}>
                      {formatDate(project.dueDate)}
                      <span className="block text-xs font-normal text-muted">{project.completedAt ? `Concluída em ${formatDate(project.completedAt)}` : `${overdue ? "Atrasada " : ""}${formatRelative(project.dueDate)}`}</span>
                    </p>
                  </div>
                  <div>
                    <p className="label-caps">Fase atual</p>
                    <p className="mt-1 text-sm font-medium">{IMPLEMENTATION_PHASE_LABELS[project.currentPhase]}</p>
                    <p className="text-xs text-muted">
                      Início {formatDate(project.startDate)}
                      {project.externalDelayDays > 0 ? ` · ${project.externalDelayDays}d parados pelo cliente` : ""}
                    </p>
                  </div>
                </div>

                {project.waitingClient ? (
                  <div role="status" className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-fg" aria-hidden />
                    <div>
                      <p className="font-medium text-warning-fg">Pendência do cliente desde {formatDate(project.waitingClient.since)}</p>
                      <p className="text-foreground">{project.waitingClient.reason}</p>
                      {project.waitingClient.evidence ? <p className="mt-0.5 text-xs text-muted">{project.waitingClient.evidence}</p> : null}
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
                  <div>
                    <p className="label-caps mb-2">Checklist</p>
                    <ul className="flex flex-col gap-1.5">
                      {project.checklist.map((item) => (
                        <li key={item.id} className="flex items-start gap-2 text-sm">
                          {item.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-light" aria-hidden />}
                          <span className={cn("capitalize", item.done ? "text-muted line-through" : "text-foreground")}>{item.label}</span>
                        </li>
                      ))}
                      {project.checklist.length === 0 ? <li className="text-sm text-muted">Sem itens.</li> : null}
                    </ul>
                    {project.acceptance ? (
                      <p className="mt-3 rounded-md bg-success-soft p-2 text-xs text-success-fg">
                        Aceite de {project.acceptance.acceptedBy} em {formatDate(project.acceptance.acceptedAt)}
                        {project.acceptance.notes ? ` · ${project.acceptance.notes}` : ""}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <p className="label-caps mb-2">Tarefas por fase ({tasks.filter((t) => t.status === "concluida").length}/{tasks.length} concluídas)</p>
                    {phases.length === 0 ? (
                      <p className="text-sm text-muted">Sem tarefas geradas.</p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {phases.map((ph: ImplementationPhase) => {
                          const phaseTasks = tasks.filter((t) => t.phase === ph);
                          const done = phaseTasks.filter((t) => t.status === "concluida").length;
                          const phIdx = IMPLEMENTATION_PHASES.indexOf(ph);
                          const isCurrent = ph === project.currentPhase;
                          return (
                            <details key={ph} open={isCurrent} className="group/phase rounded-md border border-border">
                              <summary className="flex min-h-[40px] cursor-pointer list-none items-center gap-2 px-3 text-sm [&::-webkit-details-marker]:hidden">
                                {done === phaseTasks.length ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <Circle className={cn("size-4", isCurrent ? "text-brand" : "text-muted-light")} aria-hidden />}
                                <span className={cn("font-medium", phIdx < currentIdx && !isCurrent && "text-muted")}>{IMPLEMENTATION_PHASE_LABELS[ph]}</span>
                                {isCurrent ? (
                                  <Badge variant="brand" size="sm">
                                    Atual
                                  </Badge>
                                ) : null}
                                <span className="ml-auto text-xs tabular-nums text-muted">
                                  {done}/{phaseTasks.length}
                                </span>
                              </summary>
                              <ul className="divide-y divide-border border-t border-border">
                                {phaseTasks.map((t) => (
                                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                                    <span className={cn("min-w-0 flex-1", t.status === "concluida" && "text-muted line-through")}>
                                      {t.title}
                                      {t.required ? null : <span className="ml-1 text-xs text-muted-light">(opcional)</span>}
                                    </span>
                                    <Badge variant={t.status === "concluida" ? "success" : t.status === "em_andamento" ? "info" : t.status === "aguardando" ? "warning" : "muted"} size="sm">
                                      {TASK_STATUS_LABELS[t.status]}
                                    </Badge>
                                    <UserCell users={users} id={t.assigneeId} />
                                    <span className={cn("text-xs text-muted", t.dueAt && t.status !== "concluida" && t.dueAt < now && "text-danger-fg")}>{t.dueAt ? formatDate(t.dueAt) : ""}</span>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      <section>
        <SectionTitle title="Treinamentos" count={trainings.length} />
        <Card className="overflow-hidden">
          {trainings.length === 0 ? (
            <EmptyState size="sm" icon={<GraduationCap />} title="Nenhum treinamento" description="Treinamentos agendados e realizados aparecem aqui." />
          ) : (
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Assunto</TableHead>
                  <TableHead>Instrutor</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Participantes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trainings.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">
                      {t.subject}
                      {t.notes ? <p className="text-xs font-normal text-muted">{t.notes}</p> : null}
                    </TableCell>
                    <TableCell>
                      <UserCell users={users} id={t.instructorId} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted">{formatDate(t.scheduledAt, "dd/MM/yyyy HH:mm")}</TableCell>
                    <TableCell>
                      <Badge variant={TRAINING_STATUS_VARIANT[t.status]} size="sm">
                        {TRAINING_STATUS_LABELS[t.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-muted" title={t.participants.join(", ")}>
                      {t.participants.join(", ") || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>
    </div>
  );
}
