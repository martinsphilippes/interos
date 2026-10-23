"use client";

import * as React from "react";
import { Ban, CalendarClock, TrendingUp } from "lucide-react";
import type { ContractReadjustmentLogEntry } from "@/domain/types";
import { competenceLabel, describeQuote, formatPct } from "@/domain/readjustment";
import { applyContractReadjustmentAction, skipContractReadjustmentAction } from "@/server/finance/actions";
import type { ContractReadjustmentState, ReadjustmentStatus } from "@/server/finance/readjustments";
import { formatCurrency, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ReasonDialog } from "@/components/commissions/commission-ui";
import { CanSee, ScreenLink } from "@/components/auth/access-provider";
import { useFinanceAccess } from "./finance-access";
import { useFinanceAction } from "./use-finance-action";

type Variant = "default" | "success" | "warning" | "danger" | "info" | "brand" | "muted";

const STATUS: Record<ReadjustmentStatus, { label: string; variant: Variant }> = {
  previsto: { label: "Previsto", variant: "info" },
  pronto: { label: "Entra hoje", variant: "brand" },
  aguardando_indice: { label: "Aguardando o índice", variant: "warning" },
  atrasado: { label: "Atrasado", variant: "danger" },
  bloqueado: { label: "Travado", variant: "warning" },
  renovacao: { label: "Na renovação", variant: "info" },
  sem_vigencia: { label: "Após a liberação", variant: "muted" },
  sem_regra: { label: "Sem reajuste", variant: "muted" },
};

const OUTCOME: Record<ContractReadjustmentLogEntry["outcome"], { label: string; variant: Variant }> = {
  aplicado: { label: "Aplicado", variant: "success" },
  mantido: { label: "Sem aumento", variant: "muted" },
  dispensado: { label: "Dispensado", variant: "warning" },
};

const day = (key: string) => formatDate(`${key}T12:00:00.000Z`);

export interface ContractReadjustmentCardProps {
  contractId: string;
  /** "IPCA · Banco Central · série 433" / "5% ao ano". */
  rule: string;
  /** Início da vigência (AAAA-MM-DD): a data-base é o aniversário. */
  startDate?: string;
  state: ContractReadjustmentState;
  log: ContractReadjustmentLogEntry[];
  /** Sem «ver valores do contrato»: mensalidades ocultas. */
  hideValues: boolean;
  /** Link para o índice no cadastro (só aparece para quem vê a tela de cadastros). */
  indexHref?: string;
}

/**
 * Reajuste anual do contrato: regra, data-base, prévia (sempre com o último índice publicado), situação e ações
 * (aplicar agora / não reajustar) e o histórico das datas-base decididas. As actions revalidam permissão e escopo.
 */
export function ContractReadjustmentCard({ contractId, rule, startDate, state, log, hideValues, indexHref }: ContractReadjustmentCardProps) {
  const access = useFinanceAccess();
  const { pending, run } = useFinanceAction();
  const [applying, setApplying] = React.useState(false);
  const [skipping, setSkipping] = React.useState(false);
  const status = STATUS[state.status];
  const anniversary = state.anniversary;
  const money = (v: number | undefined) => (hideValues || v === undefined ? "Restrito" : formatCurrency(v));
  const canApply = access.contracts.readjustApply && state.canApply && Boolean(anniversary);
  const canSkip = access.contracts.readjustSkip && state.canSkip && Boolean(anniversary);

  return (
    <Card data-testid="readjustment-card">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="size-4" aria-hidden /> Reajuste anual
          </CardTitle>
          <CardDescription>
            {rule}
            {indexHref ? (
              <CanSee href={indexHref}>
                {" · "}
                <ScreenLink href={indexHref} className="text-brand-fg hover:underline">
                  ver o índice
                </ScreenLink>
              </CanSee>
            ) : null}
            {startDate ? ` · data-base: ${day(startDate).slice(0, 5)} (aniversário do início da vigência)` : ""}
          </CardDescription>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="readjustment-state">
          {anniversary ? (
            <p className="flex items-center gap-2 text-sm font-medium">
              <CalendarClock className="size-4 text-muted" aria-hidden /> Data-base {day(anniversary)}
            </p>
          ) : null}
          <p className="text-sm text-muted">{state.message}</p>
          {state.quote ? (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted">{state.status === "previsto" ? "Prévia do reajuste" : "Reajuste"}</dt>
                <dd>{describeQuote(state.quote)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Mensalidade</dt>
                <dd>
                  {money(state.monthlyBefore)} → <span className="font-medium">{money(state.monthlyAfter)}</span>
                </dd>
              </div>
            </dl>
          ) : null}
          {canApply || canSkip ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {canApply ? (
                <Button size="sm" className="h-10 md:h-8" onClick={() => setApplying(true)}>
                  <TrendingUp /> Aplicar reajuste
                </Button>
              ) : null}
              {canSkip ? (
                <Button size="sm" variant="ghost" className="h-10 md:h-8" onClick={() => setSkipping(true)}>
                  <Ban /> Não reajustar
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {log.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Datas-base decididas</p>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="readjustment-log">
              {[...log].reverse().map((e) => (
                <li key={e.anniversary} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-center sm:gap-3">
                  <span className="w-24 shrink-0 font-medium">{day(e.anniversary)}</span>
                  <Badge variant={OUTCOME[e.outcome].variant} size="sm">
                    {OUTCOME[e.outcome].label}
                  </Badge>
                  <span className="min-w-0 flex-1 break-words text-muted">
                    {e.outcome === "dispensado"
                      ? (e.reason ?? "Sem reajuste nesta data-base")
                      : `${e.percent !== undefined ? formatPct(e.percent) : ""}${e.indexName && e.from && e.to ? ` · ${e.indexName} ${competenceLabel(e.from)}–${competenceLabel(e.to)}${e.rawPercent !== undefined && e.rawPercent !== e.percent ? ` (${formatPct(e.rawPercent)})` : ""}` : ""}${e.manual ? " · informado pelo Financeiro" : ""}`}
                    {e.outcome === "aplicado" && !hideValues && e.monthlyBefore !== undefined && e.monthlyAfter !== undefined ? ` · ${formatCurrency(e.monthlyBefore)} → ${formatCurrency(e.monthlyAfter)}` : ""}
                    {e.amendmentNumber ? ` · aditivo ${e.amendmentNumber}` : ""}
                    {e.byName ? ` · ${e.byName}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>

      {applying && anniversary ? <ApplyDialog contractId={contractId} anniversary={anniversary} state={state} hideValues={hideValues} onClose={() => setApplying(false)} /> : null}
      <ReasonDialog
        open={skipping}
        onOpenChange={(o) => !o && setSkipping(false)}
        title={anniversary ? `Não reajustar na data-base ${day(anniversary)}?` : "Não reajustar"}
        description="A mensalidade fica igual nesta data-base (o próximo reajuste é no aniversário seguinte). Fica registrado com o motivo."
        placeholder="Ex.: negociado com o cliente na renovação"
        confirmLabel="Não reajustar"
        destructive
        pending={pending}
        onConfirm={(reason) => (anniversary ? run(() => skipContractReadjustmentAction({ contractId, anniversary, reason }), "Reajuste dispensado nesta data-base", () => setSkipping(false)) : Promise.resolve(false))}
      />
    </Card>
  );
}

function ApplyDialog({ contractId, anniversary, state, hideValues, onClose }: { contractId: string; anniversary: string; state: ContractReadjustmentState; hideValues: boolean; onClose: () => void }) {
  const id = React.useId();
  const { pending, run } = useFinanceAction();
  const [manual, setManual] = React.useState(!state.quote || state.quote.percent === 0);
  const [percent, setPercent] = React.useState(state.quote && state.quote.percent !== 0 ? String(state.quote.percent).replace(".", ",") : "");
  const value = Number(percent.trim().replace(",", "."));
  const valid = !manual || (Number.isFinite(value) && value !== 0 && Math.abs(value) <= 100);
  const early = (state.days ?? 0) < 0;
  const submit = () =>
    void run(
      () => applyContractReadjustmentAction({ contractId, anniversary, ...(manual ? { percent: value } : {}) }),
      (d) => `Reajuste aplicado (aditivo ${d.amendmentNumber})${hideValues ? "" : `: ${formatCurrency(d.monthlyBefore)} → ${formatCurrency(d.monthlyAfter)}`}`,
      () => onClose(),
    );
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Aplicar o reajuste da data-base {day(anniversary)}</DialogTitle>
          <DialogDescription>
            Cria e aplica um aditivo de reajuste (sem assinatura: o reajuste já está no contrato), vigente na data-base. As mensalidades em aberto a partir dela são refeitas com o novo valor.{early ? " A data-base ainda não chegou: o valor passa a valer só nela." : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {state.quote ? <p className="rounded-md bg-info-soft px-3 py-2 text-sm">{describeQuote(state.quote)}</p> : <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-fg">{state.message}</p>}
          {state.quote ? <Switch label="Informar outro percentual" description="Use quando o combinado com o cliente for diferente do índice (fica registrado como informado pelo Financeiro)." checked={manual} onCheckedChange={setManual} className="w-full rounded-lg border border-border px-3 py-2" /> : null}
          {manual ? (
            <FormField label="Percentual do reajuste (%)" htmlFor={`${id}-p`} required hint="Negativo reduz a mensalidade">
              <Input id={`${id}-p`} inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="Ex.: 4,5" className="h-11 md:h-9" />
            </FormField>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={pending} disabled={!valid}>
            Aplicar reajuste
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
