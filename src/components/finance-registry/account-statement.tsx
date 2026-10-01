import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, ScrollText, X } from "lucide-react";
import type { AccountStatement } from "@/server/finance-registry/queries";
import { formatCurrency, formatDateKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const money = (n: number | null) => (n === null ? "Restrito" : formatCurrency(n));
const signed = (n: number | null) => (n === null ? "Restrito" : `${n > 0 ? "+" : "−"} ${formatCurrency(Math.abs(n))}`);

function Origin({ origin }: { origin: AccountStatement["rows"][number]["origin"] }) {
  if (!origin) return <span className="text-muted">—</span>;
  return origin.href ? (
    <Link href={origin.href} className="text-brand-fg hover:underline">
      {origin.label}
    </Link>
  ) : (
    <span>{origin.label}</span>
  );
}

function Reconciled({ value }: { value: boolean }) {
  return value ? (
    <Badge variant="success" size="sm">
      <CheckCircle2 /> Conciliado
    </Badge>
  ) : (
    <Badge variant="muted" size="sm">
      Não conciliado
    </Badge>
  );
}

/**
 * Extrato SOMENTE LEITURA de uma conta financeira (etapa CP/CR 2): saldo anterior, entradas, saídas e saldo no fim do
 * período; cada lançamento com data, descrição, tipo, valor ±, origem (título/cobrança, com link quando o usuário abre a
 * tela) e conciliado. Período por formulário GET (?de=&ate=). Sem "Visualizar valores", as quantias saem "Restrito".
 */
export function AccountStatementCard({ statement }: { statement: AccountStatement }) {
  const s = statement;
  const base = `/financeiro/cadastros?aba=contas&conta=${s.accountId}`;
  return (
    <Card className="mt-4 min-w-0 overflow-hidden" data-testid="account-statement">
      <CardHeader className="flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <ScrollText className="size-4 shrink-0" /> <span className="min-w-0 break-words">Extrato · {s.accountName}</span>
            </CardTitle>
            <p className="mt-0.5 text-sm text-muted">
              {formatDateKey(s.from)} a {formatDateKey(s.to)} · somente leitura: lançamentos nascem das baixas e só saem desfazendo a baixa
            </p>
          </div>
          <Link href="/financeiro/cadastros?aba=contas" className={buttonVariants({ variant: "ghost", size: "sm", className: "h-10 md:h-8" })} aria-label="Fechar extrato">
            <X /> Fechar
          </Link>
        </div>
        <form method="get" action="/financeiro/cadastros" className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap" aria-label="Período do extrato">
          <input type="hidden" name="aba" value="contas" />
          <input type="hidden" name="conta" value={s.accountId} />
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
            De
            <DateInput name="de" defaultValue={s.from} className="h-11 md:h-9" />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
            Até
            <DateInput name="ate" defaultValue={s.to} className="h-11 md:h-9" />
          </label>
          <Button type="submit" variant="outline" className="col-span-2 h-11 sm:col-span-1 md:h-9">
            Filtrar período
          </Button>
          <Link href={base} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "col-span-2 h-10 sm:col-span-1 md:h-8")}>
            Últimos 90 dias
          </Link>
        </form>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4" data-testid="statement-summary">
          <div className="min-w-0">
            <dt className="text-xs text-muted">Saldo anterior</dt>
            <dd className="tabular-nums">{money(s.opening)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted">Entradas</dt>
            <dd className="tabular-nums text-success-fg">{money(s.inflow)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted">Saídas</dt>
            <dd className="tabular-nums text-danger-fg">{money(s.outflow)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted">Saldo no fim do período</dt>
            <dd className="font-semibold tabular-nums" data-testid="statement-closing">
              {money(s.closing)}
            </dd>
          </div>
        </dl>
      </CardHeader>
      {s.rows.length === 0 ? (
        <CardContent className="pt-0">
          <EmptyState icon={<ScrollText />} title="Nenhum lançamento no período" description="Pagamentos de títulos e recebimentos de cobranças registrados com esta conta aparecem aqui." />
        </CardContent>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border border-t border-border md:hidden" data-testid="statement-list">
            {s.rows.map((r) => (
              <li key={r.id} data-entry={r.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 break-words font-medium">{r.description}</span>
                  <span className={cn("shrink-0 font-semibold tabular-nums", r.amount !== null && (r.amount > 0 ? "text-success-fg" : "text-danger-fg"))} data-testid="statement-amount">
                    {signed(r.amount)}
                  </span>
                </div>
                <p className="text-xs text-muted">
                  {formatDateKey(r.date)} · {r.typeLabel}
                  {r.contactName ? ` · ${r.contactName}` : ""}
                  {r.notes ? ` · ${r.notes}` : ""}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Origin origin={r.origin} />
                  <Reconciled value={r.reconciled} />
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Conciliado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.rows.map((r) => (
                  <TableRow key={r.id} data-entry={r.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatDateKey(r.date)}</TableCell>
                    <TableCell className="max-w-[360px]">
                      <span className="block truncate font-medium" title={r.description}>
                        {r.description}
                      </span>
                      <span className="block truncate text-xs text-muted">{[r.contactName, r.notes].filter(Boolean).join(" · ")}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        {r.type === "receita" ? <ArrowDownLeft className="size-3.5 text-success-fg" /> : r.type === "despesa" ? <ArrowUpRight className="size-3.5 text-danger-fg" /> : null}
                        {r.typeLabel}
                      </span>
                    </TableCell>
                    <TableCell className={cn("whitespace-nowrap text-right font-semibold tabular-nums", r.amount !== null && (r.amount > 0 ? "text-success-fg" : "text-danger-fg"))} data-testid="statement-amount">
                      {signed(r.amount)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-muted">{money(r.balance)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      <Origin origin={r.origin} />
                    </TableCell>
                    <TableCell>
                      <Reconciled value={r.reconciled} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </Card>
  );
}
