import Link from "next/link";
import { BadgePercent, ChevronRight } from "lucide-react";
import type { UserCommissionsDigest } from "@/server/commissions/queries";
import { COMMISSION_REVENUE_LABELS, COMMISSION_STATUS_LABELS, COMMISSION_STATUS_VARIANT } from "@/domain/commissions";
import { formatCompetence, formatCurrency, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const TOTAL_LABELS: { key: keyof UserCommissionsDigest["totals"]; label: string; tone?: string }[] = [
  { key: "previstas", label: "Previstas" },
  { key: "em_carencia", label: "Em carência" },
  { key: "aguardando_recebimento", label: "Aguardando recebimento" },
  { key: "elegiveis", label: "Elegíveis", tone: "text-brand-fg" },
  { key: "a_pagar", label: "A pagar (título)", tone: "text-secondary-fg" },
  { key: "pagas", label: "Pagas", tone: "text-success-fg" },
];

/**
 * "Minhas comissões" no Meu Desempenho (D17): item a item — cliente, contrato, venda VEN, regra, valor, situação,
 * data provável/elegibilidade — com link para a memória de cálculo em Financeiro › Comissões. Os números vêm do
 * motor de comissões (src/server/commissions), no mesmo escopo de visibilidade das telas do Financeiro.
 */
export function MyCommissionsCard({ digest, self, firstName }: { digest: UserCommissionsDigest; self: boolean; firstName: string }) {
  const title = self ? "Minhas comissões" : `Comissões de ${firstName}`;
  return (
    <Card data-testid="minhas-comissoes">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <BadgePercent className="size-4 text-muted" aria-hidden /> {title}
          </CardTitle>
          <CardDescription>Item a item: situação, data provável de elegibilidade ou pagamento e a memória de cálculo de cada uma.</CardDescription>
        </div>
        <Link href={digest.href} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand-fg hover:underline">
          Ver todas <ChevronRight className="size-4" aria-hidden />
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {TOTAL_LABELS.map((t) => (
            <div key={t.key} className="min-w-0 rounded-lg border border-border bg-surface-muted px-3 py-2">
              <dt className="truncate text-xs text-muted">{t.label}</dt>
              <dd className={`text-base font-semibold tabular-nums ${t.tone ?? ""}`}>{formatCurrency(digest.totals[t.key].amount)}</dd>
              <dd className="text-[11px] text-muted">{digest.totals[t.key].count} comissão(ões)</dd>
            </div>
          ))}
        </dl>

        {digest.rows.length === 0 ? (
          <EmptyState size="sm" icon={<BadgePercent />} title="Nenhuma comissão ainda" description="As comissões nascem das vendas ganhas e evoluem com assinatura, recebimentos e carência." />
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border md:hidden">
              {digest.rows.map((r) => (
                <li key={r.id} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0" data-commission={r.code}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{r.clientName}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{formatCurrency(r.amount)}</span>
                  </div>
                  <p className="truncate text-xs text-muted">
                    {[r.code, r.contractNumber, r.saleNumber, `${COMMISSION_REVENUE_LABELS[r.revenueType]} · ${r.slotLabel}`].filter(Boolean).join(" · ")}
                  </p>
                  {r.ruleName ? <p className="truncate text-xs text-muted">Regra: {r.ruleName}</p> : null}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge variant={COMMISSION_STATUS_VARIANT[r.status]} size="sm">
                      {COMMISSION_STATUS_LABELS[r.status]}
                    </Badge>
                    <span className="text-muted">
                      {r.whenLabel} {r.whenAt ? formatDate(r.whenAt) : "a definir"}
                    </span>
                    {r.href ? (
                      <Link href={r.href} className="ml-auto font-medium text-brand-fg hover:underline">
                        Memória
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <Table className="min-w-[860px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente / contrato</TableHead>
                    <TableHead>Comissão</TableHead>
                    <TableHead>Regra</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead className="w-[90px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {digest.rows.map((r) => (
                    <TableRow key={r.id} data-commission={r.code}>
                      <TableCell className="max-w-[240px]">
                        <span className="block truncate font-medium">{r.clientName}</span>
                        <span className="block truncate text-xs text-muted">{[r.contractNumber, r.saleNumber].filter(Boolean).join(" · ") || "—"}</span>
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <span className="block whitespace-nowrap text-sm">{r.code}</span>
                        <span className="block truncate text-xs text-muted">
                          {COMMISSION_REVENUE_LABELS[r.revenueType]} · {r.slotLabel} · {formatCompetence(r.competence)}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <span className="block truncate text-sm" title={r.ruleName}>
                          {r.ruleName ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatCurrency(r.amount)}</TableCell>
                      <TableCell>
                        <Badge variant={COMMISSION_STATUS_VARIANT[r.status]} size="sm">
                          {COMMISSION_STATUS_LABELS[r.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        <span className="block text-xs text-muted">{r.whenLabel}</span>
                        {r.whenAt ? formatDate(r.whenAt) : <span className="text-muted">a definir</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.href ? (
                          <Link href={r.href} className="text-sm font-medium text-brand-fg hover:underline">
                            Memória
                          </Link>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {digest.total > digest.rows.length ? (
              <p className="text-xs text-muted">
                Mostrando {digest.rows.length} de {digest.total}.{" "}
                <Link href={digest.href} className="font-medium text-brand-fg hover:underline">
                  Ver todas
                </Link>
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
