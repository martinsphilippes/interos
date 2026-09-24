import { CheckCircle2, Circle, HeartPulse, RefreshCw, Route } from "lucide-react";
import type { Client360 } from "@/server/clients/queries";
import { formatDate, formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { SectionTitle } from "@/components/ui/section-title";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { HEALTH_LABELS, HealthIndicator, UserCell, healthTone } from "./client-badges";
import { RENEWAL_STATUS_LABELS, RENEWAL_STATUS_VARIANT, SUCCESS_PLAN_STATUS_LABELS } from "./labels";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="label-caps">{label}</p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

/** Aba CS: conta de sucesso, saúde explicada por fatores, planos de sucesso e renovações. */
export function TabCs({ data, panel }: { data: Client360; panel?: React.ReactNode }) {
  const { client, csAccount, healthScore, successPlans, renewals, users } = data;
  const now = new Date().toISOString();
  const level = healthScore?.level ?? client.healthLevel;
  const score = healthScore?.score ?? client.healthScore;

  return (
    <div className="flex flex-col gap-5">
      {panel}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Conta de sucesso</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {!csAccount ? (
              <EmptyState size="sm" icon={<HeartPulse />} title="Sem conta de CS" description="A conta é criada na ativação do cliente (etapa de Customer Success)." />
            ) : (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Responsável">
                    <UserCell users={users} id={csAccount.ownerId} size="md" withSubtitle />
                  </Field>
                  <Field label="Nível de risco">
                    <HealthIndicator level={csAccount.riskLevel} score={score} showLabel />
                  </Field>
                  <Field label="Adoção">
                    <Progress value={csAccount.adoptionPct} showValue tone={csAccount.adoptionPct >= 70 ? "success" : csAccount.adoptionPct >= 40 ? "warning" : "danger"} />
                  </Field>
                  <Field label="Satisfação">{csAccount.satisfaction !== undefined ? <span className="tabular-nums">{csAccount.satisfaction.toFixed(1)} / 10</span> : "—"}</Field>
                  <Field label="Última interação">{csAccount.lastInteractionAt ? formatRelative(csAccount.lastInteractionAt) : "—"}</Field>
                  <Field label="Próxima interação">
                    {csAccount.nextInteractionAt ? (
                      <span className={cn(csAccount.nextInteractionAt < now && "text-danger-fg")}>
                        {formatDate(csAccount.nextInteractionAt)} · {formatRelative(csAccount.nextInteractionAt)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Field>
                  <Field label="Ativado em">{formatDate(csAccount.activatedAt)}</Field>
                  <Field label="Renovação">{csAccount.renewalDate ? `${formatDate(csAccount.renewalDate)} · ${formatRelative(csAccount.renewalDate)}` : "—"}</Field>
                </div>
                {csAccount.riskReasons.length > 0 ? (
                  <div>
                    <p className="label-caps mb-1.5">Riscos identificados</p>
                    <ul className="flex flex-wrap gap-1.5">
                      {csAccount.riskReasons.map((r) => (
                        <li key={r}>
                          <Badge variant={csAccount.riskLevel === "risco" ? "danger" : "warning"} size="sm">
                            {r}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {csAccount.notes ? <p className="rounded-md bg-surface-muted p-3 text-sm text-muted">{csAccount.notes}</p> : null}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
            <div>
              <CardTitle>Saúde do cliente</CardTitle>
              {healthScore ? <p className="mt-0.5 text-xs text-muted">Calculada {formatRelative(healthScore.computedAt)}</p> : null}
            </div>
            {score !== undefined ? (
              <div className="text-right">
                <p className={cn("text-3xl font-semibold tabular-nums leading-none", level === "risco" ? "text-danger-fg" : level === "atencao" ? "text-warning-fg" : "text-success-fg")}>{score}</p>
                <p className="mt-1 text-xs text-muted">{level ? HEALTH_LABELS[level] : ""}</p>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="pt-0">
            {!healthScore ? (
              <EmptyState size="sm" icon={<HeartPulse />} title="Sem cálculo de saúde" description="O score é calculado para clientes ativos a partir de uso, satisfação, suporte e financeiro." />
            ) : (
              <ul className="flex flex-col gap-3">
                {healthScore.factors.map((f) => {
                  const factorLevel = f.value >= 75 ? "saudavel" : f.value >= 50 ? "atencao" : "risco";
                  return (
                    <li key={f.key}>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium">{f.label}</span>
                        <span className="text-xs tabular-nums text-muted">
                          peso {f.weight}% · contribui {f.contribution.toFixed(1)}
                        </span>
                      </div>
                      <Progress value={f.value} size="sm" tone={healthTone(factorLevel) === "success" ? "success" : healthTone(factorLevel) === "warning" ? "warning" : "danger"} className="mt-1" />
                      {f.note ? <p className="mt-0.5 text-xs text-muted">{f.note}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <section>
        <SectionTitle title="Planos de sucesso" count={successPlans.length} />
        {successPlans.length === 0 ? (
          <Card>
            <EmptyState size="sm" icon={<Route />} title="Nenhum plano de sucesso" description="Planos são criados na ativação ou quando a saúde cai." />
          </Card>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {successPlans.map((plan) => {
              const done = plan.actions.filter((a) => a.done).length;
              return (
                <li key={plan.id}>
                  <Card className="h-full">
                    <CardContent className="flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium leading-tight">{plan.objective}</p>
                          <p className="mt-0.5 text-xs text-muted">
                            Criado {formatRelative(plan.createdAt)} · {plan.origin === "automacao" ? "automação" : "manual"}
                            {plan.checkpointAt ? ` · checkpoint ${formatDate(plan.checkpointAt)}` : ""}
                          </p>
                        </div>
                        <Badge variant={plan.status === "ativo" ? "info" : plan.status === "concluido" ? "success" : "muted"} size="sm">
                          {SUCCESS_PLAN_STATUS_LABELS[plan.status]}
                        </Badge>
                      </div>
                      <Progress value={plan.actions.length ? (done / plan.actions.length) * 100 : 0} size="sm" showValue tone="success" />
                      <ul className="flex flex-col gap-1.5">
                        {plan.actions.map((a) => (
                          <li key={a.id} className="flex items-start gap-2 text-sm">
                            {a.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-light" aria-hidden />}
                            <div className="min-w-0 flex-1">
                              <p className={cn(a.done && "text-muted line-through")}>{a.description}</p>
                              <p className={cn("text-xs text-muted", !a.done && a.dueAt < now && "text-danger-fg")}>
                                {users[a.responsibleId]?.name ?? a.responsibleId} · {a.done ? `feito ${formatDate(a.doneAt)}` : `até ${formatDate(a.dueAt)}`}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                      {plan.result ? <p className="rounded-md bg-surface-muted p-2 text-xs text-muted">{plan.result}</p> : null}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle title="Renovações" count={renewals.length} />
        <Card className="overflow-hidden">
          {renewals.length === 0 ? (
            <EmptyState size="sm" icon={<RefreshCw />} title="Nenhuma renovação programada" description="A renovação entra na janela de 60 dias antes do fim do contrato." />
          ) : (
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Janela</TableHead>
                  <TableHead>Risco</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Notas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {renewals.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {formatDate(r.dueDate)} <span className="text-xs font-normal text-muted">({formatRelative(r.dueDate)})</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted">{r.windowOpensAt <= now ? "Aberta" : `Abre em ${formatDate(r.windowOpensAt)}`}</TableCell>
                    <TableCell>
                      <HealthIndicator level={r.risk} showLabel />
                    </TableCell>
                    <TableCell>
                      <Badge variant={RENEWAL_STATUS_VARIANT[r.status]} size="sm">
                        {RENEWAL_STATUS_LABELS[r.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <UserCell users={users} id={r.ownerId} />
                    </TableCell>
                    <TableCell className="max-w-[280px] text-muted">{r.notes ?? r.result ?? "—"}</TableCell>
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
