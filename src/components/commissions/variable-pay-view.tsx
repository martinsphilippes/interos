"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CircleAlert, Lock, Wallet } from "lucide-react";
import type { VariablePayData } from "@/server/variable-pay/queries";
import { closeVariablePayAction } from "@/server/variable-pay/actions";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useFinanceAction } from "@/components/finance/use-finance-action";

/**
 * Remuneração variável consolidada: uma linha por colaborador (comissões adquiridas + bônus + prêmios = total), com o
 * que ainda está pendente, o valor do último fechamento e alertas antes do pagamento. Tabela no desktop, cards no celular.
 */
export function VariablePayView({ data }: { data: VariablePayData }) {
  const router = useRouter();
  const pathname = usePathname();
  const [closing, setClosing] = React.useState(false);
  const [pendingNav, start] = React.useTransition();
  const commissionsHref = (userId: string) => `/financeiro/comissoes?competencia=${data.competence}&vendedor=${userId}`;

  return (
    <div className="flex flex-col gap-4" aria-busy={pendingNav || undefined}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <FormField label="Competência" htmlFor="vp-comp" className="sm:w-64">
          <Select id="vp-comp" value={data.competence} onChange={(e) => start(() => router.replace(`${pathname}?competencia=${e.target.value}`))} options={data.months} />
        </FormField>
        <div className="flex flex-wrap items-center gap-2">
          {data.closing ? (
            <Badge variant="secondary" size="md">
              <Lock className="size-3.5" /> Fechada v{data.closing.version} em {formatDateTime(data.closing.closedAt)}
              {data.closing.closedByName ? ` por ${data.closing.closedByName}` : ""}
            </Badge>
          ) : (
            <Badge variant="muted" size="md">
              Competência em aberto
            </Badge>
          )}
          {data.can.close ? (
            <Button variant={data.closing ? "outline" : "primary"} className="h-11 md:h-9" onClick={() => setClosing(true)}>
              <Lock /> {data.closing ? "Fechar de novo" : "Fechar competência"}
            </Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-4 text-muted" /> Por colaborador
          </CardTitle>
          <CardDescription>Comissões adquiridas (elegíveis, com título ou pagas) + bônus + prêmios de vendas. Pendentes ainda podem entrar; canceladas e estornadas não contam.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {data.lines.length === 0 ? (
            <EmptyState size="sm" icon={<Wallet />} title="Nada a pagar nesta competência" description="Nenhuma comissão, bônus ou prêmio para os colaboradores que você vê." />
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-border md:hidden">
                {data.lines.map((l) => (
                  <li key={l.userId} className="flex flex-col gap-1 py-3">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{l.userName}</span>
                      <span className="font-semibold tabular-nums">{formatCurrency(l.total)}</span>
                    </span>
                    <span className="text-xs text-muted">
                      Comissões {formatCurrency(l.commissions.earned)} · bônus {formatCurrency(l.bonus.amount)} · prêmios {formatCurrency(l.prizes.amount)}
                    </span>
                    {l.potential > 0 ? <span className="text-xs text-muted">+ {formatCurrency(l.potential)} pendentes</span> : null}
                    <Alerts alerts={l.alerts} />
                  </li>
                ))}
              </ul>
              <div className="hidden md:block">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Colaborador</TableHead>
                      <TableHead className="text-right">Comissões</TableHead>
                      <TableHead className="text-right">Bônus</TableHead>
                      <TableHead className="text-right">Prêmios</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Pendentes</TableHead>
                      {data.closing ? <TableHead className="text-right">No fechamento</TableHead> : null}
                      <TableHead>Atenção</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.lines.map((l) => (
                      <TableRow key={l.userId}>
                        <TableCell>
                          <span className="block font-medium">{l.userName}</span>
                          {l.department ? <span className="block text-xs text-muted">{l.department}</span> : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Link href={commissionsHref(l.userId)} className="hover:text-brand-fg hover:underline">
                            {formatCurrency(l.commissions.earned)}
                          </Link>
                          {l.commissions.paid > 0 ? <span className="block text-xs text-muted">pago {formatCurrency(l.commissions.paid)}</span> : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(l.bonus.amount)}
                          {l.bonus.source !== "sem_regra" ? <span className="block text-xs text-muted">{l.bonus.source === "fechado" ? "apurado" : "projeção"}{l.bonus.tier ? ` · ${l.bonus.tier}` : ""}</span> : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums" title={l.prizes.items.join("\n") || undefined}>
                          {formatCurrency(l.prizes.amount)}
                          {l.prizes.items.length ? <span className="block text-xs text-muted">{l.prizes.items.length} meta(s)</span> : null}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(l.total)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted">{l.potential > 0 ? formatCurrency(l.potential) : "—"}</TableCell>
                        {data.closing ? (
                          <TableCell className={cn("text-right tabular-nums", Math.abs(l.diffSinceClose) >= 0.01 && "text-warning-fg")}>
                            {l.closed ? formatCurrency(l.closed.total) : "—"}
                            {Math.abs(l.diffSinceClose) >= 0.01 ? <span className="block text-xs">{l.diffSinceClose > 0 ? "+" : ""}{formatCurrency(l.diffSinceClose)}</span> : null}
                          </TableCell>
                        ) : null}
                        <TableCell className="max-w-[260px]">
                          <Alerts alerts={l.alerts} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted">
        Comissões pela competência da cobrança · bônus: valor apurado no fechamento de <Link href="/performance/bonus" className="underline">Bônus e Premiação</Link> ou, com o mês aberto, a projeção do mesmo cálculo · prêmios: metas de vendas do mês (Administração › Configurações › Gamificação e prêmios). Prêmios de campanhas de gamificação são descritivos e não entram no total.
      </p>
      {closing ? <CloseDialog data={data} onClose={() => setClosing(false)} /> : null}
    </div>
  );
}

function Alerts({ alerts }: { alerts: string[] }) {
  if (alerts.length === 0) return <span className="text-xs text-muted">—</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {alerts.map((a) => (
        <li key={a} className="flex items-start gap-1 text-xs text-warning-fg">
          <CircleAlert className="mt-0.5 size-3 shrink-0" /> {a}
        </li>
      ))}
    </ul>
  );
}

function CloseDialog({ data, onClose }: { data: VariablePayData; onClose: () => void }) {
  const [notes, setNotes] = React.useState("");
  const { pending, run } = useFinanceAction();
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Fechar {data.label}?</DialogTitle>
          <DialogDescription>
            Congela comissões, bônus e prêmios de todos os colaboradores ({formatCurrency(data.totals.total)} no que você vê). Não paga nada: os pagamentos seguem pelos títulos em Contas a Pagar. Se algo mudar depois, a tela mostra a diferença.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormField label="Observação" htmlFor="vp-notes" hint="Opcional; fica no histórico">
            <Textarea id="vp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Voltar
          </Button>
          <Button
            loading={pending}
            onClick={async () => {
              const ok = await run(() => closeVariablePayAction({ competence: data.competence, notes: notes.trim() || undefined }), (d) => `Competência fechada (v${d.version}): ${formatCurrency(d.total)}`);
              if (ok) onClose();
            }}
          >
            Fechar competência
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
