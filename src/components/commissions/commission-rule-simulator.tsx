"use client";

import * as React from "react";
import { Calculator, CircleAlert, Info } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { simulateCommissionAction } from "@/server/commissions/actions";
import type { RulesWorkspace } from "@/server/commissions/queries";
import type { SimulationResult } from "@/server/commissions/simulate";
import { COMMISSION_REVENUE_LABELS } from "@/domain/commissions";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";

type Options = RulesWorkspace["options"];

interface SimForm {
  sellerId: string;
  productId: string;
  planId: string;
  saleValue: string;
  setupValue: string;
  monthlyValue: string;
  receivedValue: string;
  installment: string;
  discountPct: string;
  saleDate: string;
  event: "pago" | "faturado";
}

const EMPTY: SimForm = { sellerId: "", productId: "", planId: "", saleValue: "", setupValue: "", monthlyValue: "", receivedValue: "", installment: "1", discountPct: "", saleDate: "", event: "pago" };
const money = (v: string) => (v.trim() === "" ? undefined : Number(v.replace(",", ".")));
const pct = (n: number) => `${String(Math.round(n * 100) / 100).replace(".", ",")}%`;

/**
 * Simulador (COM, item 5): informa vendedor, produto/serviço/plano, valores e o nº da mensalidade e mostra a regra
 * aplicada, a base, o percentual, os tetos, o valor final e a explicação passo a passo. Com `draft`, simula a regra em
 * edição (antes de salvar) no lugar da versão salva. Só leitura: nada é gravado.
 */
export function CommissionRuleSimulator({ options, draft, defaults, className }: { options: Options; draft?: () => unknown; defaults?: Partial<SimForm>; className?: string }) {
  const id = React.useId();
  const [f, setF] = React.useState<SimForm>({ ...EMPTY, ...defaults });
  const [result, setResult] = React.useState<(SimulationResult & { draftRuleId?: string }) | null>(null);
  const [pending, start] = React.useTransition();
  const set = <K extends keyof SimForm>(k: K, v: SimForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const plans = options.plans.filter((p) => !p.productId || !f.productId || p.productId === f.productId);

  const simulate = () =>
    start(async () => {
      const res = await simulateCommissionAction({
        draft: draft?.(),
        simulation: {
          sellerId: f.sellerId || undefined,
          productId: f.productId || undefined,
          planId: f.planId || undefined,
          saleValue: money(f.saleValue),
          setupValue: money(f.setupValue),
          monthlyValue: money(f.monthlyValue),
          receivedValue: money(f.receivedValue),
          installment: Number(f.installment) || 1,
          discountPct: money(f.discountPct) ?? 0,
          saleDate: f.saleDate || undefined,
          event: f.event,
        },
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setResult(res.data);
    });

  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="commission-simulator">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Vendedor" htmlFor={`${id}-vend`}>
          <Select id={`${id}-vend`} value={f.sellerId} onChange={(e) => set("sellerId", e.target.value)} placeholder="Qualquer vendedor" options={options.sellers} />
        </FormField>
        <FormField label="Produto ou serviço" htmlFor={`${id}-prod`}>
          <Select id={`${id}-prod`} value={f.productId} onChange={(e) => setF((p) => ({ ...p, productId: e.target.value, planId: "" }))} placeholder="Escolha">
            {options.products.length ? (
              <optgroup label="Produtos">
                {options.products.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {options.services.length ? (
              <optgroup label="Serviços">
                {options.services.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </Select>
        </FormField>
        <FormField label="Plano" htmlFor={`${id}-plano`} hint={plans.length === 0 ? "Nenhum plano cadastrado para este produto" : undefined}>
          <Select id={`${id}-plano`} value={f.planId} onChange={(e) => set("planId", e.target.value)} placeholder="Sem plano" options={plans} disabled={plans.length === 0} />
        </FormField>
        <FormField label="Data da venda" htmlFor={`${id}-data`} hint="Vazio = hoje (define a versão das regras)">
          <Input id={`${id}-data`} type="date" value={f.saleDate} onChange={(e) => set("saleDate", e.target.value)} />
        </FormField>
        <FormField label="Valor da adesão (R$)" htmlFor={`${id}-ades`}>
          <Input id={`${id}-ades`} type="number" inputMode="decimal" min={0} step="0.01" value={f.setupValue} onChange={(e) => set("setupValue", e.target.value)} />
        </FormField>
        <FormField label="Valor da mensalidade (R$)" htmlFor={`${id}-mens`}>
          <Input id={`${id}-mens`} type="number" inputMode="decimal" min={0} step="0.01" value={f.monthlyValue} onChange={(e) => set("monthlyValue", e.target.value)} />
        </FormField>
        <FormField label="Valor da venda / hardware (R$)" htmlFor={`${id}-venda`}>
          <Input id={`${id}-venda`} type="number" inputMode="decimal" min={0} step="0.01" value={f.saleValue} onChange={(e) => set("saleValue", e.target.value)} />
        </FormField>
        <FormField label="Valor líquido recebido (R$)" htmlFor={`${id}-liq`} hint="Da mensalidade simulada; regras sobre o valor recebido">
          <Input id={`${id}-liq`} type="number" inputMode="decimal" min={0} step="0.01" value={f.receivedValue} onChange={(e) => set("receivedValue", e.target.value)} placeholder="= mensalidade" />
        </FormField>
        <FormField label="Nº da mensalidade" htmlFor={`${id}-n`}>
          <Input id={`${id}-n`} type="number" inputMode="numeric" min={1} max={120} value={f.installment} onChange={(e) => set("installment", e.target.value)} />
        </FormField>
        <FormField label="Desconto do item (%)" htmlFor={`${id}-desc`}>
          <Input id={`${id}-desc`} type="number" inputMode="decimal" min={0} max={100} step="0.5" value={f.discountPct} onChange={(e) => set("discountPct", e.target.value)} placeholder="0" />
        </FormField>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          aria-label="Situação da parcela simulada"
          size="sm"
          value={f.event}
          onChange={(v) => set("event", v)}
          options={[
            { value: "pago", label: "Parcela paga" },
            { value: "faturado", label: "Só faturada" },
          ]}
        />
        <Button type="button" variant="secondary" onClick={simulate} loading={pending} className="h-11 md:h-9">
          <Calculator /> Simular
        </Button>
      </div>
      {result ? <SimulationView result={result} /> : null}
    </div>
  );
}

function SimulationView({ result }: { result: SimulationResult & { draftRuleId?: string } }) {
  if (result.lines.length === 0) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted p-3 text-sm text-muted">
        <CircleAlert className="mt-0.5 size-4 shrink-0" /> Nenhuma regra se aplica. Informe ao menos um valor (adesão, mensalidade ou venda) e confira produto, plano e vendedor.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="simulation-result">
      <div className="flex items-baseline justify-between rounded-lg bg-surface-hover px-3 py-2">
        <span className="text-sm text-muted">Comissão liberada na parcela simulada</span>
        <span className="text-lg font-semibold tabular-nums" data-testid="simulation-total">
          {formatCurrency(result.total)}
        </span>
      </div>
      {result.lines.map((l, i) => (
        <div key={`${l.rule.id}-${l.revenueType}-${i}`} className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" size="sm">
              {COMMISSION_REVENUE_LABELS[l.revenueType]}
            </Badge>
            <span className="font-medium">{l.rule.name}</span>
            {l.rule.code ? (
              <Badge variant="muted" size="sm">
                {l.rule.code}
              </Badge>
            ) : null}
            {l.rule.id === result.draftRuleId ? (
              <Badge variant="brand" size="sm">
                Rascunho em edição
              </Badge>
            ) : l.rule.version ? (
              <Badge variant="muted" size="sm">
                v{l.rule.version}
              </Badge>
            ) : null}
            {!l.rule.overridesDefault ? (
              <Badge variant="info" size="sm">
                Cumulativa
              </Badge>
            ) : null}
          </div>
          {l.notApplicable ? (
            <p className="mt-2 text-sm text-muted">{l.notApplicable}.</p>
          ) : (
            <>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <Metric label="Base utilizada" value={formatCurrency(l.detail.base)} hint={l.detail.baseCapApplied ? `teto (era ${formatCurrency(l.detail.eligibleBase)})` : undefined} />
                <Metric label={l.rule.mode === "percentual" ? "Percentual" : "Valor fixo"} value={l.rule.mode === "percentual" ? pct(l.rule.value) : formatCurrency(l.rule.value)} />
                <Metric label="Teto aplicado" value={l.detail.baseCapApplied ? "Da base" : l.detail.amountCapApplied ? "Da comissão" : "Nenhum"} hint={l.detail.amountCapApplied ? `antes ${formatCurrency(l.detail.amountBeforeCap)}` : undefined} />
                <Metric label="Valor final" value={formatCurrency(l.amount)} strong hint={l.status === "liberada" ? undefined : "ainda não liberada"} />
              </dl>
              <ol className="mt-2 flex flex-col gap-1 border-t border-border pt-2 text-xs text-muted">
                {l.steps.map((s, j) => (
                  <li key={j}>
                    <span className="font-medium text-foreground">{s.label}:</span> {s.value}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      ))}
      {result.skipped.length ? (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted p-3 text-xs text-muted">
          <Info className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium text-foreground">Regras que também casam, mas não foram aplicadas</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {result.skipped.map((s) => (
                <li key={`${s.ruleId}-${s.revenueType}`}>
                  {s.name} ({COMMISSION_REVENUE_LABELS[s.revenueType].toLowerCase()}, prioridade {s.priority}): {s.reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {result.uncovered.length ? <p className="text-xs text-muted">Sem regra para: {result.uncovered.map((t) => COMMISSION_REVENUE_LABELS[t].toLowerCase()).join(", ")}.</p> : null}
    </div>
  );
}

function Metric({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn("tabular-nums", strong && "font-semibold")}>{value}</dd>
      {hint ? <dd className="text-[11px] text-muted">{hint}</dd> : null}
    </div>
  );
}
