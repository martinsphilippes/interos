import { AlertTriangle, CalendarClock, FileSignature, Receipt, Wallet } from "lucide-react";
import type { Client360 } from "@/server/clients/queries";
import { formatCompetence, formatCurrency, formatDate, formatRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionTitle } from "@/components/ui/section-title";
import { StatCard } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { UserCell } from "./client-badges";
import { BILLING_STATUS_LABELS, BILLING_STATUS_VARIANT, BILLING_TYPE_LABELS, CONTRACT_STATUS_LABELS, CONTRACT_STATUS_VARIANT } from "./labels";

const RECENT_BILLS = 12;

/** Aba Financeiro: resumo (MRR, em aberto, vencido, próximo vencimento), contratos e cobranças. */
export function TabFinanceiro({ data }: { data: Client360 }) {
  const { client, contracts, billing, financial, users } = data;
  const recent = billing.slice(0, RECENT_BILLS);
  const today = new Date().toISOString().slice(0, 10);
  const mrr = financial.mrr || client.mrr || 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="MRR" value={formatCurrency(mrr)} icon={<Wallet />} tone="success" hint="mensalidades dos produtos ativos" compact />
        <StatCard label="Em aberto" value={formatCurrency(financial.openAmount)} icon={<Receipt />} tone="info" hint={`${financial.openCount} cobrança${financial.openCount === 1 ? "" : "s"} a vencer`} compact />
        <StatCard
          label="Vencido (inadimplência)"
          value={formatCurrency(financial.overdueAmount)}
          icon={<AlertTriangle />}
          tone={financial.overdueCount > 0 ? "danger" : "neutral"}
          hint={financial.overdueCount > 0 ? `${financial.overdueCount} cobrança${financial.overdueCount === 1 ? "" : "s"} vencida${financial.overdueCount === 1 ? "" : "s"}` : "nenhuma cobrança vencida"}
          compact
        />
        <StatCard
          label="Próximo vencimento"
          value={financial.nextDue ? formatDate(financial.nextDue.dueDate) : "—"}
          icon={<CalendarClock />}
          tone={financial.nextDue && financial.nextDue.dueDate.slice(0, 10) < today ? "warning" : "neutral"}
          hint={financial.nextDue ? `${formatCurrency(financial.nextDue.amount)} · ${BILLING_TYPE_LABELS[financial.nextDue.type]} · ${formatRelative(financial.nextDue.dueDate)}` : "sem cobranças em aberto"}
          compact
        />
      </div>

      <section>
        <SectionTitle title="Contratos" count={contracts.length} />
        <Card className="overflow-hidden">
          {contracts.length === 0 ? (
            <EmptyState size="sm" icon={<FileSignature />} title="Nenhum contrato" description="O contrato é gerado pelo Financeiro quando a venda é ganha." />
          ) : (
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Mensal</TableHead>
                  <TableHead className="text-right">Adesão</TableHead>
                  <TableHead className="text-right">Hardware</TableHead>
                  <TableHead>Assinatura</TableHead>
                  <TableHead>Liberação</TableHead>
                  <TableHead>Vigência</TableHead>
                  <TableHead>Responsável</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {c.number} <span className="text-xs text-muted">v{c.version}</span>
                      <p className="text-xs font-normal text-muted">
                        {c.items.length} item{c.items.length === 1 ? "" : "s"} · {c.recurrence === "mensal" ? "mensal" : c.recurrence === "anual" ? "anual" : "único"} · {c.termMonths} meses · dia {c.billingDay}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={CONTRACT_STATUS_VARIANT[c.status]} size="sm">
                        {CONTRACT_STATUS_LABELS[c.status]}
                      </Badge>
                      {c.pendingReason ? <p className="mt-1 max-w-[220px] text-xs text-danger-fg">{c.pendingReason}</p> : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(c.monthlyTotal)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(c.setupTotal)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(c.hardwareTotal)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted">
                      {c.signedAt ? formatDate(c.signedAt) : <span className="text-warning-fg">{c.signers.filter((s) => s.status === "pendente").length} pendente(s)</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted">{c.releasedAt ? formatDate(c.releasedAt) : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted">{c.startDate ? `${formatDate(c.startDate)} – ${formatDate(c.endDate)}` : "—"}</TableCell>
                    <TableCell>
                      <UserCell users={users} id={c.ownerId} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>

      <section>
        <SectionTitle title="Cobranças" count={billing.length} description={billing.length > RECENT_BILLS ? `Mostrando as ${RECENT_BILLS} mais recentes.` : undefined} />
        <Card className="overflow-hidden">
          {recent.length === 0 ? (
            <EmptyState size="sm" icon={<Receipt />} title="Nenhuma cobrança" description="As cobranças são geradas a partir do contrato liberado." />
          ) : (
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Competência</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Pagamento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((b) => {
                  const overdue = b.status === "vencida";
                  return (
                    <TableRow key={b.id} className={cn(overdue && "bg-danger-soft/40 hover:bg-danger-soft/60")}>
                      <TableCell className="whitespace-nowrap font-medium capitalize">{formatCompetence(b.competence)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {BILLING_TYPE_LABELS[b.type]}
                        {b.installment ? <span className="text-xs text-muted"> · parcela {b.installment}</span> : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{formatCurrency(b.amount)}</TableCell>
                      <TableCell className={cn("whitespace-nowrap", overdue ? "text-danger-fg" : "text-muted")}>
                        {formatDate(b.dueDate)}
                        {overdue ? <span className="ml-1 text-xs">({formatRelative(b.dueDate)})</span> : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={BILLING_STATUS_VARIANT[b.status]} size="sm">
                          {BILLING_STATUS_LABELS[b.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted">
                        {b.paidAt ? (
                          <>
                            {formatDate(b.paidAt)}
                            {b.method ? <span className="text-xs"> · {b.method}</span> : null}
                            {b.paidAmount !== undefined && b.paidAmount !== b.amount ? <span className="text-xs"> · {formatCurrency(b.paidAmount)}</span> : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>
    </div>
  );
}
